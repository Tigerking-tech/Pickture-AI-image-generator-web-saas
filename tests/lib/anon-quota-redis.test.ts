import { describe, it, expect, vi } from "vitest";

// 覆盖「配置了 UPSTASH env」时的 Redis 分支：用内存 fake 替换 @upstash/redis，
// 验证 check 走 get、consume 走 incr+expire。工厂在 import 前执行，故在此注入 env。
vi.mock("@upstash/redis", () => {
  process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || "https://fake";
  process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "tok";
  const store = new Map<string, number>();
  return {
    Redis: class {
      async get(k: string): Promise<number | null> {
        return store.has(k) ? (store.get(k) as number) : null;
      }
      async incr(k: string): Promise<number> {
        const v = (store.get(k) ?? 0) + 1;
        store.set(k, v);
        return v;
      }
      async expire(): Promise<number> {
        return 1;
      }
    },
  };
});
vi.mock("@/lib/demo/mode", () => ({ isDemoMode: () => false }));

import { checkAnonGenerativeQuota, consumeAnonGenerativeQuota } from "@/lib/anon-quota";

describe("anon-quota (redis path)", () => {
  it("counts through the redis client and decrements remaining", async () => {
    const k = `r-${Math.random()}`;
    const s0 = await checkAnonGenerativeQuota(k);
    expect(s0.allowed).toBe(true);
    expect(s0.remaining).toBe(s0.limit);

    await consumeAnonGenerativeQuota(k);
    await consumeAnonGenerativeQuota(k);

    const s1 = await checkAnonGenerativeQuota(k);
    expect(s1.remaining).toBe(s1.limit - 2);
  });
});
