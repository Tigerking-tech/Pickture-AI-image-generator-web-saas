import { describe, expect, it } from "vitest";
import { CREDIT_UNLIMITED, isUnlimited, validateSpendRequest } from "@/app/api/credits/helpers";

describe("isUnlimited", () => {
  it("returns true for CREDIT_UNLIMITED sentinel", () => {
    expect(isUnlimited(CREDIT_UNLIMITED)).toBe(true);
  });

  it("returns false for zero", () => {
    expect(isUnlimited(0)).toBe(false);
  });

  it("returns false for positive number", () => {
    expect(isUnlimited(100)).toBe(false);
  });
});

describe("validateSpendRequest", () => {
  it("accepts valid spend with intent", () => {
    const result = validateSpendRequest({ intent: "swap_background", description: "API call" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data.intent).toBe("swap_background");
  });

  it("rejects missing intent", () => {
    const result = validateSpendRequest({ description: "test" });
    expect(result.valid).toBe(false);
  });

  it("rejects empty string intent", () => {
    const result = validateSpendRequest({ intent: "" });
    expect(result.valid).toBe(false);
  });

  it("falls back to default description when omitted", () => {
    const result = validateSpendRequest({ intent: "upscale" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.data.description).toBe("Generative edit");
  });
});
