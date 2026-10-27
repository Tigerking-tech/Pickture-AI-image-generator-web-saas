import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * plans → 能力清单。
 *
 * 重要边界：这里是「能力元数据」，不是强制执行的权限中心。
 * 此前这张表里写着 api_access / webhooks / sso / audit_logs 四项，而它们在代码里
 * 没有任何实现，也没有任何一个服务端入口调用 hasAccess 去拦截 ——
 * 结果是：免费用户实质上能用全部功能（拦都没拦），同时定价页又把没做的东西卖给了客户。
 *
 * 已从不存在的列表里移除（等真正实现后再加回来，届时按下面的步骤接线）：
 *  1. 实现对应的服务端边界（API key 签发与校验 / 出站 webhook / SSO / 审计写入）
 *  2. 在对应的 API route 里调用 hasAccess(user.id, feature)
 *  3. 才把 feature 加进下面的 PLAN_FEATURES 并同步定价页文案
 */
export type Feature = "fidelity_verification" | "batch_processing" | "priority_support";

export const PLAN_FEATURES: Record<string, Feature[]> = {
  free: ["fidelity_verification"],
  pro: ["fidelity_verification", "batch_processing", "priority_support"],
  max: ["fidelity_verification", "batch_processing", "priority_support"],
  scale: ["fidelity_verification", "batch_processing", "priority_support"],
};

export function getPlanFeatures(productName: string): Feature[] {
  const key = productName.toLowerCase().split(" ")[0];
  return PLAN_FEATURES[key] ?? PLAN_FEATURES.free;
}

export function planHasFeature(productName: string, feature: Feature): boolean {
  return getPlanFeatures(productName).includes(feature);
}

/**
 * 服务端能力判定。
 *
 * 当前**没有调用方**：系统里暂时没有需要按计划拦截的功能边界
 * （所有计划都能用同一套编辑管线，差异只在额度，由 fair-use / credits 控制）。
 * 这条 TODO 是实现新的付费功能时必须接的一步，否则"付费墙"只存在于定价页：
 *   1. 实现该功能的服务端入口
 *   2. 在入口处调用 hasAccess(user.id, "<feature>")，false 时返回 402 并在响应里
 *      带上 code: "PLAN_REQUIRED"，让前端能给出升级提示
 *   3. 才允许在定价页承诺该功能
 */
/**
 * 规划：
 *  1. 实现该功能的入口
 *  2. 入口处调用 hasAccess(user.id, "<feature>")，false 返回 402 + code: "PLAN_REQUIRED"
 *  3. 然后才能把 feature 加回 PLAN_FEATURES 并同步定价页文案
 */
// 注意：它是 export，lint 不会报未使用；真正要防止的是"有 the gate 却没人调用"。
export async function hasAccess(userId: string, feature: Feature): Promise<boolean> {
  const db = getSupabaseAdmin();

  const { data: subscription } = await db
    .from("subscriptions")
    .select("product_name, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (subscription) {
    return planHasFeature(subscription.product_name, feature);
  }

  return false;
}

/**
 * 解析登录用户当前生效的计划（free / pro / max / enterprise）。
 * 依据：subscriptions 表中 status=active 的订阅 product_name。
 * 无订阅 / 查询失败 → 回退 free（匿名与未订阅用户都按 free 档计 fair-use）。
 * 兼容 "Surepix Pro" / "Pro" / "pro" 等多种 product_name 写法。
 */
export async function resolveUserPlan(userId: string): Promise<string> {
  try {
    const db = getSupabaseAdmin();
    const { data: subscription } = await db
      .from("subscriptions")
      .select("product_name, status")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (!subscription?.product_name) return "free";
    const p = subscription.product_name.toLowerCase();
    if (p.includes("enterprise")) return "enterprise";
    if (p.includes("scale") || p.includes("max")) return "max";
    if (p.includes("pro")) return "pro";
    return "free";
  } catch {
    return "free";
  }
}
