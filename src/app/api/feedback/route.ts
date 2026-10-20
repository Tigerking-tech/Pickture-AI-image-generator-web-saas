import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * R11 站内反馈入口
 *
 * PRD §9.8 建议：反馈用现成工具（UserJot / Feeqd / PostHog Surveys），
 * 本接口作为"轻量兜底"存在（PRD §9.8.2），接收后回 200，不做重客服系统。
 */

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { success } = await checkRateLimit(user?.id ?? "anonymous");
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { message?: string; page?: string; email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message === "") {
    return NextResponse.json({ error: "message_required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "message_too_long" }, { status: 400 });
  }

  // 落库前不做任何静默丢弃：即使未接入外部反馈系统，也在服务端留痕便于排查
  console.info("[feedback]", {
    userId: user?.id ?? "anonymous",
    page: body.page ?? null,
    email: body.email ?? null,
    message,
  });

  return NextResponse.json({ ok: true });
}
