import { type NextRequest, NextResponse } from "next/server";
import { ensureVisualCandidates, withDefaultModes } from "@/lib/elementConfig";
import { normalizePlan } from "@/lib/modelRouter";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  emptyVistaTree,
  normalizeOrientation,
  stripUnknownAttributes,
  type VistaTree,
  validateVistaTree,
} from "@/lib/vista";
import { getTextProvider } from "@/lib/providers/text";
import { buildSchemaHint } from "@/lib/providers/text/schemaHint";

/**
 * R1 拆句：句子（+ 可选参考图）→ VISTA 要素 JSON
 *
 * 两种返回模式：
 *   - 普通：一次性返回 JSON（前端没带 stream 时使用）
 *   - 流式（stream=true）：SSE，边生成边推送片段，最后发 done 事件带完整树。
 *     流式是长请求不被中间代理判超时的关键 —— 连接上一直有数据流动。
 *
 * 文本 provider 经 getTextProvider() 注入（OpenAI / OpenRouter / 腾讯按 env 切换），
 * 密钥绝不进浏览器（规格 §0.2 红线）。缺 key 时返回 503 并明确报错。
 *
 * 提速组合（2026-10-23 实测）：
 *   短句 40s、长句 66s → 分批并行 + 砍掉无用 camera 组 → 长句 36~42s
 *   再加同句缓存（重复句 0.2s）与流式推送（不再超时）。
 */

/** 可选模型覆盖：避免切换供应商时改代码 */
function resolveModel(plan: string, base: string): string {
  const override = plan === "free" ? process.env.TEXT_MODEL_FREE : process.env.TEXT_MODEL_PAID;
  return override && override.trim() ? override.trim() : base;
}

/**
 * 校验合并结果是否覆盖了所有批次的分组。
 * 模型偶尔对某一批返回空内容 —— 静默吞掉会让整组要素消失
 * （实测 lighting 组丢失，用户界面直接少了节点），必须回退重拆。
 */
function mergedCoversAllBatches(merged: Record<string, unknown>): boolean {
  return DECOMPOSE_BATCHES.every((batch) =>
    batch.every((g) => {
      const sec = merged[g];
      return Boolean(sec && typeof sec === "object" && Object.keys(sec as object).length > 0);
    }),
  );
}

/**
 * 拆批：每批只请求一组要素，输出量约为全量的 1/3，三批并行发出。
 * 分组依据 VISTA 的 group；camera 组已被 schemaHint 跳过。
 */
const DECOMPOSE_BATCHES: string[][] = [
  ["character", "environment"],
  ["lighting", "composition"],
  ["style", "effects"],
];

export async function POST(request: NextRequest) {
  const text = getTextProvider();
  if (!text.isConfigured()) {
    return NextResponse.json(
      { error: "MISSING_TEXT_PROVIDER_KEY", message: text.missingKeyMessage() },
      { status: 503 },
    );
  }

  let body: {
    sentence?: string;
    imageUrl?: string;
    plan?: string;
    sessionId?: string;
    stream?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";
  if (sentence === "") {
    return NextResponse.json({ error: "sentence_required" }, { status: 400 });
  }
  if (sentence.length > 500) {
    return NextResponse.json({ error: "sentence_too_long" }, { status: 400 });
  }

  const plan = normalizePlan(body.plan);
  // 免费档 GPT-4o-mini；付费档 GPT-4o（PRD §10.5），可用 env 覆盖
  const baseModel = plan === "free" ? "gpt-4o-mini" : "gpt-4o";
  const model = resolveModel(plan, baseModel);
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined;

  // ── 拆解缓存（PRD §9.4.1 缓存命中）：同一句子直接复用，0 等待 ──
  const cachedTree = await findCachedTree(sentence, model, imageUrl);
  if (cachedTree) {
    if (body.stream === true) {
      return sseStream(async (send) => {
        send("done", { tree: cachedTree, cached: true });
      });
    }
    return NextResponse.json(cachedTree);
  }

  // ── 流式拆解（前端带 stream=true 且 provider 支持时）──
  if (body.stream === true && text.decomposeStream) {
    return sseStream(async (send) => {
      const settled = await Promise.all(
        DECOMPOSE_BATCHES.map((groups, index) =>
          text.decomposeStream?.(
            {
              sentence,
              imageUrl,
              model,
              schemaHint: buildSchemaHint(groups),
            },
            (delta) => send("delta", { batch: index, text: delta }),
          ),
        ),
      );

      const okResults = (settled ?? []).filter((r) => r?.ok);
      let parsed: unknown;
      if (okResults.length === DECOMPOSE_BATCHES.length) {
        let merged: Record<string, unknown> = {};
        for (const r of okResults) {
          if (!r?.ok) continue;
          try {
            merged = { ...merged, ...(JSON.parse(r.content) as Record<string, unknown>) };
          } catch {
            merged = {};
            break;
          }
        }
        send("batch", { done: DECOMPOSE_BATCHES.length, total: DECOMPOSE_BATCHES.length });
        if (Object.keys(merged).length > 0 && mergedCoversAllBatches(merged)) {
          parsed = merged;
        }
      }

      // 分批失败则退化为单次全量流式拆解
      if (parsed === undefined) {
        const fallback = await text.decomposeStream?.({ sentence, imageUrl, model }, (delta) =>
          send("delta", { batch: 0, text: delta }),
        );
        if (!fallback?.ok) {
          send("error", {
            message: fallback?.detail ?? "decomposition failed",
            status: fallback?.status ?? 502,
          });
          return;
        }
        try {
          parsed = JSON.parse(fallback.content);
        } catch {
          send("error", { message: "invalid_json_from_model", status: 502 });
          return;
        }
      }

      const finalized = await finalizeTree(parsed, sentence, model, imageUrl, body.sessionId);
      if (!finalized.ok) {
        send("error", { message: finalized.error, errors: finalized.errors, status: 502 });
        return;
      }
      send("done", { tree: finalized.tree });
    });
  }

  // ── 普通（非流式）拆解 ──
  const runBatch = async (groups: string[]): Promise<Record<string, unknown> | null> => {
    const r = await text.decompose({
      sentence,
      imageUrl,
      model,
      schemaHint: buildSchemaHint(groups),
    });
    if (!r.ok) return null;
    try {
      return JSON.parse(r.content) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  let parsed: unknown;
  let usedBatches = false;
  {
    let merged: Record<string, unknown> = {};
    const results = await Promise.all(DECOMPOSE_BATCHES.map(runBatch));
    results.forEach((r) => {
      if (r) merged = { ...merged, ...r };
    });

    // 缺哪组就补拆哪组（一轮）—— 模型偶发对某批返回空内容，
    // 之前静默吞掉会让整组要素消失（实测 lighting 组丢失、界面少节点）
    const missing = DECOMPOSE_BATCHES.flat().filter((g) => {
      const sec = merged[g];
      return !(sec && typeof sec === "object" && Object.keys(sec as object).length > 0);
    });
    if (missing.length > 0) {
      const extra = await runBatch(missing);
      if (extra) merged = { ...merged, ...extra };
    }

    if (Object.keys(merged).length > 0 && mergedCoversAllBatches(merged)) {
      parsed = merged;
      usedBatches = true;
    }
  }

  if (!usedBatches) {
    const result = await text.decompose({ sentence, imageUrl, model });
    if (!result.ok) {
      const status = result.status >= 400 && result.status < 600 ? result.status : 502;
      return NextResponse.json(
        { error: "upstream_error", status: result.status, detail: result.detail },
        { status },
      );
    }
    try {
      parsed = JSON.parse(result.content);
    } catch {
      return NextResponse.json(
        { error: "invalid_json_from_model", raw: result.content.slice(0, 500) },
        { status: 502 },
      );
    }
  }

  const finalized = await finalizeTree(parsed, sentence, model, imageUrl, body.sessionId);
  if (!finalized.ok) {
    return NextResponse.json(
      { error: "schema_validation_failed", errors: finalized.errors },
      { status: 502 },
    );
  }
  return NextResponse.json(finalized.tree);
}

/** 查同句的拆解缓存；命中的树仍要过校验（老格式缓存直接弃用） */
async function findCachedTree(
  sentence: string,
  model: string,
  imageUrl?: string,
): Promise<VistaTree | null> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("decompositions")
      .select("tree")
      .eq("sentence", sentence)
      .order("created_at", { ascending: false })
      .limit(1);
    const cached = data?.[0]?.tree as Partial<VistaTree> | undefined;
    if (!cached) return null;
    const tree: VistaTree = { ...emptyVistaTree(), ...cached };
    withDefaultModes(tree);
    tree.meta = {
      ...tree.meta,
      fromImage: typeof imageUrl === "string" && imageUrl.startsWith("http"),
      changedFields: [],
      sentence,
      model,
    };
    return validateVistaTree(tree).ok ? tree : null;
  } catch {
    return null;
  }
}

/**
 * 把模型输出整理成可用树：丢未知键 → 补齐候选 → 补默认模式 → 校验 → 留档。
 * 流式与非流式共用，保证两条路径的结果完全一致。
 */
async function finalizeTree(
  parsed: unknown,
  sentence: string,
  model: string,
  imageUrl?: string,
  sessionId?: string,
): Promise<{ ok: true; tree: VistaTree } | { ok: false; error: string; errors?: string[] }> {
  const tree: VistaTree = { ...emptyVistaTree(), ...(stripUnknownAttributes(parsed) as object) };
  // 朝向强制归一化（剥掉动作词，避免与 pose 冲突）
  normalizeOrientation(tree);
  // 兜底：模型不一定给满 9 个候选，不足时用属性池补齐
  ensureVisualCandidates(tree);
  withDefaultModes(tree);
  tree.meta = {
    fromImage: typeof imageUrl === "string" && imageUrl.startsWith("http"),
    changedFields: [],
    sentence,
    model,
  };

  const validation = validateVistaTree(tree);
  if (!validation.ok) {
    return { ok: false, error: "schema_validation_failed", errors: validation.errors.slice(0, 10) };
  }

  // ── 拆解留档（PRD §9.5.5）：为将来的学习点 D（few-shot 回灌）攒数据 ──
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await getSupabaseAdmin()
      .from("decompositions")
      .insert({
        session_id:
          typeof sessionId === "string" && sessionId !== "" ? sessionId : `srv-${Date.now()}`,
        user_id: user?.id ?? null,
        sentence,
        tree,
        satisfaction_score: null,
      });
  } catch {
    // 静默：飞轮落库不是主流程
  }

  return { ok: true, tree };
}

/** SSE 响应：run 内部用 send(event, data) 推流 */
function sseStream(run: (send: (event: string, data: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : String(err), status: 502 });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 关闭中间层缓冲，否则流式会被攒成一整块（等于没有流式）
      "X-Accel-Buffering": "no",
    },
  });
}
