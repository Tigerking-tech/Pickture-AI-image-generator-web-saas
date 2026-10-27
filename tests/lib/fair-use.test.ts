import { describe, it, expect, vi } from "vitest";

// demo 模式短路：强制走真实计数路径
vi.mock("@/lib/demo/mode", () => ({ isDemoMode: () => false }));

import {
  checkFairUse,
  consumeFairUse,
  fairUseLimit,
  getFairUseStatus,
  type FairUseStatus,
} from "@/lib/fair-use";

// 内存降级存储为模块级单例，测试间用随机 key 隔离（不导出清空接口）

describe("fair-use 月度计数器", () => {
  it("free 计划每月上限 50 次确定性编辑", async () => {
    const anon = `free-${Math.random().toString(36).slice(2)}`;
    const first = await checkFairUse(undefined, anon, "free", "edits");
    expect(first.ok).toBe(true);
    expect(first.status.limit).toBe(50);
    expect(first.status.remaining).toBe(50);

    for (let i = 0; i < 50; i++) {
      await consumeFairUse(undefined, anon, "free", "edits");
    }
    const after = await checkFairUse(undefined, anon, "free", "edits");
    expect(after.ok).toBe(false);
    expect(after.status.used).toBe(50);
    expect(after.status.remaining).toBe(0);
  });

  it("enterprise 为无限（-1），永不饱和", async () => {
    const u = `ent-${Math.random().toString(36).slice(2)}`;
    expect(fairUseLimit("enterprise", "edits")).toBe(-1);
    const s: FairUseStatus = await getFairUseStatus(u, undefined, "enterprise", "edits");
    expect(s.unlimited).toBe(true);
    const c = await checkFairUse(u, undefined, "enterprise", "edits");
    expect(c.ok).toBe(true);
    // 无限计划消费应为 no-op
    await consumeFairUse(u, undefined, "enterprise", "edits");
    const s2 = await getFairUseStatus(u, undefined, "enterprise", "edits");
    expect(s2.used).toBe(0);
  });

  it("pro 上限 5000，edits 与 exports 并行计量", async () => {
    const u = `pro-${Math.random().toString(36).slice(2)}`;
    await consumeFairUse(u, undefined, "pro", "edits");
    await consumeFairUse(u, undefined, "pro", "exports");
    const e = await getFairUseStatus(u, undefined, "pro", "edits");
    const x = await getFairUseStatus(u, undefined, "pro", "exports");
    expect(e.limit).toBe(5000);
    expect(e.used).toBe(1);
    expect(x.used).toBe(1);
  });

  it("starter 归一为 free、scale 归一为 max", () => {
    expect(fairUseLimit("starter", "edits")).toBe(50);
    expect(fairUseLimit("scale", "exports")).toBe(15000);
  });

  it("登录用户与匿名使用独立 bucket", async () => {
    const u = `u-${Math.random().toString(36).slice(2)}`;
    const a = `a-${Math.random().toString(36).slice(2)}`;
    await consumeFairUse(u, undefined, "free", "edits");
    const us = await getFairUseStatus(u, undefined, "free", "edits");
    const as = await getFairUseStatus(undefined, a, "free", "edits");
    expect(us.used).toBe(1);
    expect(as.used).toBe(0);
  });

  it("无 userId 也无 anonKey 时回退匿名 bucket", async () => {
    const s = await getFairUseStatus(undefined, undefined, "free", "edits");
    expect(s).toHaveProperty("limit", 50);
  });
});
