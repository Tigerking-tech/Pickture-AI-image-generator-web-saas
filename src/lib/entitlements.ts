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
