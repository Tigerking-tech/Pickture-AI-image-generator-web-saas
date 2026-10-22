import { type NextRequest, NextResponse } from "next/server";
import { spendOneWork } from "@/lib/credits";
import { normalizePlan, resolveFinalModel, routeForPlan } from "@/lib/modelRouter";
import { checkRateLimit } from "@/lib/rate-limit";
import { persistImage, persistImageBuffer } from "@/lib/storage";
import {
  type GridLayout,
  GRID_MAX_PANELS,
  GRID_MIN_PANELS,
  buildGridPrompt,
  gridLayoutFor,
  sliceGrid,
} from "@/lib/imageGrid";
import { createSupabaseServer } from "@/lib/supabase/server";
import { toPrompt, type VistaTree, validateVistaTree } from "@/lib/vista";
import { getImageProvider, type ImageGenResult } from "@/lib/providers/image";

/**
 * R3 节点预览生图 / R4 终图合成
 *
 * - preview：对某节点的每个候选值各出一张便宜的图（数组长度 = 候选数）
 * - final  ：按完整要素树合成 1 张终图，并扣 1 个作品的积分
 *
 * 图像 provider 经 getImageProvider() 注入（fal / 火山引擎按 env 切换）。
 * 缺 key 时返回 503 并明确报错 —— 不静默降级、不返回假图。
 */

/** 可选模型覆盖：避免切换供应商时改代码 */
function resolvePreviewModel(base: string): string {
  return process.env.IMAGE_MODEL_PREVIEW?.trim() || base;
}
function resolveFinalModelName(plan: unknown, proTrialsUsed: number): string {
  const base = resolveFinalModel(plan, proTrialsUsed);
  return process.env.IMAGE_MODEL_FINAL?.trim() || base;
}

export async function POST(request: NextRequest) {
  const img = getImageProvider();
  if (!img.isConfigured()) {
    return NextResponse.json(
      { error: "MISSING_IMAGE_PROVIDER_KEY", message: img.missingKeyMessage() },
      { status: 503 },
    );
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { success } = await checkRateLimit(user?.id ?? "anonymous");
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: {
    mode?: string;
    plan?: string;
    candidates?: string[];
    tree?: VistaTree;
    proTrialsUsed?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = normalizePlan(body.plan);
  const route = routeForPlan(plan);

  // ── R3 节点预览：每个候选一张图 ──
  if (body.mode === "preview") {
    // 上限与网格能力对齐（2~9 个候选，9 个时走 3x3 网格，仍是 1 次调用）
    const candidates = Array.isArray(body.candidates)
      ? body.candidates.slice(0, GRID_MAX_PANELS)
      : [];
    if (candidates.length < 2) {
      return NextResponse.json(
        {
          error: "candidates_required",
          message: `At least 2 candidate values are required (grid supports ${GRID_MIN_PANELS}-${GRID_MAX_PANELS})`,
        },
        { status: 400 },
      );
    }

    const model = resolvePreviewModel(route.previewModel);

    // ① 优先走网格：一次调用把 N 个候选画进一张网格图，再按坐标切割。
    //    成本从 N 次调用降到 1 次（N=3 时省约 67%，N=9 时省 89%）。
    //    网格画歪 / 切割数不符 / 落库失败，一律自动回退到 ②。
    const gridResult = await tryGridPreview(img, candidates, model, user?.id ?? "anon");
    if (gridResult) {
      return NextResponse.json({ mode: "preview", ...gridResult, candidates });
    }

    // ② 回退：串行生成（不用 Promise.all 并行）：阿里/腾讯等免费档 QPS 很低（可能低至 1），
    // 并发多张会立刻触发 429 Throttling.RateQuota。串行慢一点但稳定，配合
    // 适配器内的 429 退避重试，免费额度也能可靠出图。
    const settled: ImageGenResult[] = [];
    for (const c of candidates) {
      settled.push(
        await img.generate({
          prompt: c,
          model,
          numImages: 1,
          size: "square_hd",
        }),
      );
    }

    const failed = settled.find((r) => !r.ok);
    if (failed && !failed.ok) {
      return NextResponse.json(
        { error: "upstream_error", status: failed.status, detail: failed.detail },
        { status: 502 },
      );
    }

    const urls = settled.flatMap((r) => (r.ok ? r.urls : []));
    // R3 验收：返回数组长度 = 候选数
    if (urls.length !== candidates.length) {
      return NextResponse.json(
        { error: "image_count_mismatch", expected: candidates.length, got: urls.length },
        { status: 502 },
      );
    }

    // 图在 CDN 上约 7 天过期，转存到自有存储后再返回给前端
    const stamp = Date.now();
    const uid = user?.id ?? "anon";
    const stored = await Promise.all(urls.map((u, i) => persistImage(u, `${uid}/${stamp}-${i}`)));
    const images = stored.map((p, i) => p?.url ?? urls[i]);
    const thumbs = stored.map((p, i) => p?.thumbUrl ?? urls[i]);

    return NextResponse.json({
      mode: "preview",
      images,
      thumbs,
      candidates,
      persisted: stored.map((p) => Boolean(p)),
    });
  }

  // ── R4 终图：1 张（免费档超出体验次数则降级预览模型） ──
  if (body.mode === "final") {
    if (!body.tree) {
      return NextResponse.json({ error: "tree_required" }, { status: 400 });
    }
    const validation = validateVistaTree(body.tree);
    if (!validation.ok) {
      return NextResponse.json(
        { error: "invalid_tree", errors: validation.errors.slice(0, 10) },
        { status: 400 },
      );
    }

    // 终图扣 1 个作品积分；超额 402（R5）
    if (user) {
      const spend = await spendOneWork(user.id, "final_image");
      if (!spend.ok) {
        return NextResponse.json(
          { error: spend.reason, message: spend.message },
          { status: spend.status ?? 402 },
        );
      }
    }

    const model = resolveFinalModelName(plan, body.proTrialsUsed ?? 0);
    const prompt = toPrompt(body.tree);

    const result = await img.generate({
      prompt,
      model,
      numImages: 1,
      size: "square_hd",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: "upstream_error", status: result.status, detail: result.detail },
        { status: 502 },
      );
    }
    if (result.urls.length !== 1) {
      return NextResponse.json(
        { error: "final_image_count_mismatch", got: result.urls.length },
        { status: 502 },
      );
    }

    // 终图是核心资产，必须落到自有存储（CDN 约 7 天过期）
    const persisted = await persistImage(
      result.urls[0],
      `${user?.id ?? "anon"}/${Date.now()}-final`,
    );

    return NextResponse.json({
      mode: "final",
      image: persisted?.url ?? result.urls[0],
      thumb: persisted?.thumbUrl ?? result.urls[0],
      persisted: Boolean(persisted),
      model,
      prompt,
      // R10：C2PA 机器可读标记（fal 随图保留，火山等需后续补充）
      provenance: { c2pa: true, generator: model },
    });
  }

  return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
}

/**
 * 网格出候选：一次调用画一张 N 格网格图 → 按坐标切割 → 逐格转存。
 *
 * 任一环节不达标（provider 不支持、候选数越界、调用失败、格子数不符、落库失败）
 * 都返回 null，由调用方回退到逐张串行生成 —— 绝不返回残缺或伪造的候选图。
 */
async function tryGridPreview(
  img: ReturnType<typeof getImageProvider>,
  candidates: string[],
  model: string,
  uid: string,
): Promise<{ images: string[]; thumbs: string[]; persisted: boolean[]; grid: GridLayout } | null> {
  const n = candidates.length;
  if (!img.generateGrid) return null;
  if (n < GRID_MIN_PANELS || n > GRID_MAX_PANELS) return null;

  const layout = gridLayoutFor(n);
  const prompt = buildGridPrompt(candidates, layout);

  try {
    const res = await img.generateGrid({ prompt, model, numImages: 1, size: "square" });
    if (!res.ok || res.urls.length === 0) return null;

    const fetched = await fetch(res.urls[0]);
    if (!fetched.ok) return null;
    const gridBuf = Buffer.from(await fetched.arrayBuffer());
    if (gridBuf.byteLength === 0) return null;

    // 切割全部格子（满格方阵），只取前 n 张作为候选（多余格是指令要求的重复格）
    const cells = await sliceGrid(gridBuf, layout, layout.rows * layout.cols);
    if (cells.length < n) return null;

    const stamp = Date.now();
    const stored: Array<Awaited<ReturnType<typeof persistImageBuffer>>> = [];
    for (let i = 0; i < n; i++) {
      stored.push(await persistImageBuffer(cells[i], `${uid}/${stamp}-${i}`));
    }
    if (stored.some((p) => !p)) return null;

    return {
      images: stored.map((p) => p?.url ?? ""),
      thumbs: stored.map((p) => p?.thumbUrl ?? ""),
      persisted: stored.map((p) => Boolean(p)),
      grid: layout,
    };
  } catch {
    return null;
  }
}
