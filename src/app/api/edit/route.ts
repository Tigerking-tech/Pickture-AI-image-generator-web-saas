import { NextRequest, NextResponse } from "next/server";
import { runEdit } from "@/lib/pipeline";
import { createSupabaseServer } from "@/lib/supabase/server";
import { extractAnonKey } from "@/lib/anon-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/edit — Pickture 编辑管线入口（完整闭环） */
export async function POST(req: NextRequest) {
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

  // 解析调用方用户（demo 模式返回 demo-user；真实模式无登录则为 undefined → 不扣费）。
  // 注意：不在此加 401 鉴权门，以免破坏公开编辑入口的既有验收脚本。
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

  // 匿名（未登录）用户：从 IP/UA 提取轻量指纹 key，用于生成式试用配额闸门；
  // 登录用户走积分账本，不在此限流。
  const anonKey = userId ? undefined : extractAnonKey(req);

  const reqPayload = {
    intent,
    sampleId: typeof body.sampleId === "string" ? body.sampleId : undefined,
    imageBase64: typeof body.imageBase64 === "string" ? body.imageBase64 : undefined,
    manifest: body.manifest && typeof body.manifest === "object" ? (body.manifest as never) : undefined,
    userId,
    anonKey,
  };

  try {
    const result = await runEdit(reqPayload);
    // HTTP 状态映射：积分不足 → 402（需付费）；匿名试用额度耗尽 → 429（需登录解锁）；
    // 其他业务失败 → 422；成功 → 200。
    let status = result.ok ? 200 : 422;
    if (result.code === "INSUFFICIENT_CREDITS") status = 402;
    if (result.code === "ANON_QUOTA_EXCEEDED") status = 429;
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
