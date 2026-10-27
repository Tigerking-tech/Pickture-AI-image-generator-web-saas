/**
 * credits.ts — Surepix 积分账本与「API token 成本 → 客户积分」换算（服务端唯一真相源）
 *
 * 这是"我买的 API token"和"我给客户的积分"之间的换算与利润保证逻辑所在地。
 *
 * ── 成本锚点 ───────────────────────────────────────────────────────────
 * 生成式编辑走 fal.ai（FENERATIVE_PROVIDER=fal，持 FAL_KEY 预付余额），
 * fal 按"每次生成"计费：estimatedCostUsd(intent) 即真实成本
 *   · 背景替换 / 换材质 / 改色 / 加物 / 去物 / 改字 / 风格 / 扩图 ≈ $0.02（默认）
 *   · upscale（Real-ESRGAN）≈ $0.005（见 FAL_MODELS）
 *
 * ── 兑换率与毛利倍数（运营可调）─────────────────────────────────────────
 *   CREDIT_UNIT_USD    = $0.01  → 1 AI credit ≡ 1¢ 的生成成本（你 token 花费 ↔ 发放积分的汇率）
 *   MARGIN_MULTIPLE    = 2.5    → 你希望每次操作赚回 2.5× 真实成本作基线毛利
 *   MIN_CREDITS_PER_OP = 2      → 单次操作最少扣 2 分（防止模型降价到 0）
 *
 * ── 每次生成扣多少分（服务端算，客户端不可篡改）─────────────────────────
 *   credits = max(MIN, ceil(costUsd / CREDIT_UNIT_USD * MARGIN_MULTIPLE))
 *   → $0.02 操作扣 5 分；$0.005(upsacle) 扣 2 分
 *
 * ── 利润保证（以最便宜的 Max 计划验算）──────────────────────────────────
 *   Max：$19/月 得 2000 分 → 每分收入 $0.0095。一次 $0.02 生成扣 5 分 → 收 $0.0475，
 *   付 fal $0.02 → 毛利 2.4×；即便 2000 分全花在 $0.02 操作（≈333 次），成本 $6.67 < 收入 $19。
 *   Pro：$7.50/200 分 → 每分 $0.0375，一次操作收入 $0.1875 vs 成本 $0.02 → 9× 毛利。
 *   结构性保证：扣额由服务端按 fal 成本×毛利倍数计算并乘以下限，客户端发来的 amount 不再被信任；
 *   原子 spend_credits RPC 防并发超扣；无限计划(-1)只记日志不扣；生成失败不扣费。
 */

import { isDemoMode } from "@/lib/demo/mode";
import { getDemoStore } from "@/lib/demo/store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { estimatedCostUsd } from "@/lib/generative";

// ============================================================
// 1. 常量（运营可调，环境变量覆盖）
// ============================================================

/** 无限额度哨兵值 */
export const CREDIT_UNLIMITED = -1;

/** 1 credit ≡ 多少美元的生成成本（你 token 花费 ↔ 发放积分的汇率） */
export const CREDIT_UNIT_USD = Number(process.env.CREDIT_UNIT_USD ?? 0.01);

/** 毛利倍数：每次操作赚回真实成本的多少倍（基线） */
export const MARGIN_MULTIPLE = Number(process.env.CREDIT_MARGIN_MULTIPLE ?? 2.5);

/** 单次生成操作最少扣分数 */
export const MIN_CREDITS_PER_OP = Number(process.env.CREDIT_MIN_PER_OP ?? 2);

export function isUnlimited(balance: number): boolean {
  return balance === CREDIT_UNLIMITED;
}

// ============================================================
// 2. 计划月额度（与定价页 Free/Pro/Max/Enterprise = 5/200/2000/custom 对齐）
// ============================================================

const PLAN_MONTHLY_CREDITS: Record<string, number> = {
  free: 5,
  starter: 5,
  pro: 200,
  max: 2000,
  scale: 2000,
  enterprise: CREDIT_UNLIMITED,
};

/** 归一化别名：starter→free、scale→max（历史/展示命名差异） */
function normalizePlan(plan: string): string {
  const p = (plan || "").toLowerCase();
  if (p === "starter") return "free";
  if (p === "scale") return "max";
  return p;
}

/** 某计划每月发放的生成式积分额度；未知计划回退免费档 */
export function planMonthlyCredits(plan: string): number {
  const key = normalizePlan(plan);
  if (key in PLAN_MONTHLY_CREDITS) return PLAN_MONTHLY_CREDITS[key];
  return PLAN_MONTHLY_CREDITS.free;
}

// ============================================================
// 3. 意图 → 扣分数（服务端换算，客户端不可篡改）
// ============================================================

let _overrides: Record<string, number> | null = null;
function intentOverrides(): Record<string, number> {
  if (_overrides) return _overrides;
  const raw = process.env.CREDIT_COST_OVERRIDES_JSON;
  _overrides = raw
    ? (() => {
        try {
          return JSON.parse(raw) as Record<string, number>;
        } catch {
          return {};
        }
      })()
    : {};
  return _overrides;
}

/** 某意图的真实 fal 成本（美元） */
export function intentCostUsd(intent: string): number {
  return estimatedCostUsd(intent as never);
}

/**
 * 某意图单次生成应扣的客户积分数。
 * 公式：max(MIN, ceil(costUsd / CREDIT_UNIT_USD * MARGIN_MULTIPLE))。
 * 允许用 CREDIT_COST_OVERRIDES_JSON 手工覆盖特定意图的积分价（运营促销）。
 */
export function creditsForIntent(intent: string): number {
  const ov = intentOverrides()[intent];
  if (typeof ov === "number" && ov > 0) return Math.max(1, Math.round(ov));
  const cost = intentCostUsd(intent);
  const credits = Math.ceil((cost / CREDIT_UNIT_USD) * MARGIN_MULTIPLE);
  return Math.max(MIN_CREDITS_PER_OP, credits);
}

/** 多个语义意图串接时（hybrid / 多意图）累计扣分数 */
export function creditsForIntents(intents: string[]): number {
  return intents.reduce((sum, i) => sum + creditsForIntent(i), 0);
}

// ============================================================
// 4. 账本（原子扣减 / 发放；demo 与真实 Supabase 双路径）
// ============================================================

export type LedgerResult =
  | { ok: true; balance: number; delta: number }
  | { ok: false; error: string; code?: "INSUFFICIENT" | "NO_WALLET" };

const DEMO_TX_PREFIX = "ct_demo_";

/** 查询当前余额（无限计划返回 CREDIT_UNLIMITED） */
export async function getBalance(userId: string): Promise<number> {
  if (isDemoMode()) {
    const w = getDemoStore().creditWallets.get(userId);
    return w?.balance ?? 0;
  }
  const { data } = await getSupabaseAdmin()
    .from("credits")
    .select("balance")
    .eq("user_id", userId)
    .single();
  return data?.balance ?? 0;
}

/** 余额是否足够本次操作（无限计划永远够） */
export async function hasCredits(userId: string, amount: number): Promise<boolean> {
  const bal = await getBalance(userId);
  return isUnlimited(bal) || bal >= amount;
}

/**
 * 扣减：传入若干语义意图，服务端换算成积分数后原子扣减。
 * 生成成功后才应调用。无限计划(-1)只记日志、不扣。
 */
export async function spendForIntents(
  userId: string,
  intents: string[],
  description: string,
): Promise<LedgerResult> {
  const amount = creditsForIntents(intents);
  if (amount <= 0) return { ok: true, balance: await getBalance(userId), delta: 0 };
  if (isDemoMode()) return spendDemo(userId, amount, description);
  const { data, error } = await getSupabaseAdmin().rpc("spend_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: description,
  });
  if (error) {
    return {
      ok: false,
      error: error.message,
      code: /insufficient/i.test(error.message) ? "INSUFFICIENT" : undefined,
    };
  }
  return { ok: true, balance: data as number, delta: -amount };
}

/**
 * 发放：订阅激活 / 续费 / 购买时调用，按 planMonthlyCredits 或显式数量充值。
 * 无限计划(-1)发放保持为 -1（不累加）。
 */
export async function grantCredits(
  userId: string,
  amount: number,
  type: "subscription_topup" | "purchase" | "refund",
  description: string,
): Promise<LedgerResult> {
  if (amount <= 0) return { ok: true, balance: await getBalance(userId), delta: 0 };
  if (isDemoMode()) return grantDemo(userId, amount, type, description);
  const { data, error } = await getSupabaseAdmin().rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_type: type,
    p_description: description,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, balance: data as number, delta: amount };
}

// ---- demo 路径（直接操作内存 store，与 supabase-mock 行为一致）----

function newDemoTx(user_id: string, amount: number, type: string, description: string) {
  return {
    id: `${DEMO_TX_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    user_id,
    amount,
    type,
    description,
    created_at: new Date().toISOString(),
  };
}

function spendDemo(userId: string, amount: number, description: string): LedgerResult {
  const store = getDemoStore();
  const wallet = store.creditWallets.get(userId);
  if (!wallet) return { ok: false, error: "No credits record", code: "NO_WALLET" };

  if (isUnlimited(wallet.balance)) {
    store.creditTransactions.set(
      `${DEMO_TX_PREFIX}${Date.now()}`,
      newDemoTx(userId, -amount, "spend", description),
    );
    return { ok: true, balance: wallet.balance, delta: -amount };
  }
  if (wallet.balance < amount) {
    return { ok: false, error: "Insufficient credits", code: "INSUFFICIENT" };
  }
  wallet.balance -= amount;
  store.creditWallets.set(userId, wallet);
  store.creditTransactions.set(
    `${DEMO_TX_PREFIX}${Date.now()}`,
    newDemoTx(userId, -amount, "spend", description),
  );
  return { ok: true, balance: wallet.balance, delta: -amount };
}

function grantDemo(
  userId: string,
  amount: number,
  type: string,
  description: string,
): LedgerResult {
  const store = getDemoStore();
  const wallet = store.creditWallets.get(userId) ?? { user_id: userId, balance: 0 };

  if (isUnlimited(wallet.balance)) {
    // 无限计划保持 -1，只记一笔授予日志
    store.creditTransactions.set(
      `${DEMO_TX_PREFIX}${Date.now()}`,
      newDemoTx(userId, 0, type, description),
    );
    return { ok: true, balance: wallet.balance, delta: 0 };
  }
  wallet.balance += amount;
  store.creditWallets.set(userId, wallet);
  store.creditTransactions.set(
    `${DEMO_TX_PREFIX}${Date.now()}`,
    newDemoTx(userId, amount, type, description),
  );
  return { ok: true, balance: wallet.balance, delta: amount };
}
