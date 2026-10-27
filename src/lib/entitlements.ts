import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type Feature =
  | "fidelity_verification"
  | "batch_processing"
  | "api_access"
  | "webhooks"
  | "custom_presets"
  | "sso"
  | "audit_logs"
  | "priority_support";

export const PLAN_FEATURES: Record<string, Feature[]> = {
  free: ["fidelity_verification"],
  pro: [
    "fidelity_verification",
    "batch_processing",
    "custom_presets",
    "priority_support",
  ],
  scale: [
    "fidelity_verification",
    "batch_processing",
    "api_access",
    "webhooks",
    "custom_presets",
    "sso",
    "audit_logs",
    "priority_support",
  ],
};

export function getPlanFeatures(productName: string): Feature[] {
  const key = productName.toLowerCase().split(" ")[0];
  return PLAN_FEATURES[key] ?? [];
}

export function planHasFeature(productName: string, feature: Feature): boolean {
  return getPlanFeatures(productName).includes(feature);
}

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
