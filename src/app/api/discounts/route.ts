import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, recordAudit } from "@/lib/authz";
import { creem } from "@/lib/creem";
import { isDemoMode } from "@/lib/demo/mode";
import { generateDemoId } from "@/lib/demo/store";
import { createSupabaseServer } from "@/lib/supabase/server";
import { validateDiscountCreate } from "./helpers";

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    const body = await request.json();
    const mockDiscount = {
      id: generateDemoId(),
      code: body.code ?? `DEMO${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      percent_off: body.percentOff ?? 10,
      amount_off: body.amountOff ?? null,
      currency: body.currency ?? "usd",
      max_redemptions: body.maxRedemptions ?? null,
      expires_at: body.expiresAt ?? null,
    };
    return NextResponse.json({ success: true, discount: mockDiscount });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── 管理员校验 ──────────────────────────────────────────────────────────
  // 旧实现只校验"是否登录"，等于任何注册用户都能自助创建 100% 折扣码，
  // 再拿它走 checkout 白嫖订阅（webhook 还会照常发放对应额度的积分）。
  // assertAdmin 内部 fail-closed：未配置 ADMIN_EMAIL 一律拒绝。
  const admin = assertAdmin({ id: user.id, email: user.email });
  if (!admin.ok) {
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "discount.create.denied",
      targetType: "discount",
      metadata: { reason: admin.error },
      req: request,
    });
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await request.json();
  const validation = validateDiscountCreate(body);

  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const result = await creem.discounts.create(validation.data);
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "discount.create",
      targetType: "discount",
      targetId: ((result as Record<string, unknown> | undefined)?.id as string) ?? undefined,
      metadata: validation.data as unknown as Record<string, unknown>,
      req: request,
    });
    return NextResponse.json({ success: true, discount: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discount creation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  if (isDemoMode()) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    if (!code) {
      return NextResponse.json({ error: "code parameter required" }, { status: 400 });
    }
    const mockDiscount = {
      id: generateDemoId(),
      code,
      percent_off: 10,
      amount_off: null,
      currency: "usd",
      max_redemptions: null,
      expires_at: null,
    };
    return NextResponse.json({ discount: mockDiscount });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "code parameter required" }, { status: 400 });
  }

  try {
    const result = await creem.discounts.get(undefined, code);
    return NextResponse.json({ discount: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discount not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
