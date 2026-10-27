import { describe, expect, it } from "vitest";
import {
  CREDIT_UNLIMITED,
  creditsForIntent,
  creditsForIntents,
  planMonthlyCredits,
} from "@/lib/credits";

/**
 * 验证「fal token 成本 → 客户积分」的换算与利润保证。
 * 默认参数：CREDIT_UNIT_USD=0.01（1 credit ≡ 1¢ 生成成本）、MARGIN_MULTIPLE=2.5。
 */
describe("credit conversion & profit guarantee", () => {
  it("charges 5 credits for a $0.02 generative op (2.5x margin)", () => {
    expect(creditsForIntent("swap_background")).toBe(5);
    expect(creditsForIntent("remove_object")).toBe(5);
    expect(creditsForIntent("style_transfer")).toBe(5);
    expect(creditsForIntent("extend_image")).toBe(5);
  });

  it("charges 2 credits for upscale ($0.005)", () => {
    expect(creditsForIntent("upscale")).toBe(2);
  });

  it("never charges below the per-op minimum (2)", () => {
    expect(creditsForIntent("swap_background")).toBeGreaterThanOrEqual(2);
    expect(creditsForIntent("upscale")).toBeGreaterThanOrEqual(2);
  });

  it("sums multi-intent edits (hybrid)", () => {
    expect(creditsForIntents(["swap_background", "change_text"])).toBe(10);
  });

  it("guarantees profit on the cheapest plan (Max: $19 / 2000 credits)", () => {
    const monthly = planMonthlyCredits("max"); // 2000
    expect(monthly).toBe(2000);
    const revenuePerCredit = 19 / monthly; // $0.0095
    const opCostUsd = 0.02;
    const creditsPerOp = creditsForIntent("swap_background"); // 5
    const revenuePerOp = creditsPerOp * revenuePerCredit; // $0.0475

    // 单次操作毛利 > 0
    expect(revenuePerOp).toBeGreaterThan(opCostUsd); // ≈ 2.4x

    // 即便额度全部用于 $0.02 操作，仍有净利
    const ops = Math.floor(monthly / creditsPerOp); // 400
    const totalCost = ops * opCostUsd; // $8
    expect(19 - totalCost).toBeGreaterThan(0); // 净利 $11
  });

  it("grants unlimited (-1) for enterprise", () => {
    expect(planMonthlyCredits("enterprise")).toBe(CREDIT_UNLIMITED);
  });

  it("aligns plan grants with the public pricing page", () => {
    expect(planMonthlyCredits("free")).toBe(5);
    expect(planMonthlyCredits("pro")).toBe(200);
    expect(planMonthlyCredits("max")).toBe(2000);
  });
});
