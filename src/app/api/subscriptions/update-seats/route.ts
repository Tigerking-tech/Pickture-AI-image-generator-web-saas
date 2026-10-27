import { type NextRequest, NextResponse } from "next/server";
import { assertOwnsSubscription, recordAudit } from "@/lib/authz";
import { creem } from "@/lib/creem";
import { isDemoMode } from "@/lib/demo/mode";
import { getDemoStore } from "@/lib/demo/store";
import { createSupabaseServer } from "@/lib/supabase/server";
import { validateSeatUpdate } from "../validators";

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    const body = await request.json();
    const store = getDemoStore();
    const sub = Array.from(store.subscriptions.values()).find(
      (s) => s.creem_subscription_id === body.subscriptionId,
    );
    if (sub) {
      sub.seats = body.units;
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

  const body = await request.json();
  const validation = validateSeatUpdate(body);

  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const { subscriptionId, units } = validation.data;

  // ── 归属校验 ────────────────────────────────────────────────────────────
  // 改席位会立刻改变对方的账单金额。
  const owns = await assertOwnsSubscription(user.id, subscriptionId);
  if (!owns.ok) {
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "subscription.seats.denied",
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { reason: owns.error, units },
      req: request,
    });
    return NextResponse.json({ error: owns.error }, { status: owns.status });
  }

  // TODO(产品): seats 目前只是订阅表里的一个数字，没有 org / 成员 / 邀请模型，
  // 客户端真正"能用"的仍然只有购买者自己。定价页的 Seats 一栏待引入团队模型后生效，
  // 在那之前建议不对外宣传席位数量。
  try {
    const result = await creem.subscriptions.update(subscriptionId, {
      items: [{ units }],
    });
    await recordAudit({
      user: { id: user.id, email: user.email },
      action: "subscription.seats.update",
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { units },
      req: request,
    });
    return NextResponse.json({ success: true, subscription: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Seat update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
