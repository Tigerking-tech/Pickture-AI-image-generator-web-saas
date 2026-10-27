import { describe, expect, test } from "vitest";
import { CREDIT_UNLIMITED, getCreditAllocation, isUnlimited } from "@/app/api/credits/helpers";

describe("getCreditAllocation", () => {
  test("returns -1 (unlimited) for enterprise", () => {
    expect(getCreditAllocation("enterprise")).toBe(CREDIT_UNLIMITED);
  });

  test("returns 200 for pro", () => {
    expect(getCreditAllocation("pro")).toBe(200);
  });

  test("returns 2000 for max", () => {
    expect(getCreditAllocation("max")).toBe(2000);
  });

  test("returns 5 for free", () => {
    expect(getCreditAllocation("free")).toBe(5);
  });

  test("is case-insensitive and handles aliases (scale→max, starter→free)", () => {
    expect(getCreditAllocation("Enterprise")).toBe(CREDIT_UNLIMITED);
    expect(getCreditAllocation("PRO")).toBe(200);
    expect(getCreditAllocation("Scale")).toBe(2000);
    expect(getCreditAllocation("Starter")).toBe(5);
  });

  test("unknown plan falls back to free (5)", () => {
    expect(getCreditAllocation("nonexistent")).toBe(5);
  });
});

describe("isUnlimited", () => {
  test("returns true for CREDIT_UNLIMITED (-1)", () => {
    expect(isUnlimited(CREDIT_UNLIMITED)).toBe(true);
  });

  test("returns false for 0", () => {
    expect(isUnlimited(0)).toBe(false);
  });

  test("returns false for positive balance", () => {
    expect(isUnlimited(500)).toBe(false);
  });
});
