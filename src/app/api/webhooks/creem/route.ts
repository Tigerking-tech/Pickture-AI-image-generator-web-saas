import { Webhook } from "@creem_io/nextjs";
import { isDemoMode } from "@/lib/demo/mode";
import { sendPaymentConfirmation } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CREDIT_UNLIMITED, grantCredits, planMonthlyCredits } from "@/lib/credits";
import { buildSubscriptionUpdate, buildSubscriptionUpsert, extractUserId } from "./handlers";

/** 由产品名 / 产品 ID 推断计划档位，用于发放对应月额度 */
function planFromProduct(name?: string, id?: string): string {
  const s = `${name ?? ""} ${id ?? ""}`.toLowerCase();
  if (s.includes("enterprise")) return "enterprise";
  if (s.includes("scale") || s.includes("max")) return "max";
  if (s.includes("pro")) return "pro";
  return "free";
}

/** 订阅激活 / 续费时，按计划发放当月生成式积分额度 */
async function topUpForProduct(userId: string | undefined, name?: string, id?: string) {
  if (!userId) return;
  const plan = planFromProduct(name, id);
  const amount = planMonthlyCredits(plan);
  if (amount === CREDIT_UNLIMITED) return; // 无限计划无需发放
  try {
    await grantCredits(userId, amount, "subscription_topup", `${plan} plan monthly credit grant`);
  } catch (e) {
    console.error(`[webhook] credit top-up failed for ${userId}:`, e);
  }
}

function handleWebhook() {
  if (isDemoMode()) {
    return null;
  }

  const db = getSupabaseAdmin();

  return Webhook({
    webhookSecret: process.env.CREEM_WEBHOOK_SECRET!,

    onCheckoutCompleted: async (event) => {
      const row = buildSubscriptionUpsert({
        metadata: event.metadata as { user_id?: string } | undefined,
        product: { id: event.product.id, name: event.product.name },
        customer: event.customer ? { id: event.customer.id } : { id: "" },
        subscription: event.subscription
          ? {
              id: event.subscription.id,
              current_period_end_date: event.subscription.current_period_end_date,
              canceled_at: null,
            }
          : undefined,
      });

      if (!row.user_id) {
        console.log("[webhook] checkout.completed: no user_id in metadata, skipping");
        return;
      }

      // Idempotency check
      const { data: existing } = await db
        .from("webhook_events")
        .select("id")
        .eq("id", event.webhookId)
        .single();

      if (existing) {
        console.log(`[webhook] duplicate event ${event.webhookId}, skipping`);
        return;
      }

      await db.from("webhook_events").insert({
        id: event.webhookId,
        event_type: "checkout.completed",
      });

      await db.from("subscriptions").upsert(row, { onConflict: "user_id" });

      // 发放订阅对应的当月生成式积分额度
      await topUpForProduct(row.user_id, event.product?.name, event.product?.id);

      // Send payment confirmation email
      if (event.customer?.email) {
        await sendPaymentConfirmation(
          event.customer.email,
          event.product?.name ?? "Subscription",
          event.product?.price ?? 0,
        );
      }
    },

    onSubscriptionActive: async (event) => {
      const update = buildSubscriptionUpdate("active", {
        current_period_end_date: event.current_period_end_date,
      });
      await db.from("subscriptions").update(update).eq("creem_subscription_id", event.id);
      // 续费：重新发放当月额度
      const { data: sub } = await db
        .from("subscriptions")
        .select("user_id, product_name, creem_product_id")
        .eq("creem_subscription_id", event.id)
        .single();
      if (sub) await topUpForProduct(sub.user_id, sub.product_name, sub.creem_product_id);
    },

    onSubscriptionPaid: async (event) => {
      const update = buildSubscriptionUpdate("active", {
        current_period_end_date: event.current_period_end_date,
      });
      await db.from("subscriptions").update(update).eq("creem_subscription_id", event.id);
      // 续费付款：重新发放当月额度
      const { data: sub } = await db
        .from("subscriptions")
        .select("user_id, product_name, creem_product_id")
        .eq("creem_subscription_id", event.id)
        .single();
      if (sub) await topUpForProduct(sub.user_id, sub.product_name, sub.creem_product_id);
    },

    onSubscriptionCanceled: async (event) => {
      const update = buildSubscriptionUpdate("cancelled", {
        canceled_at: event.canceled_at,
      });
      await db.from("subscriptions").update(update).eq("creem_subscription_id", event.id);
    },

    onSubscriptionExpired: async (event) => {
      await db
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("creem_subscription_id", event.id);
    },

    onSubscriptionPaused: async (event) => {
      await db
        .from("subscriptions")
        .update({ status: "paused" })
        .eq("creem_subscription_id", event.id);
    },

    onSubscriptionTrialing: async (event) => {
      const update = buildSubscriptionUpdate("trialing", {
        current_period_end_date: event.current_period_end_date,
      });
      await db.from("subscriptions").update(update).eq("creem_subscription_id", event.id);
    },

    onSubscriptionPastDue: async (event) => {
      await db
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("creem_subscription_id", event.id);
    },

    onSubscriptionUpdate: async (event) => {
      const productId = typeof event.product === "string" ? event.product : event.product.id;
      await db
        .from("subscriptions")
        .update({
          creem_product_id: productId,
          status: event.status,
          current_period_end: event.current_period_end_date
            ? new Date(event.current_period_end_date).toISOString()
            : undefined,
        })
        .eq("creem_subscription_id", event.id);
    },

    onRefundCreated: async (event) => {
      const subscriptionId =
        typeof event.subscription === "string" ? event.subscription : event.subscription?.id;

      const { data: sub } = await db
        .from("subscriptions")
        .select("user_id")
        .eq("creem_subscription_id", subscriptionId ?? "")
        .single();

      await db.from("billing_events").insert({
        user_id: sub?.user_id,
        event_type: "refund",
        creem_transaction_id: event.transaction.id,
        amount: event.refund_amount,
        currency: event.refund_currency,
        status: "completed",
      });
    },

    onDisputeCreated: async (event) => {
      const subscriptionId =
        typeof event.subscription === "string" ? event.subscription : event.subscription?.id;

      const { data: sub } = await db
        .from("subscriptions")
        .select("user_id")
        .eq("creem_subscription_id", subscriptionId ?? "")
        .single();

      await db.from("billing_events").insert({
        user_id: sub?.user_id,
        event_type: "dispute",
        creem_transaction_id: event.transaction.id,
        amount: event.amount,
        currency: event.currency,
        status: "open",
      });
    },

    onGrantAccess: async ({ reason, metadata }) => {
      const userId = extractUserId(metadata as Record<string, string> | undefined);
      if (!userId) {
        console.log("[webhook] Grant access: no user_id in metadata");
        return;
      }
      await db.from("subscriptions").update({ status: "active" }).eq("user_id", userId);
      await topUpForProduct(userId, "Pro Plan", process.env.NEXT_PUBLIC_CREEM_PRO_PRODUCT_ID);
      console.log(`[webhook] Granted access (${reason}) for user ${userId}`);
    },

    onRevokeAccess: async ({ reason, metadata }) => {
      const userId = extractUserId(metadata as Record<string, string> | undefined);
      if (!userId) {
        console.log("[webhook] Revoke access: no user_id in metadata");
        return;
      }
      const status = String(reason).includes("expired") ? "expired" : "cancelled";
      await db.from("subscriptions").update({ status }).eq("user_id", userId);
      console.log(`[webhook] Revoked access (${reason}) for user ${userId}`);
    },
  });
}

const webhookHandler = handleWebhook();

export async function POST(request: Request) {
  if (!webhookHandler) {
    // Demo mode — no-op
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return webhookHandler(request as never);
}
