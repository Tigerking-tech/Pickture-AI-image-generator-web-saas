import { type NextRequest, NextResponse } from "next/server";
import { extractAnonKey } from "@/lib/anon-key";
import { isDemoMode } from "@/lib/demo/mode";
import { MAX_UPLOAD_BYTES, runEdit } from "@/lib/pipeline";
import { checkEditRateLimit } from "@/lib/rate-limit";
import { createSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单请求 JSON body 上限（base64 膨胀后约为 1.34×，留足余量） */
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 4 * 1024 * 1024;

/** POST /api/edit — Surepix 编辑管线入口（完整闭环） */
export async function POST(req: NextRequest) {
  // ── 第一道门：整包体积 ──────────────────────────────────────────────────
  // 任何大 body 都不要进 JSON.parse：解析成本本身就被用来做资源耗尽攻击。
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "request body too large" }, { status: 413 });
  }

  // ── 第二道门：速率限制 ──────────────────────────────────────────────────
  // 这是全站唯一会真实烧钱的端点（生成式走 fal 按次计费，确定性编辑烧本机 CPU），
  // 此前却完全没有限流。登录用户按 user 维度、匿名按 IP 维度计，
  // 具体算法见 rate-limit.ts（生产必须配 Upstash，否则此处恒放行）。
  const anonKey = extractAnonKey(req);
  if (!isDemoMode()) {
    const { success } = await checkEditRateLimit(anonKey);
    if (!success) {
      return NextResponse.json(
        { ok: false, error: "Too many requests. Slow down or sign in for a higher allowance." },
        { status: 429 },
      );
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const intent = typeof body.intent === "string" ? body.intent : "";
  if (!intent) {
    return NextResponse.json({ ok: false, error: "intent is required" }, { status: 400 });
  }

  // 意图长度上限：自然语言意图会进router / 生成模型 prompt，过长的字符串没有语义预算
  if (intent.length > 1000) {
    return NextResponse.json({ ok: false, error: "intent too long" }, { status: 400 });
  }

  // 解析调用方用户（demo 模式返回 demo-user；真实模式无登录则为 undefined → 不扣费）。
  // 仍然不在此加 401 鉴权门（保留"确定性编辑免登录试用"的获客漏斗），但资源消耗
  // 已由上面的体积闸门 + 速率限制 + pipeline 内的像素上限 + 配额/积分账本共同约束：
  //   · 确定性编辑（≈$0 本地 CPU）→ 匿名可用，受 fair-use 月度额度限制
  //   · 生成式编辑（≈$0.02/次真实计费）→ 匿名受每日试用额度，登录用户按积分扣费
  let userId: string | undefined;
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? undefined;
  } catch {
    userId = undefined;
  }

  // 匿名（未登录）用户用 anonKey 走试用配额闸门；登录用户走积分账本，不在此限。
  const effectiveAnonKey = userId ? undefined : anonKey;

  const reqPayload = {
    intent,
    sampleId: typeof body.sampleId === "string" ? body.sampleId : undefined,
    imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : undefined,
    manifest:
      body.manifest && typeof body.manifest === "object" ? (body.manifest as never) : undefined,
    userId,
    anonKey: effectiveAnonKey,
  };

  try {
    const result = await runEdit(reqPayload);
    // HTTP 状态映射：积分不足 → 402（需付费）；匿名试用额度耗尽 → 429（需登录解锁）；
    // 其他业务失败 → 422；成功 → 200。
    let status = result.ok ? 200 : 422;
    if (result.code === "INSUFFICIENT_CREDITS") status = 402;
    if (result.code === "ANON_QUOTA_EXCEEDED") status = 429;
    if (result.code === "FAIR_USE_EXCEEDED") status = userId ? 402 : 429;
    return NextResponse.json(result, { status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "internal error" },
      { status: 500 },
    );
  }
}

/** GET /api/edit — 能力探测（前端握手用） */
export async function GET() {
  return NextResponse.json({
    service: "surepix-edit-pipeline",
    version: "0.1.0",
    engine: "PhotoCraft CLI v0.15.1 (Rust)",
    license: "MIT OR Apache-2.0",
    routes: ["photocraft", "hybrid", "regenerate", "reject"],
    docs: "POST {intent, sampleId | imageBase64, manifest?}",
  });
}
