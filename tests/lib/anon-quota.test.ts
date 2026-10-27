import { describe, it, expect, vi } from "vitest";

// 非 demo 模式：匿名配额真实生效（默认每天 3 次）
vi.mock("@/lib/demo/mode", () => ({ isDemoMode: () => false }));

import { checkAnonGenerativeQuota, consumeAnonGenerativeQuota, getAnonQuotaStatus } from "@/lib/anon-quota";

describe("anon-quota (non-demo)", () => {
  it("fresh key starts with full quota", async () => {
    const k = `t-${Math.random()}`;
    const s = await checkAnonGenerativeQuota(k);
    expect(s.allowed).toBe(true);
    expect(s.remaining).toBe(s.limit);
    expect(s.limit).toBeGreaterThanOrEqual(1);
    expect(typeof s.resetAt).toBe("string");
  });

  it("exhausts exactly after `limit` consumptions", async () => {
    const k = `t-${Math.random()}`;
    const first = await checkAnonGenerativeQuota(k);
    for (let i = 0; i < first.limit; i++) await consumeAnonGenerativeQuota(k);
    const after = await checkAnonGenerativeQuota(k);
    expect(after.allowed).toBe(false);
    expect(after.remaining).toBe(0);
  });

  it("returns 429-class signal via remaining=0 (not negative)", async () => {
    const k = `t-${Math.random()}`;
    const first = await checkAnonGenerativeQuota(k);
    for (let i = 0; i < first.limit + 5; i++) await consumeAnonGenerativeQuota(k);
    expect((await checkAnonGenerativeQuota(k)).remaining).toBe(0);
  });

  it("different keys are independent", async () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    await consumeAnonGenerativeQuota(a);
    const sb = await checkAnonGenerativeQuota(b);
    expect(sb.remaining).toBe(sb.limit);
  });

  it("getAnonQuotaStatus mirrors check", async () => {
    const k = `t-${Math.random()}`;
    expect(await getAnonQuotaStatus(k)).toEqual(await checkAnonGenerativeQuota(k));
  });
});
