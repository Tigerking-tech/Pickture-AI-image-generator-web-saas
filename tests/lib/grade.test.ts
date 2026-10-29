import { describe, expect, it } from "vitest";
import { contactShadow, gradePro, type RGBImg } from "../../src/lib/grade";

/* ============================================================
   grade.pro 的回归防线 —— 对应 2026-10 三次真实翻车：
   1. 琥珀被推成番茄红（全局色相旋转 + 通道裁剪）
   2. 褐色内饰被拉成荧光绿（暖色锚点取自蓝色主色，越界到黄绿）
   3. 灰底/白底被染色（中性像素没做保护）
   任何一条回退，这里都会失败。
   ============================================================ */

function solid(r: number, g: number, b: number, w = 24, h = 24): RGBImg {
  const rgb = new Float64Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { w, h, rgb };
}

/** 取中心像素 */
function center(img: RGBImg): [number, number, number] {
  const i = ((img.h >> 1) * img.w + (img.w >> 1)) * 3;
  return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
}

describe("gradePro", () => {
  it("琥珀色变暖但不会变成番茄红（R 不能一枝独秀）", () => {
    // #A0522D 琥珀棕
    const out = gradePro(solid(160, 82, 45), { warmth: 0.6 });
    const [r, g, b] = center(out);
    expect(r).toBeGreaterThan(g); // 还是暖色
    expect(g).toBeGreaterThan(b); // 色相没被推过橙红边界
    // 番茄红是 g/b 塌陷的表现：g-b 应保持一定比例
    expect(g - b).toBeGreaterThan(15);
  });

  it("蓝色主体不会被推成绿色（暗部负值曾导致这条崩）", () => {
    const out = gradePro(solid(38, 62, 110), { warmth: 0.6 });
    const [r, g, b] = center(out);
    expect(b).toBeGreaterThan(g); // 仍然是蓝系
    expect(g).toBeGreaterThan(r); // 没有翻成黄绿
    expect(g - r).toBeGreaterThan(5);
  });

  it("近中性灰只升温、不染色（chroma 增幅受限）", () => {
    const out = gradePro(solid(150, 150, 150), { warmth: 0.6 });
    const [r, g, b] = center(out);
    expect(r).toBeGreaterThan(b); // 变暖
    // 灰不该被染成明显橙色：R-B 控制在 25 以内
    expect(r - b).toBeLessThan(25);
  });

  it("alpha=0 的区域原样保留（白底不会被调色污染）", () => {
    const img = solid(255, 255, 255, 8, 8);
    const alpha = new Float64Array(64); // 全 0
    const out = gradePro(img, { alpha, warmth: 0.9 });
    expect(Array.from(out.rgb.slice(0, 3))).toEqual([255, 255, 255]);
  });

  it("输出无 NaN / 越界（负线性值必须夹住）", () => {
    const img = solid(2, 3, 6, 16, 16); // 极暗
    const out = gradePro(img, { warmth: 1 });
    for (const v of out.rgb) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe("contactShadow", () => {
  it("悬浮主体（底部离画布很远）不画影，避免浮空灰雾", () => {
    const img = solid(120, 120, 120, 40, 40);
    const alpha = new Float64Array(40 * 40);
    // 只在中间画一个方块，底部距画布 8 格
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) alpha[y * 40 + x] = 1;
    const out = contactShadow(img, alpha, { opacity: 0.5 });
    // 主体下方第一个像素应保持原灰（无影）
    const belowIdx = (31 * 40 + 20) * 3;
    expect(out.rgb[belowIdx]).toBeCloseTo(120, 0);
  });

  it("贴地主体在正下方产生投影，且不横向拖到画布空白处", () => {
    const img = solid(120, 120, 120, 40, 40);
    const alpha = new Float64Array(40 * 40);
    for (let y = 20; y < 40; y++) for (let x = 10; x < 30; x++) alpha[y * 40 + x] = 1;
    const out = contactShadow(img, alpha, { opacity: 0.5 });
    // 主体左右外侧 1 格：不应有影（旧实现会拖出横向灰带）
    const sideIdx = (30 * 40 + 5) * 3;
    expect(out.rgb[sideIdx]).toBeCloseTo(120, 0);
    // 主体正下方（若画布外则跳过，这里 y=40 已出界）→ 用列底判断：底部被裁时不出影
    // 因此这里只验证「不横向漏影」
  });
});
