/**
 * Pure functions for webhook event processing.
 * Extracted from route handler for testability.
 */

const STATUS_MAP: Record<string, string> = {
  "subscription.canceled": "cancelled",
  "subscription.active": "active",
  "subscription.past_due": "past_due",
  "subscription.trialing": "trialing",
  "subscription.paused": "paused",
  "subscription.expired": "expired",
  "subscription.unpaid": "past_due",
  "subscription.paid": "active",
  "subscription.update": "active",
};

export function mapSubscriptionStatus(eventType: string): string | null {
  return STATUS_MAP[eventType] ?? null;
}

/** subscriptions.status 列的 CHECK 约束允许的全部取值（见 002_expand.sql:47-48） */
export const ALLOWED_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "scheduled_cancel",
  "cancelled",
  "paused",
  "expired",
  "inactive",
] as const;

/** 同一语义的不同拼写（Creem 侧可能给出美式 / 下划线写法） */
const STATUS_ALIASES: Record<string, string> = {
  canceled: "cancelled",
  unpaid: "past_due",
  trial: "trialing",
  trialing: "trialing",
  past_due: "past_due",
  scheduled_cancel: "scheduled_cancel",
  active: "active",
  paused: "paused",
  expired: "expired",
  inactive: "inactive",
};

/**
 * 把事件里的 status 归一化到 CHECK 约束允许的取值。
 *
 * 为什么必须有这一步：旧实现直接把 event.status 写进数据库，
 * 遇到 'canceled'（单 l）这类拼写就会撞 CHECK 约束，而更新结果没有做 error 检查，
 * 于是「写入失败 + 返回 200 + Creem 不再重试 + 用户付了钱仍是 Free」。
 */
export function normalizeStatus(input: string | undefined, eventType?: string): string | null {
  if (eventType) {
    const fromEvent = mapSubscriptionStatus(eventType);
    if (fromEvent) return fromEvent;
  }
  if (!input) return null;

  const raw = input.trim().toLowerCase();
  const mapped = STATUS_ALIASES[raw];
  if (!mapped) return null;
  return ALLOWED_STATUSES.includes(mapped as (typeof ALLOWED_STATUSES)[number]) ? mapped : null;
}

interface CheckoutEvent {
  metadata?: { user_id?: string };
  product: { id: string; name?: string };
  customer: { id: string };
  subscription?: {
    id: string;
    current_period_end_date?: Date | null;
    canceled_at?: Date | null;
  };
  feature?: {
    license?: { key: string };
  };
}

export interface SubscriptionUpsertRow {
  user_id: string | undefined;
  creem_customer_id: string;
  creem_subscription_id: string | undefined;
  creem_product_id: string;
  product_name: string | undefined;
  status: string;
  current_period_end?: string;
}

export function buildSubscriptionUpsert(event: CheckoutEvent): SubscriptionUpsertRow {
  return {
    user_id: event.metadata?.user_id,
    creem_customer_id: event.customer.id,
    creem_subscription_id: event.subscription?.id,
    creem_product_id: event.product.id,
    product_name: event.product.name,
    status: "active",
    current_period_end: event.subscription?.current_period_end_date
      ? new Date(event.subscription.current_period_end_date).toISOString()
      : undefined,
  };
}

interface SubscriptionUpdateFields {
  current_period_end_date?: Date | null;
  canceled_at?: Date | null;
}

export interface SubscriptionUpdateRow {
  status: string;
  current_period_end?: string;
  cancel_at?: string;
}

export function extractUserId(metadata: Record<string, string> | undefined): string | undefined {
  return metadata?.user_id;
}

export function buildSubscriptionUpdate(
  status: string,
  fields: SubscriptionUpdateFields,
): SubscriptionUpdateRow {
  const row: SubscriptionUpdateRow = { status };

  if (fields.current_period_end_date) {
    row.current_period_end = new Date(fields.current_period_end_date).toISOString();
  }

  if (status === "scheduled_cancel" && fields.canceled_at) {
    row.cancel_at = new Date(fields.canceled_at).toISOString();
  }

  return row;
}
