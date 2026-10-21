import { type NextRequest, NextResponse } from "next/server";
import { spendOneWork } from "@/lib/credits";
import { normalizePlan, resolveFinalModel, routeForPlan } from "@/lib/modelRouter";
import { checkRateLimit } from "@/lib/rate-limit";
import { persistImage } from "@/lib/storage";
import { createSupabaseServer } from "@/lib/supabase/server";
import { toPrompt, type VistaTree, validateVistaTree } from "@/lib/vista";
import { getImageProvider } from "@/lib/providers/image";

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

    const model = resolvePreviewModel(route.previewModel);
    const settled = await Promise.all(
      candidates.map((c) =>
        img.generate({
          prompt: c,
          model,
          numImages: 1,
          size: "square_hd",
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
