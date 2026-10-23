/**
 * 套餐差异化：每节点候选图数量（免费 4 / 付费 9）
 *
 * 为什么需要（2026-10-23 真实模型实测）：
 *   一律 9 候选时，网格失败回退串行会变成 9 次真实出图调用，
 *   实测把一个节点的额度烧掉大半，用户走到最后一步反而出不了终图。
 *   免费档压到 4（2x2 网格）守住成本，付费档放开到 9（3x3 网格）。
 */
import { describe, expect, it } from "vitest";
import { candidatesForPlan } from "@/lib/modelRouter";

describe("套餐 → 每节点候选数", () => {
  it("免费档 4 个候选（2x2 网格，守住免费额度）", () => {
    expect(candidatesForPlan("free")).toBe(4);
  });

  it("付费档 9 个候选（3x3 网格）", () => {
    expect(candidatesForPlan("starter")).toBe(9);
    expect(candidatesForPlan("pro")).toBe(9);
  });

  it("enterprise 按付费处理", () => {
    expect(candidatesForPlan("enterprise")).toBe(9);
  });

  it("未知/缺失/异常入参一律降级为免费档，绝不放开到 9", () => {
    expect(candidatesForPlan(undefined)).toBe(4);
    expect(candidatesForPlan(null)).toBe(4);
    expect(candidatesForPlan("")).toBe(4);
    expect(candidatesForPlan("hacker")).toBe(4);
    expect(candidatesForPlan("PRO")).toBe(9); // 大小写不敏感，仍按付费
  });

  it("免费档候选数必须小于付费档，且都在网格能力区间内", () => {
    const free = candidatesForPlan("free");
    const paid = candidatesForPlan("pro");
    expect(free).toBeLessThan(paid);
    expect(free).toBeGreaterThanOrEqual(2);
    expect(paid).toBeLessThanOrEqual(9);
  });
});
