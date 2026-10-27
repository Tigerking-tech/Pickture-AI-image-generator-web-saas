/**
 * authz.ts — 服务端归属校验与审计日志的唯一入口
 *
 * 背景（为什么必须存在）：
 *  本项目的计费路由此前统一是「getUser() 拿到登录态 → 直接用 body 里的 id 调 Creem」。
 *  这意味着只要登录，换一个别人的 creem_subscription_id 就能操作别人的订阅
 *  （取消 / 升级扣费 / 改席位），也能把别人的订阅绑到自己账号上。
 *  这是清单里最典型的一类越权：改变请求里的一个 id 就能读写他人数据。
 *
 * 约定：
 *  1. 任何接收外部 id（subscriptionId / customerId / productId）的路由，必须先跑这里
 *  2. 归属判断只认服务端数据（DB 或 Creem 返回的 metadata / customer），不认客户端声明
 *  3. demo 模式（全内存 mock，无真实凭据）放行，保持本地开发和验收脚本可跑通
 *  4. 高危操作写 audit_log（迁移 004 建表）；写失败不影响主流程，但会 console.error
 */

import type { NextRequest } from "next/server";
import { creem } from "@/lib/creem";
import { isDemoMode } from "@/lib/demo/mode";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type AuthzResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 401 | 403 | 404; error: string };

export interface AuthedUser {
  id: string;
  email?: string | null;
}

/** 从请求提取审计用的 IP（不用于鉴权，只用于留痕） */
function requestIp(req?: NextRequest): string | null {
  if (!req) return null;
  const fwd = req.headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0].trim() : undefined) || req.headers.get("x-real-ip");
  return ip || null;
}

// ============================================================
// 1. 订阅归属校验（对已有订阅执行：取消 / 升级 / 改席位）
// ============================================================

/**
 * 校验某个 creem_subscription_id 确实属于当前登录用户。
 * 依据：subscriptions 表里 user_id + creem_subscription_id 同时命中。
 * 未命中一律 404（不返回 "存在但不属于你"，避免用来枚举他人的订阅 id）。
 */
export async function assertOwnsSubscription(
  userId: string,
  subscriptionId: string,
): Promise<AuthzResult<null>> {
  if (!subscriptionId) {
    return { ok: false, status: 401, error: "subscriptionId is required" };
  }

  if (isDemoMode()) return { ok: true, value: null };

  const { data, error } = await getSupabaseAdmin()
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("creem_subscription_id", subscriptionId)
    .maybeSingle();

  if (error) {
    console.error("[authz] ownership lookup failed:", error.message);
    return { ok: false, status: 403, error: "Could not verify subscription ownership" };
  }

  if (!data) {
    return { ok: false, status: 404, error: "Subscription not found" };
  }

  return { ok: true, value: null };
}

// ============================================================
// 2. 订阅归属校验（首次领取：webhook 尚未落地时的 checkout 成功回跳）
// ============================================================

interface ClaimableSubscription {
  creemSubscriptionId: string;
  customerId: string | null;
  productId: string | null;
  productName: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 从 Creem 返回体里安全地取值（不同 SDK 版本返回形态不完全一致） */
function readSubscriptionFields(raw: unknown): ClaimableSubscription {
  const root = (raw ?? {}) as Record<string, unknown>;

  const product = root.product;
  const productId =
    readString(product === undefined ? undefined : (product as Record<string, unknown>)?.id) ??
    readString(root.productId) ??
    readString(root.product_id) ??
    null;
  const productName =
    readString((product as Record<string, unknown>)?.name) ?? readString(root.productName) ?? null;

  const customer = root.customer;
  const customerId =
    readString(
      typeof customer === "string" ? customer : (customer as Record<string, unknown>)?.id,
    ) ??
    readString(root.customerId) ??
    readString(root.customer_id) ??
    null;

  const periodRaw = (root.currentPeriodEndDate ??
    root.current_period_end_date ??
    root.currentPeriodEnd) as string | Date | null | undefined;
  let currentPeriodEnd: string | null = null;
  if (periodRaw) {
    const d = new Date(periodRaw);
    if (!Number.isNaN(d.getTime())) currentPeriodEnd = d.toISOString();
  }

  return {
    creemSubscriptionId: readString(root.id) ?? "",
    customerId,
    productId,
    productName,
    status: readString(root.status),
    currentPeriodEnd,
  };
}

/**
 * 首次购买后前端带着 subscriptionId 回跳的场景：webhook 可能还没到，
 * subscriptions 表里查不到归属，因此改从 Creem 侧取回订阅再判断归属。
 *
 * 归属成立的两个证据（任一即可）：
 *  1) 订阅的 metadata.user_id === 当前用户（checkout 时由服务端写入，客户端无法篡改）
 *  2) 订阅的 customer.id === 该用户在库里已绑定的 creem_customer_id（续费 / 换设备场景）
 *
 * 攻击者即便拿到别人的 subscriptionId 也拿不到 metadata，因此无法通过。
 */
export async function assertClaimableSubscription(
  user: AuthedUser,
  subscriptionId: string,
): Promise<AuthzResult<ClaimableSubscription>> {
  if (!subscriptionId) {
    return { ok: false, status: 401, error: "subscriptionId is required" };
  }

  let raw: unknown;
  try {
    raw = await creem.subscriptions.get(subscriptionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Creem lookup failed";
    return { ok: false, status: 404, error: `Subscription not accessible: ${msg}` };
  }

  const sub = readSubscriptionFields(raw);
  const metaUserId = readString(
    ((raw as Record<string, unknown>)?.metadata as Record<string, unknown> | undefined)?.user_id,
  );

  if (metaUserId && metaUserId === user.id) {
    return { ok: true, value: sub };
  }

  if (!isDemoMode() && sub.customerId) {
    const { data } = await getSupabaseAdmin()
      .from("subscriptions")
      .select("creem_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (data?.creem_customer_id && data.creem_customer_id === sub.customerId) {
      return { ok: true, value: sub };
    }
  }

  return { ok: false, status: 403, error: "This subscription does not belong to this account" };
}

// ============================================================
// 3. 管理员校验
// ============================================================

/**
 * ADMIN_EMAIL 单一管理员（与 dashboard/admin/page.tsx 保持一致）。
 * 未配置 ADMIN_EMAIL 时一律拒绝 —— fail-closed，不允许「没配就放行」。
 */
export function assertAdmin(user: AuthedUser): AuthzResult<null> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) {
    console.error("[authz] ADMIN_EMAIL is not configured — admin action denied");
    return { ok: false, status: 403, error: "Admin access is not configured" };
  }
  if (!user.email || user.email !== adminEmail) {
    return { ok: false, status: 403, error: "Admin access required" };
  }
  return { ok: true, value: null };
}

// ============================================================
// 4. 审计日志
// ============================================================

export interface AuditEntry {
  user: AuthedUser;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  req?: NextRequest;
}

/**
 * 写审计日志（best-effort）。
 * demo 模式无库可写，跳过；生产写失败只记日志，不阻断主流程
 * —— 因为此时业务操作已经成功，返回 500 会让前端误以为操作失败。
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (isDemoMode()) return;
  try {
    const { error } = await getSupabaseAdmin()
      .from("audit_log")
      .insert({
        actor_user_id: entry.user.id,
        actor_email: entry.user.email ?? null,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId ?? null,
        metadata: entry.metadata ?? {},
        ip: requestIp(entry.req),
        user_agent: entry.req?.headers.get("user-agent")?.slice(0, 256) ?? null,
      });
    if (error) console.error("[audit] write failed:", error.message);
  } catch (e) {
    console.error("[audit] write threw:", e instanceof Error ? e.message : e);
  }
}
