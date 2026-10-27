import { beforeEach, describe, expect, test, vi } from "vitest";

// 本次安全加固新增的闸门，必须在非 demo 模式下断言（demo 模式会短路放行）
vi.mock("@/lib/demo/mode", () => ({ isDemoMode: () => false }));

describe("anon quota gate is atomic", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ANON_GENERATIVE_DAILY_LIMIT = "3";
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  test("sequential: the 4th attempt is refused", async () => {
    const { tryConsumeAnonGenerativeQuota } = await import("@/lib/anon-quota");
    const key = `test-seq-${Math.random()}`;
    expect((await tryConsumeAnonGenerativeQuota(key)).allowed).toBe(true);
    expect((await tryConsumeAnonGenerativeQuota(key)).allowed).toBe(true);
    expect((await tryConsumeAnonGenerativeQuota(key)).allowed).toBe(true);
    expect((await tryConsumeAnonGenerativeQuota(key)).allowed).toBe(false);
  });

  test("concurrent: at most `limit` requests pass — this is what check-then-act got wrong", async () => {
    const { tryConsumeAnonGenerativeQuota } = await import("@/lib/anon-quota");
    const key = `test-conc-${Math.random()}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => tryConsumeAnonGenerativeQuota(key)),
    );
    expect(results.filter((r) => r.allowed).length).toBe(3);
  });

  test("refund restores one slot", async () => {
    const mod = await import("@/lib/anon-quota");
    const key = `test-refund-${Math.random()}`;
    await mod.tryConsumeAnonGenerativeQuota(key);
    await mod.tryConsumeAnonGenerativeQuota(key);
    await mod.refundAnonGenerativeQuota(key);
    expect((await mod.tryConsumeAnonGenerativeQuota(key)).allowed).toBe(true);
  });
});

describe("webhook status mapping", () => {
  test("normalises Creem spellings to values allowed by the CHECK constraint", async () => {
    const { normalizeStatus } = await import("@/app/api/webhooks/creem/handlers");
    expect(normalizeStatus("canceled", "subscription.canceled")).toBe("cancelled");
    expect(normalizeStatus("unpaid", "subscription.unpaid")).toBe("past_due");
    expect(normalizeStatus("active", "subscription.update")).toBe("active");
  });

  test("unknown values return null so the handler fails loudly instead of silently", async () => {
    const { normalizeStatus } = await import("@/app/api/webhooks/creem/handlers");
    expect(normalizeStatus("totally-unknown")).toBe(null);
    expect(normalizeStatus(undefined)).toBe(null);
  });
});

describe("pipeline input gates", () => {
  test("refuses an oversized base64 payload before decoding it", async () => {
    const { MAX_UPLOAD_BYTES, runEdit } = await import("@/lib/pipeline");
    // base64 长度 * 3/4 ≈ 解码后字节数
    const tooBig = "A".repeat(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 1000);
    const res = await runEdit({ intent: "resize_for_platform", imageBase64: tooBig });
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toMatch(/too large/i);
  });
});
