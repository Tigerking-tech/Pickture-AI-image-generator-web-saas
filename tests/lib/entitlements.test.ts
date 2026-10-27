import { beforeEach, describe, expect, test, vi } from "vitest";
import { getPlanFeatures, hasAccess, PLAN_FEATURES, planHasFeature } from "@/lib/entitlements";

// Mock Supabase admin for hasAccess tests
const mockMaybeSingle = vi.fn();
const mockEqStatus = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEqUser = vi.fn(() => ({ eq: mockEqStatus }));
const mockSelect = vi.fn(() => ({ eq: mockEqUser }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({ from: mockFrom }),
}));

// 说明：本文件此前断言的是上一代计划模型（starter / enterprise + analytics / api / sso /
// unlimited_team / custom_integrations），与实际实现早已不一致，属于过期测试。
// 现在按当前真实的费率档位（free / pro / max / scale）与能力集合重写。

describe("PLAN_FEATURES", () => {
  test("free 只含保真校验", () => {
    expect(PLAN_FEATURES.free).toEqual(["fidelity_verification"]);
  });

  test("pro 含批处理与优先支持", () => {
    expect(PLAN_FEATURES.pro).toContain("batch_processing");
    expect(PLAN_FEATURES.pro).toContain("priority_support");
    expect(PLAN_FEATURES.pro).toContain("fidelity_verification");
  });

  test("max / scale 至少覆盖 pro 的能力", () => {
    for (const f of PLAN_FEATURES.pro) {
      expect(PLAN_FEATURES.max).toContain(f);
      expect(PLAN_FEATURES.scale).toContain(f);
    }
  });

  test("未实现的能力不在任何计划里（防止又去卖做不了的东西）", () => {
    const all = Object.values(PLAN_FEATURES).flat();
    for (const removed of ["sso", "audit_logs", "api_access", "webhooks"]) {
      expect(all).not.toContain(removed);
    }
  });
});

describe("getPlanFeatures", () => {
  test("returns free features for 'free'", () => {
    expect(getPlanFeatures("free")).toEqual(PLAN_FEATURES.free);
  });

  test("returns pro features for 'pro'", () => {
    expect(getPlanFeatures("pro")).toEqual(PLAN_FEATURES.pro);
  });

  test("unknown plan falls back to free instead of empty", () => {
    expect(getPlanFeatures("nonexistent")).toEqual(PLAN_FEATURES.free);
  });

  test("case-insensitive: 'Pro Plan' extracts 'pro'", () => {
    expect(getPlanFeatures("Pro Plan")).toEqual(PLAN_FEATURES.pro);
  });

  test("case-insensitive: 'SCALE' works", () => {
    expect(getPlanFeatures("SCALE")).toEqual(PLAN_FEATURES.scale);
  });
});

describe("planHasFeature", () => {
  test("pro has batch processing", () => {
    expect(planHasFeature("pro", "batch_processing")).toBe(true);
  });

  test("free lacks batch processing", () => {
    expect(planHasFeature("free", "batch_processing")).toBe(false);
  });

  test("scale has priority support", () => {
    expect(planHasFeature("scale", "priority_support")).toBe(true);
  });
});

describe("hasAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns true for active subscription with matching feature", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { product_name: "Pro Plan", status: "active" },
      error: null,
    });

    const result = await hasAccess("user-123", "batch_processing");
    expect(result).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("subscriptions");
    expect(mockSelect).toHaveBeenCalledWith("product_name, status");
    expect(mockEqUser).toHaveBeenCalledWith("user_id", "user-123");
    expect(mockEqStatus).toHaveBeenCalledWith("status", "active");
  });

  test("returns false when no subscription exists", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await hasAccess("user-456", "batch_processing");
    expect(result).toBe(false);
  });

  test("returns false when subscription lacks the feature", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { product_name: "Free Plan", status: "active" },
      error: null,
    });

    const result = await hasAccess("user-789", "batch_processing");
    expect(result).toBe(false);
  });
});
