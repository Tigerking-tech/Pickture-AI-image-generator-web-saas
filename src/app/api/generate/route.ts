import { type NextRequest, NextResponse } from "next/server";
import { spendOneWork } from "@/lib/credits";
import { normalizePlan, resolveFinalModel, routeForPlan } from "@/lib/modelRouter";
import { checkRateLimit } from "@/lib/rate-limit";
import { persistImage } from "@/lib/storage";
import { createSupabaseServer } from "@/lib/supabase/server";
import { toPrompt, type VistaTree, validateVistaTree } from "@/lib/vista";

/**
 * R3 节点预览生图 / R4 终图合成
 *
 * - preview：对某节点的每个候选值各出一张便宜的 schnell 图（数组长度 = 候选数）
 * - final  ：按完整要素树合成 1 张 Pro 终图，并扣 1 个作品的积分
 *
 * 缺 FAL_KEY 时返回 503 并明确报错 —— 不静默降级、不返回假图。
 */

const FAL_RUN = "https://fal.run";

interface FalImageResult {
  images?: Array<{ url: string }>;
}

async function callFal(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; urls: string[] } | { ok: false; status: number; detail: string }> {
  const res = await fetch(`${FAL_RUN}/${model}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
  }

  const json = (await res.json()) as FalImageResult;
  const urls = (json.images ?? []).map((i) => i.url).filter(Boolean);
  return { ok: true, urls };
}

export async function POST(request: NextRequest) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    return NextResponse.json(
      {
        error: "MISSING_FAL_KEY",
        message:
          "FAL_KEY is not configured, so no image can be generated. Add your fal.ai key to .env.local and retry. This endpoint will not return fake images.",
      },
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
    sessionId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const plan = normalizePlan(body.plan);
  const route = routeForPlan(plan);

  // ── R3 节点预览：每个候选一张 schnell 图 ──
  if (body.mode === "preview") {
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 4) : [];
    if (candidates.length < 2) {
      return NextResponse.json(
        {
          error: "candidates_required",
          message: "At least 2 candidate values are required (R2/R3 require 2–4 images)",
        },
        { status: 400 },
      );
    }

    const settled = await Promise.all(
      candidates.map((c) =>
        callFal(falKey, route.previewModel, {
          prompt: c,
          image_size: "square_hd",
          num_images: 1,
        }),
      ),
    );

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

    // fal CDN 上的图约 7 天过期，转存到自有存储后再返回给前端
    const stamp = Date.now();
    const uid = user?.id ?? "anon";
    // basePath 不带扩展名：persistImage 会产出 .webp 与 __thumb.webp 两级
    const stored = await Promise.all(urls.map((u, i) => persistImage(u, `${uid}/${stamp}-${i}`)));
    const images = stored.map((p, i) => p?.url ?? urls[i]);
    const thumbs = stored.map((p, i) => p?.thumbUrl ?? urls[i]);

    return NextResponse.json({
      mode: "preview",
      images,
      thumbs,
      candidates,
      // 明确告知前端哪些是临时地址，便于后续重试转存
      persisted: stored.map((p) => Boolean(p)),
    });
  }

  // ── R4 终图：1 张 Pro（免费档超出体验次数则降级 schnell） ──
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

    const model = resolveFinalModel(plan, body.proTrialsUsed ?? 0);
    const prompt = toPrompt(body.tree);

    const result = await callFal(falKey, model, {
      prompt,
      image_size: "square_hd",
      num_images: 1,
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

    // 终图是核心资产，必须落到自有存储（fal CDN 约 7 天过期）
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
      // R10：C2PA 机器可读标记由 fal.ai 随图保留，此处回传供落库
      provenance: { c2pa: true, generator: model },
    });
  }

  return NextResponse.json({ error: "invalid_mode" }, { status: 400 });
}
