import { type NextRequest, NextResponse } from "next/server";
import { assertClaimableSubscription, recordAudit } from "@/lib/authz";
import { isDemoMode } from "@/lib/demo/mode";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.json({ synced: true });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const subscriptionId = typeof body.subscriptionId === "string" ? body.subscriptionId : "";
  const customerIdHint = typeof body.customerId === "string" ? body.customerId : undefined;

  if (!subscriptionId) {
    return NextResponse.json({ error: "Missing subscriptionId" }, { status: 400 });
  }

  // ── 归属校验 ────────────────────────────────────────────────────────────
  // 旧实现直接用客户端传来的 subscriptionId / productId 写库，等于任何人登录后
  // 都能把别人的订阅（或任意手写 id）绑到自己账号并拿到对应计划的权益与积分。
  // 改为：由服务端向 Creem 取回订阅，用 metadata.user_id / customer.id 判定归属。
  const claim = await assertClaimableSubscription(
    { id: user.id, email: user.email },
    subscriptionId,
  );
  if (!claim.ok) {
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "checkout.sync.denied",
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { reason: claim.error },
      req: request,
    });
    return NextResponse.json({ error: claim.error }, { status: claim.status });
  }

  const sub = claim.value;
  // productId 一律以 Creem 返回值为准，客户端传的 productId 不再被信任
  const productId = sub.productId ?? "unknown";

  const { error } = await getSupabaseAdmin()
    .from("subscriptions")
    .upsert(
      {
        user_id: user.id,
        creem_customer_id: sub.customerId ?? customerIdHint ?? "",
        creem_subscription_id: sub.creemSubscriptionId || subscriptionId,
        creem_product_id: productId,
        product_name: sub.productName ?? "Plan",
        status: sub.status ?? "active",
        current_period_end: sub.currentPeriodEnd ?? undefined,
      },
      { onConflict: "user_id" },
    );

  if (error) {
    // 写库失败必须显式报错：Creem 侧已扣款，静默成功会让用户"付了钱却没权益"
    console.error("[checkout/success] upsert failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAudit({
    user: { id: user.id, email: user.email },
    action: "checkout.sync",
    targetType: "subscription",
    targetId: subscriptionId,
    metadata: { productId },
    req: request,
  });

  return NextResponse.json({ synced: true });
}
