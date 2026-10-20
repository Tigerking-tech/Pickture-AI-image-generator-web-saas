/**
 * 积分与配额（T7 / R5）
 *
 * 复用脚手架 002_expand.sql 的 credits 钱包与 spend_credits() 原子函数
 * （行级锁 for update，防并发超扣），不另建一套积分系统。
 *
 * 超额统一返回 HTTP 402（R5 验收要求），余额不足绝不静默成功。
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  CREDITS_PER_WORK,
  type ModelRoute,
  normalizePlan,
  type Plan,
  routeForPlan,
} from "./modelRouter";

export { CREDITS_PER_WORK };

export interface SpendResult {
  ok: boolean;
  /** 扣减后余额 */
  balance?: number;
  /** 失败原因 */
  reason?:
    | "insufficient_credits"
    | "no_credits_record"
    | "unauthenticated"
    | "invalid_amount"
    | "unknown";
  /** 建议 HTTP 状态码：超额 402（R5） */
  status?: number;
  message?: string;
}

export interface QuotaResult {
  ok: boolean;
  reason?: "monthly_limit" | "daily_limit" | "profile_not_found" | "unauthenticated" | "unknown";
  status?: number;
  usedMonth?: number;
  usedToday?: number;
  message?: string;
}

type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(db: { rpc: RpcFn }, fn: string, args: Record<string, unknown>) {
  return db.rpc(fn, args);
}

/** 读取用户套餐（未知一律降级 free） */
export async function getPlan(userId: string): Promise<Plan> {
  const db = getSupabaseAdmin();
  const { data } = await db.from("profiles").select("plan").eq("id", userId).maybeSingle();
  // admin 客户端在 demo 模式下返回 mock 客户端，类型不统一，此处做窄化断言
  return normalizePlan((data as { plan?: string | null } | null)?.plan);
}

/** 读取当前余额；无记录返回 null（区别于 0，避免误判为"已用完"） */
export async function getBalance(userId: string): Promise<number | null> {
  const db = getSupabaseAdmin();
  const { data } = await db.from("credits").select("balance").eq("user_id", userId).maybeSingle();
  const balance = (data as { balance?: number } | null)?.balance;
  return typeof balance === "number" ? balance : null;
}

/**
 * 原子扣积分。
 * 底层 spend_credits() 在余额不足时 raise exception，此处翻译成结构化的 402。
 */
export async function spendCredits(
  userId: string,
  amount: number,
  reason: string,
): Promise<SpendResult> {
  if (!userId) {
    return { ok: false, reason: "unauthenticated", status: 401, message: "Not signed in" };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "invalid_amount", status: 400, message: "Invalid amount" };
  }

  const db = getSupabaseAdmin();
  const { data, error } = await rpc(db, "spend_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  });

  if (error) {
    const msg = error.message ?? "";
    // 脚手架 spend_credits 的两种失败语义
    if (msg.includes("Insufficient credits")) {
      return {
        ok: false,
        reason: "insufficient_credits",
        status: 402,
        message: "Not enough credits. Upgrade your plan or buy a credit pack.",
      };
    }
    if (msg.includes("No credits record")) {
      return {
        ok: false,
        reason: "no_credits_record",
        status: 402,
        message: "No credits record for this account",
      };
    }
    return { ok: false, reason: "unknown", status: 500, message: msg };
  }

  // -1 表示无限额度（脚手架约定）
  const balance = typeof data === "number" ? data : Number(data);
  return { ok: true, balance: Number.isFinite(balance) ? balance : undefined };
}

/** 扣一个作品的积分（10 分） */
export function spendOneWork(userId: string, reason = "work"): Promise<SpendResult> {
  return spendCredits(userId, CREDITS_PER_WORK, reason);
}

/**
 * 参考图上传配额（PRD §10.2.1）：免费 月≤8 / 日≤3，Starter 月≤50，Pro 不限。
 * 底层 consume_ref_upload_quota() 原子递增，超限返回 ok=false。
 */
export async function consumeRefUploadQuota(userId: string, plan: unknown): Promise<QuotaResult> {
  if (!userId) {
    return { ok: false, reason: "unauthenticated", status: 401 };
  }
  const route: ModelRoute = routeForPlan(plan);
  const db = getSupabaseAdmin();

  const { data, error } = await rpc(db, "consume_ref_upload_quota", {
    p_month_max: route.refUploadMonthlyLimit,
    p_day_max: route.refUploadDailyLimit,
    p_user_id: userId,
  });

  if (error) {
    return { ok: false, reason: "unknown", status: 500, message: error.message };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    used_month?: number;
    used_today?: number;
  };

  if (result.ok === false) {
    return {
      ok: false,
      reason: (result.reason as QuotaResult["reason"]) ?? "unknown",
      status: 402,
      message:
        result.reason === "monthly_limit"
          ? "Monthly reference-image upload limit reached"
          : "Daily reference-image upload limit reached",
    };
  }

  return { ok: true, usedMonth: result.used_month, usedToday: result.used_today };
}

/**
 * 跨月补齐订阅积分（复用 003 的 ensure_quota_periods 逻辑）。
 * 用 greatest(balance, grant) 保护已购积分不过期（PRD §10.2：充值包不过期）。
 */
export async function ensureMonthlyGrant(userId: string): Promise<number | null> {
  const db = getSupabaseAdmin();
  const { error } = await rpc(db, "ensure_quota_periods", { p_user: userId });
  if (error) return null;
  return await getBalance(userId);
}
