import { Webhook } from "@creem_io/nextjs";
import { CREDIT_UNLIMITED, grantCredits, planMonthlyCredits } from "@/lib/credits";
import { isDemoMode } from "@/lib/demo/mode";
import { sendPaymentConfirmation } from "@/lib/email";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ALLOWED_STATUSES,
  buildSubscriptionUpdate,
  buildSubscriptionUpsert,
  extractUserId,
  normalizeStatus,
  type SubscriptionUpdateRow,
} from "./handlers";

/** 由产品名 / 产品 ID 推断计划档位，用于发放对应月额度 */
function planFromProduct(name?: string, id?: string): string {
  const s = `${name ?? ""} ${id ?? ""}`.toLowerCase();
  if (s.includes("enterprise")) return "enterprise";
  if (s.includes("scale") || s.includes("max")) return "max";
  if (s.includes("pro")) return "pro";
  return "free";
}

/**
 * 事件去重：同一个 webhookId 只处理一次。
 *
 * 为什么每个 handler 都要做：旧实现只有 checkout.completed 查过 webhook_events，
 * 而 subscription.paid / subscription.active 每次投递都会重新发放月额度 ——
 * Creem（乃至所有 webhook 提供方）是「至少一次」投递，一次网络抖动就多送一份 200/2000 积分。
 *
 * 用 upsert + ignoreDuplicates + select 让「查 + 写」在一个原子操作内完成，
 * 返回空数组即表示已被别的实例（或上一次投递）处理过。
 */
async function claimEvent(eventId: string | undefined, eventType: string): Promise<boolean> {
  if (!eventId) return true; // 拿不到 id 时宁可放行也不能丢事件
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("webhook_events")
    .upsert({ id: eventId, event_type: eventType }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`webhook_events claim failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** 处理失败时撤回去重标记，让 Creem 的重试能真正重跑一遍 */
async function releaseEvent(eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  try {
    await getSupabaseAdmin().from("webhook_events").delete().eq("id", eventId);
  } catch (e) {
    // 撤回失败只会导致该事件被去重跳过；宁可漏一次重发，也不能重复发放额度
    console.error(`[webhook] failed to release claim ${eventId}:`, e);
  }
}

/**
 * 统一包装：占坑去重 → 执行 → 失败释放占坑并抛出。
 * 抛错是这个路由唯一的正确失败方式：返回 200 会让 Creem 认为投递成功从而不再重试，
 * 于是「付了钱但订阅没更新」这类故障永远不会被自愈。
 */
async function once(eventId: string | undefined, eventType: string, fn: () => Promise<void>) {
  if (!(await claimEvent(eventId, eventType))) {
    console.log(`[webhook] duplicate ${eventType} event ${eventId}, skipped`);
    return;
  }
  try {
    await fn();
  } catch (e) {
    await releaseEvent(eventId);
    throw e;
  }
}

/**
 * 订阅激活 / 续费时的月额度发放。
 *
 * 幂等键按计费周期计算：subscription.active 与 subscription.paid 两个事件都会到达，
 * 叠加 Creem 重试后，只靠 webhookId 去重挡不住「不同事件 + 同一周期」的重复发放。
 */
async function topUpForProduct(
  userId: string | undefined,
  name: string | undefined,
  id: string | undefined,
  idempotencyKey: string,
) {
  if (!userId) return;
  const plan = planFromProduct(name, id);
  const amount = planMonthlyCredits(plan);
  if (amount === CREDIT_UNLIMITED) return; // 无限计划无需发放

  if (!(await claimEvent(idempotencyKey, "credits.grant"))) {
    console.log(`[webhook] credit grant already applied for ${idempotencyKey}, skipped`);
    return;
  }

  try {
    const res = await grantCredits(
      userId,
      amount,
      "subscription_topup",
      `${plan} plan monthly credit grant`,
    );
    // 发放失败必须抛错：用户已经付过钱，静默失败 = 少给权益且无人知晓
    if (!res.ok) throw new Error(`credit top-up failed for ${userId}: ${res.error}`);
  } catch (e) {
    await releaseEvent(idempotencyKey);
    throw e;
  }
}

/** 任何 DB 写失败都抛错，而不是像旧实现那样静默吞掉 error */
async function requireWrite(
  label: string,
  run: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  const res = await run();
  if (res?.error) throw new Error(`${label} failed: ${res.error.message}`);
}

/** 允许传入 SubscriptionUpdateRow 这类具名结构（它没有索引签名，直接当 Record 用会类型报错） */
type SubscriptionPatch = Record<string, unknown> | SubscriptionUpdateRow;

/** 按 creem_subscription_id 更新订阅，并确认真的命中了行 */
async function updateSubscriptionByCreemId(creemSubscriptionId: string, patch: SubscriptionPatch) {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("subscriptions")
    .update(patch as Record<string, unknown>)
    .eq("creem_subscription_id", creemSubscriptionId)
    .select("id, user_id, product_name, creem_product_id");
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    // 常见于事件乱序（paid 早于 checkout.completed 到达）。抛错让 Creem 重试，
    // 而不是像旧实现那样「更新了 0 行 + 不发额度 + 返回成功」。
    throw new Error(
      `no subscription row for creem_subscription_id=${creemSubscriptionId} (will retry)`,
    );
  }
  return rows;
}

/** 退款 / 争议事件用：查不到订阅不属于错误（可能是一次性付款），返回 null 即可 */
async function readSubscriptionRows(subscriptionId?: string | null) {
  if (!subscriptionId) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("subscriptions")
    .select("user_id")
    .eq("creem_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw new Error(`subscriptions lookup failed: ${error.message}`);
  return data ? [data] : null;
}

function handleWebhook() {
  if (isDemoMode()) {
    return null;
  }

  const db = getSupabaseAdmin();

  return Webhook({
    webhookSecret: process.env.CREEM_WEBHOOK_SECRET!,

    onCheckoutCompleted: async (event) => {
      await once(event.webhookId, "checkout.completed", async () => {
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
          // 缺 user_id 说明不是从本站发起的结账，不能凭空给谁发权益
          console.error("[webhook] checkout.completed without user_id in metadata — not granting");
          throw new Error("checkout.completed missing metadata.user_id");
        }

        await requireWrite("subscriptions upsert", () =>
          db.from("subscriptions").upsert(row, { onConflict: "user_id" }),
        );

        await topUpForProduct(
          row.user_id,
          event.product?.name,
          event.product?.id,
          `credits:checkout:${event.subscription?.id ?? row.user_id}:${row.current_period_end ?? "unknown"}`,
        );

        // 邮件属通知性质，失败不回滚已发放的权益，但要留下可见错误原先被完全忽略
        if (event.customer?.email) {
          const sent = await sendPaymentConfirmation(
            event.customer.email,
            event.product?.name ?? "Subscription",
            event.product?.price ?? 0,
          );
          if (!sent.success) {
            console.error("[webhook] payment confirmation email failed to send");
          }
        }
      });
    },

    onSubscriptionActive: async (event) => {
      await once(event.webhookId, "subscription.active", async () => {
        const update = buildSubscriptionUpdate("active", {
          current_period_end_date: event.current_period_end_date,
        });
        const rows = await updateSubscriptionByCreemId(event.id, update);
        const sub = rows[0];
        await topUpForProduct(
          sub.user_id as string,
          sub.product_name as string,
          sub.creem_product_id as string,
          `credits:period:${event.id}:${String(event.current_period_end_date ?? "unknown")}`,
        );
      });
    },

    onSubscriptionPaid: async (event) => {
      await once(event.webhookId, "subscription.paid", async () => {
        const update = buildSubscriptionUpdate("active", {
          current_period_end_date: event.current_period_end_date,
        });
        const rows = await updateSubscriptionByCreemId(event.id, update);
        const sub = rows[0];
        // 与 subscription.active 共用同一周期的幂等键，避免一次续费发两份额度
        await topUpForProduct(
          sub.user_id as string,
          sub.product_name as string,
          sub.creem_product_id as string,
          `credits:period:${event.id}:${String(event.current_period_end_date ?? "unknown")}`,
        );
      });
    },

    onSubscriptionCanceled: async (event) => {
      await once(event.webhookId, "subscription.canceled", async () => {
        const update = buildSubscriptionUpdate("cancelled", {
          canceled_at: event.canceled_at,
        });
        await updateSubscriptionByCreemId(event.id, update);
      });
    },

    onSubscriptionExpired: async (event) => {
      await once(event.webhookId, "subscription.expired", async () => {
        await updateSubscriptionByCreemId(event.id, { status: "expired" });
      });
    },

    onSubscriptionPaused: async (event) => {
      await once(event.webhookId, "subscription.paused", async () => {
        await updateSubscriptionByCreemId(event.id, { status: "paused" });
      });
    },

    onSubscriptionTrialing: async (event) => {
      await once(event.webhookId, "subscription.trialing", async () => {
        const update = buildSubscriptionUpdate("trialing", {
          current_period_end_date: event.current_period_end_date,
        });
        await updateSubscriptionByCreemId(event.id, update);
      });
    },

    onSubscriptionPastDue: async (event) => {
      await once(event.webhookId, "subscription.past_due", async () => {
        await updateSubscriptionByCreemId(event.id, { status: "past_due" });
      });
    },

    onSubscriptionUpdate: async (event) => {
      await once(event.webhookId, "subscription.update", async () => {
        const productId = typeof event.product === "string" ? event.product : event.product.id;
        const status = normalizeStatus(event.status, "subscription.update");
        if (!status) {
          // 不再把原始 status 直接写进带 CHECK 约束的列 —— 约束冲突会静默失败
          throw new Error(
            `unsupported subscription status "${String(event.status)}" (allowed: ${ALLOWED_STATUSES.join(", ")})`,
          );
        }
        await updateSubscriptionByCreemId(event.id, {
          creem_product_id: productId,
          status,
          current_period_end: event.current_period_end_date
            ? new Date(event.current_period_end_date).toISOString()
            : undefined,
        });
      });
    },

    onRefundCreated: async (event) => {
      await once(event.webhookId, "refund.created", async () => {
        const subscriptionId =
          typeof event.subscription === "string" ? event.subscription : event.subscription?.id;
        const rows = await readSubscriptionRows(subscriptionId);
        await requireWrite("billing_events insert (refund)", () =>
          db.from("billing_events").insert({
            user_id: rows?.[0]?.user_id ?? null,
            event_type: "refund",
            creem_transaction_id: event.transaction.id,
            creem_subscription_id: subscriptionId ?? null,
            // 金额单位：最小货币单位（USD 为 cents），本列一律以「分」存储
            amount: event.refund_amount,
            currency: event.refund_currency,
            status: "completed",
          }),
        );
      });
    },

    onDisputeCreated: async (event) => {
      await once(event.webhookId, "dispute.created", async () => {
        const subscriptionId =
          typeof event.subscription === "string" ? event.subscription : event.subscription?.id;
        const rows = await readSubscriptionRows(subscriptionId);
        await requireWrite("billing_events insert (dispute)", () =>
          db.from("billing_events").insert({
            user_id: rows?.[0]?.user_id ?? null,
            event_type: "dispute",
            creem_transaction_id: event.transaction.id,
            creem_subscription_id: subscriptionId ?? null,
            amount: event.amount,
            currency: event.currency,
            status: "open",
          }),
        );
      });
    },

    onGrantAccess: async ({ reason, metadata }) => {
      const userId = extractUserId(metadata as Record<string, string> | undefined);
      if (!userId) {
        console.error("[webhook] Grant access without user_id in metadata — refusing to grant");
        throw new Error("grant-access missing metadata.user_id");
      }
      await requireWrite("subscriptions grant access", () =>
        db.from("subscriptions").update({ status: "active" }).eq("user_id", userId),
      );
      await topUpForProduct(
        userId,
        "Pro Plan",
        process.env.NEXT_PUBLIC_CREEM_PRO_PRODUCT_ID,
        `credits:grant-access:${userId}:${String(reason ?? "unknown")}`,
      );
      console.log(`[webhook] Granted access (${reason}) for user ${userId}`);
    },

    onRevokeAccess: async ({ reason, metadata }) => {
      const userId = extractUserId(metadata as Record<string, string> | undefined);
      if (!userId) {
        console.error("[webhook] Revoke access without user_id in metadata — refusing to revoke");
        throw new Error("revoke-access missing metadata.user_id");
      }
      const status = String(reason).includes("expired") ? "expired" : "cancelled";
      await requireWrite("subscriptions revoke access", () =>
        db.from("subscriptions").update({ status }).eq("user_id", userId),
      );
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

  try {
    return await webhookHandler(request as never);
  } catch (e) {
    // 兜底：任何未捕获异常都返回 500，确保 Creem 会重试而不是当成投递成功
    console.error("[webhook] unhandled error:", e instanceof Error ? e.message : e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "internal error" }),
      { status: 500 },
    );
  }
}
