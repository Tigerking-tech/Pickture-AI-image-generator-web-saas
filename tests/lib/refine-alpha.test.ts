/**
 * 边缘后处理的单元测试（合成数据，不依赖模型）。
 *
 * 起因：2026-10 二次返工。语义分割本身没错，但输出直接上屏还是能看到
 * 「台阶 + 毛刺」——因为 1024 的 mask 放大到原图后，每一级台阶都被放大成
 * 1px 的直角。修法是把 mask 当几何区域：EDT 距离场 → 高斯平滑 → 窄羽化。
 *
 * 这里用可枚举的合成图形锁住三件事：
 *   1. EDT 算得对（否则距离场一切皆错）
 *   2. 锯齿边界被磨平（本次事故的直接判据）
 *   3. 小岛被去掉、内部空洞被填上（语义分割的常见脏点）
 */
import { describe, expect, it } from "vitest";
import { edt, refineAlpha } from "../../src/lib/rmbg";

/**
 * 沿 n 个方向做径向扫描，线性插值出 alpha = 0.5 的亚像素半径。
 * 用亚像素是为了让测量本身不带 ±0.5px 的量化噪声——否则测不出平滑度差异。
 */
function radii(alpha: Float64Array, w: number, h: number, n = 24): number[] {
  const cx = w / 2;
  const cy = h / 2;
  const out: number[] = [];
  const at = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) return 0;
    const wx = x - x0;
    const wy = y - y0;
    const p00 = alpha[y0 * w + x0];
    const p10 = alpha[y0 * w + x0 + 1];
    const p01 = alpha[(y0 + 1) * w + x0];
    const p11 = alpha[(y0 + 1) * w + x0 + 1];
    return (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy;
  };
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    let prev = 0;
    let prevR = 0;
    let hit = -1;
    for (let r = 0.5; r < Math.min(w, h) / 2; r += 0.25) {
      const v = at(cx + dx * r, cy + dy * r);
      if (v < 0.5) {
        // prev(>=0.5) → v(<0.5) 之间线性插值
        const t = (prev - 0.5) / Math.max(1e-6, prev - v);
        hit = prevR + t * (r - prevR);
        break;
      }
      prev = v;
      prevR = r;
    }
    out.push(hit > 0 ? hit : prevR);
  }
  return out;
}

const std = (a: number[]) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};

describe("edt", () => {
  it("一维情形与手算一致", () => {
    const d = edt(new Uint8Array([0, 1, 1, 1, 0]), 5, 1);
    expect(Array.from(d)).toEqual([0, 1, 2, 1, 0]);
  });

  it("二维圆盘的圆心距离等于半径", () => {
    const w = 41;
    const h = 41;
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (Math.hypot(x - 20, y - 20) <= 12) m[y * w + x] = 1;
      }
    }
    const d = edt(m, w, h);
    expect(d[20 * w + 20]).toBeGreaterThan(11);
    expect(d[20 * w + 20]).toBeLessThan(13);
    expect(d[0]).toBe(0);
  });
});

describe("refineAlpha", () => {
  const W = 240;
  const H = 240;

  /**
   * 带 3px 方块台阶的圆：模拟「1024 mask 双线性放大到 1200」的产物——
   * 边界是一级一级的直角，而不是光滑曲线。这正是肉眼看到的锯齿。
   */
  function jaggedDisc(): Float64Array {
    const a = new Float64Array(W * H);
    const step = 3;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cx = (Math.floor(x / step) + 0.5) * step;
        const cy = (Math.floor(y / step) + 0.5) * step;
        a[y * W + x] = Math.hypot(cx - W / 2, cy - H / 2) <= 70 ? 1 : 0;
      }
    }
    return a;
  }

  /**
   * 这里测的是「0.5 等值线的半径波动」，不是最终观感。
   *
   * 需要说清一个物理上限：3px 方块化的圆在像素网格上已经是"多边形"，
   * 任何滤波都只能把它拉直一点，不可能还原成解析圆——剩下的 ~0.6px 抖动
   * 是采样极限，不是算法缺陷。它之所以看不出来，是因为 alpha 本身有
   * 1.8px 羽化带，人眼看到的是灰度渐变而不是那条等值线。
   *
   * 所以断言只要求"显著下降 + 归到亚像素量级"，不假装能归零。
   */
  it("锯齿边界被磨平（半径波动显著下降）", () => {
    const raw = jaggedDisc();
    const before = std(radii(raw, W, H, 48));
    const { alpha } = refineAlpha(raw, W, H);
    const after = std(radii(alpha, W, H, 48));

    expect(before).toBeGreaterThan(0.7); // 合成数据确实带锯齿（3px 台阶 → 半径波动 ~±1px）
    expect(after).toBeLessThan(before * 0.75); // 至少压掉四分之一
    expect(after).toBeLessThan(0.7); // 绝对水平：亚像素
  });

  it("轮廓尺度基本不变（平滑不能把主体吃小或撑大）", () => {
    const raw = jaggedDisc();
    const { alpha } = refineAlpha(raw, W, H);
    const r = radii(alpha, W, H, 48);
    const mean = r.reduce((s, v) => s + v, 0) / r.length;
    expect(mean).toBeGreaterThan(66);
    expect(mean).toBeLessThan(74);
  });

  it("alpha 是软过渡而非二值（边缘不能是剪刀边）", () => {
    const { alpha } = refineAlpha(jaggedDisc(), W, H);
    let soft = 0;
    for (const v of alpha) if (v > 0.1 && v < 0.9) soft++;
    // 周长约 440px，过渡带 ~2px
    expect(soft).toBeGreaterThan(300);
  });

  it("去掉孤立小岛", () => {
    const raw = jaggedDisc();
    for (let y = 10; y < 16; y++) for (let x = 10; x < 16; x++) raw[y * W + x] = 1;
    const { alpha, kept } = refineAlpha(raw, W, H);
    expect(kept).toBe(1);
    expect(alpha[12 * W + 12]).toBeLessThan(0.05);
  });

  it("填上主体内部的空洞", () => {
    const raw = jaggedDisc();
    for (let y = 115; y < 125; y++) for (let x = 115; x < 125; x++) raw[y * W + x] = 0;
    const { alpha } = refineAlpha(raw, W, H);
    expect(alpha[120 * W + 120]).toBeGreaterThan(0.95);
  });

  it("全背景输入不会崩，且输出全透明", () => {
    const raw = new Float64Array(W * H);
    const { alpha } = refineAlpha(raw, W, H);
    expect(alpha.every((v) => v === 0)).toBe(true);
  });
});
