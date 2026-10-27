import { describe, it, expect, vi } from "vitest";

// demo 模式：fal 为 mock 不烧钱，匿名配额应短路放行且永不消耗
vi.mock("@/lib/demo/mode", () => ({ isDemoMode: () => true }));

import { checkAnonGenerativeQuota, consumeAnonGenerativeQuota } from "@/lib/anon-quota";

describe("anon-quota (demo exempt)", () => {
  it("demo mode always allows and never consumes", async () => {
    const k = `d-${Math.random()}`;
    const s = await checkAnonGenerativeQuota(k);
    expect(s.allowed).toBe(true);
    // 即便多次"消费"，剩余额度也不应下降
    await consumeAnonGenerativeQuota(k);
    await consumeAnonGenerativeQuota(k);
    const s2 = await checkAnonGenerativeQuota(k);
    expect(s2.allowed).toBe(true);
    expect(s2.remaining).toBe(s2.limit);
  });
});
