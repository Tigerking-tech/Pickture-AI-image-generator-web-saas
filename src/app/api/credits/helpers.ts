import type { ValidationResult } from "@/app/api/subscriptions/validators";

export const CREDIT_UNLIMITED = -1;

export function isUnlimited(balance: number): boolean {
  return balance === CREDIT_UNLIMITED;
}

/**
 * 计划月额度（与定价页 Free/Pro/Max/Enterprise = 5/200/2000/custom 对齐）。
 * 仅做展示/校验用途，真正的换算与扣减在 @/lib/credits（服务端模块）。
 */
const PLAN_CREDITS: Record<string, number> = {
  free: 5,
  starter: 5,
  pro: 200,
  max: 2000,
  scale: 2000,
  enterprise: CREDIT_UNLIMITED,
};

function normalizePlan(plan: string): string {
  const p = (plan || "").toLowerCase();
  if (p === "starter") return "free";
  if (p === "scale") return "max";
  return p;
}

export function getCreditAllocation(plan: string): number {
  const key = normalizePlan(plan);
  return key in PLAN_CREDITS ? PLAN_CREDITS[key] : PLAN_CREDITS.free;
}

export interface SpendData {
  /** 语义意图（如 swap_background），由服务端换算成扣分数——不再信任客户端 amount */
  intent: string;
  description?: string;
}

/** 校验扣费请求：只需意图，扣额由服务端 @/lib/credits.creditsForIntent 计算 */
export function validateSpendRequest(body: Record<string, unknown>): ValidationResult<SpendData> {
  const { intent, description } = body;

  if (typeof intent !== "string" || intent.trim() === "") {
    return { valid: false, error: "intent is required" };
  }

  return {
    valid: true,
    data: {
      intent: intent.trim(),
      description:
        typeof description === "string" && description.trim() !== ""
          ? description.trim()
          : "Generative edit",
    },
  };
}
