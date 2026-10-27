import { type NextRequest, NextResponse } from "next/server";
import { assertOwnsSubscription, recordAudit } from "@/lib/authz";
import { creem } from "@/lib/creem";
import { isDemoMode } from "@/lib/demo/mode";
import { getDemoStore } from "@/lib/demo/store";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSupabaseServer } from "@/lib/supabase/server";
import { validateCancelRequest } from "../validators";

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    const body = await request.json();
    const store = getDemoStore();
    const sub = Array.from(store.subscriptions.values()).find(
      (s) => s.creem_subscription_id === body.subscriptionId,
    );
    if (sub) {
      sub.status = "canceled";
    }
    return NextResponse.json({ success: true, subscription: sub ?? null });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await checkRateLimit(user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await request.json();
  const validation = validateCancelRequest(body);

  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { subscriptionId, mode } = validation.data;

  // ── 归属校验：这个订阅必须是当前用户的 ──────────────────────────────────
  // 旧实现拿到任何人的 creem_subscription_id 就能取消对方订阅（mode: immediate）。
  const owns = await assertOwnsSubscription(user.id, subscriptionId);
  if (!owns.ok) {
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "subscription.cancel.denied",
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { reason: owns.error },
      req: request,
    });
    return NextResponse.json({ error: owns.error }, { status: owns.status });
  }

  try {
    const result = await creem.subscriptions.cancel(subscriptionId, {
      mode,
      onExecute: mode === "scheduled" ? "cancel" : undefined,
    });
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "subscription.cancel",
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { mode },
      req: request,
    });
    return NextResponse.json({ success: true, subscription: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cancel failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
