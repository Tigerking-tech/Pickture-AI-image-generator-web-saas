/**
 * js-engine.ts — Surepix 参考编辑引擎（纯 TypeScript，无外部二进制）
 *
 * 目的：当 PhotoCraft CLI 不可用（离线 / 沙箱 / `DEMO_MODE`）时，提供一组
 * 白名单命令的确定性实现，使「确定性优先」管线仍可真实运行（而非静默返回原图
 * 或 422 报错）。它与 PhotoCraft 共享同一套命令语义，是生产引擎的**离线参考实现**，
 * 不是不同的产品：同样的 curves / brightnessContrast / hueSaturation 参数，
 * 两者应产生视觉一致的结果。
 *
 * 设计约束：
 *  - 实现白名单里「可纯算法复现」的命令：调色 / 几何 / 去背（边界漫水近似）
 *    / 文字水印（sharp 合成）。涉及 AI 主体识别的 select.subject 以背景蒙版取反
 *    近似，对纯色背景（demo 样片）效果一致；复杂背景为近似实现。
 *  - 确实无法复现的命令仍抛 UnsupportedCommandError，不假装能做。
 *  - 复用 fidelity.ts 的 PNG 编解码与 Img 结构（Float64 RGB），透明背景用 pngjs 直出 RGBA。
 *  - 几何命令会同时返回把「原图像素坐标」映射到「处理图像素坐标」的变换，
 *    供 fidelity.verify 用原图 manifest 比对（与 CLI 路径一致）。
 */

import { PNG as PngJs } from "pngjs";
import sharp from "sharp";
import { decodePng, encodePng, type Img } from "./fidelity";
import { contactShadow, gradePro } from "./grade";
import { bleedColor, segmentAlpha } from "./rmbg";

/** 带可选 alpha 的工作图（去透明背景时使用） */
type RgbaImg = { w: number; h: number; rgb: Float64Array; alpha?: Float64Array };

export class UnsupportedCommandError extends Error {
  constructor(cmd: string) {
    super(`reference engine does not implement "${cmd}" — requires the native PhotoCraft engine`);
    this.name = "UnsupportedCommandError";
  }
}

export interface ChainStep {
  cmd: string;
  params?: Record<string, unknown>;
}

export interface EngineRun {
  ok: boolean;
  img: Img;
  alpha?: Float64Array;
  /** 原图坐标 → 处理图坐标的映射：processed = (orig - translate) * scale */
  transform: { scale: [number, number]; translate: [number, number] };
  error?: string;
}

// ── 工具 ────────────────────────────────────────────────────────────────────

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** 参数取数：非有限值一律回退默认值（防止 NaN 传播整张图） */
function numOr(v: unknown, dflt: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** 单调三次插值（Fritsch–Carlson）构建 0-255 LUT，避免 overshoot 导致的伪影 */
function monotoneCubicLut(points: [number, number][]): Uint8Array {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const n = xs.length;
  // 分段斜率
  const m = new Array(n - 1).fill(0);
  for (let i = 0; i < n - 1; i++) m[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  // 切线（单调修正）
  const d = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) d[i] = m[0];
    else if (i === n - 1) d[i] = m[n - 2];
    else if (m[i - 1] * m[i] <= 0) d[i] = 0;
    else d[i] = (m[i - 1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = d[i];
    const b = d[i + 1];
    const h = xs[i + 1] - xs[i];
    if (a * h < 0 || b * h < 0 || a * a * h * h + b * b * h * h > h * h * h * h) {
      const common = (a + b) / 2;
      d[i] = common;
      d[i + 1] = common;
    }
  }
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    if (v <= xs[0]) lut[v] = clamp255(ys[0]);
    else if (v >= xs[n - 1]) lut[v] = clamp255(ys[n - 1]);
    else {
      let i = 0;
      while (i < n - 1 && xs[i + 1] < v) i++;
      const h = xs[i + 1] - xs[i];
      const t = (v - xs[i]) / h;
      const y0 = ys[i];
      const y1 = ys[i + 1];
      const dy = (y1 - y0) / h;
      const hi = (d[i] + d[i + 1] - 2 * dy) * h;
      const lo = 3 * dy - 2 * d[i] - d[i + 1];
      const val = y0 + d[i] * h * t + hi * t * t + lo * h * t * t * t;
      lut[v] = clamp255(val);
    }
  }
  return lut;
}

// ── 颜色空间 ────────────────────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d > 1e-9) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (((h % 360) + 360) % 360) / 360;
  s /= 100;
  l /= 100;
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

// ── 像素算子 ────────────────────────────────────────────────────────────────

type PixelFn = (r: number, g: number, b: number) => [number, number, number];

function mapPixels(img: Img, fn: PixelFn): Img {
  const rgb = new Float64Array(img.rgb.length);
  for (let i = 0; i < img.w * img.h; i++) {
    const [r, g, b] = fn(img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { w: img.w, h: img.h, rgb };
}

/** 双线性重采样到 (tw, th) */
function resize(img: Img, tw: number, th: number): Img {
  if (img.w === tw && img.h === th) return img;
  const out = new Float64Array(tw * th * 3);
  const sx = img.w / tw;
  const sy = img.h / th;
  for (let y = 0; y < th; y++) {
    const fy = Math.min(y * sy, img.h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, img.h - 1);
    const wy = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(x * sx, img.w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, img.w - 1);
      const wx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const p00 = img.rgb[(y0 * img.w + x0) * 3 + c];
        const p10 = img.rgb[(y0 * img.w + x1) * 3 + c];
        const p01 = img.rgb[(y1 * img.w + x0) * 3 + c];
        const p11 = img.rgb[(y1 * img.w + x1) * 3 + c];
        out[(y * tw + x) * 3 + c] =
          p00 * (1 - wx) * (1 - wy) + p10 * wx * (1 - wy) + p01 * (1 - wx) * wy + p11 * wx * wy;
      }
    }
  }
  return { w: tw, h: th, rgb: out };
}

/** 画布扩展 / 裁剪到 (W, H)，anchor 决定内容对齐，扩展区填充 extColor */
function canvas(
  img: Img,
  W: number,
  H: number,
  anchor: string,
  extColor: [number, number, number],
): Img {
  const out = new Float64Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    out[i * 3] = extColor[0];
    out[i * 3 + 1] = extColor[1];
    out[i * 3 + 2] = extColor[2];
  }
  let offX = 0;
  let offY = 0;
  const cw = img.w;
  const ch = img.h;
  const horizontal = anchor.includes("Left")
    ? "left"
    : anchor.includes("Right")
      ? "right"
      : "center";
  const vertical = anchor.includes("Top") ? "top" : anchor.includes("Bottom") ? "bottom" : "center";
  if (horizontal === "center") offX = Math.round((W - cw) / 2);
  else if (horizontal === "right") offX = W - cw;
  if (vertical === "center") offY = Math.round((H - ch) / 2);
  else if (vertical === "bottom") offY = H - ch;
  const x0 = Math.max(0, -offX);
  const y0 = Math.max(0, -offY);
  const x1 = Math.min(cw, W - offX);
  const y1 = Math.min(ch, H - offY);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + offX;
      const dy = y + offY;
      out[(dy * W + dx) * 3] = img.rgb[(y * cw + x) * 3];
      out[(dy * W + dx) * 3 + 1] = img.rgb[(y * cw + x) * 3 + 1];
      out[(dy * W + dx) * 3 + 2] = img.rgb[(y * cw + x) * 3 + 2];
    }
  }
  return { w: W, h: H, rgb: out };
}

/** 3x3 高斯模糊（用于智能锐化的低频分离） */
function gaussianBlur(img: Img, radius: number): Img {
  const r = Math.max(0.5, radius);
  const k = [1, 2, 1];
  // 两次 pass 的可分离卷积（近似）
  const tmp = new Float64Array(img.rgb.length);
  const w = img.w;
  const h = img.h;
  const sw = k[0] + k[1] + k[2];
  // 横向
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -1; i <= 1; i++) {
          const xx = Math.min(w - 1, Math.max(0, x + i));
          acc += img.rgb[(y * w + xx) * 3 + c] * k[i + 1];
        }
        tmp[(y * w + x) * 3 + c] = acc / sw;
      }
    }
  }
  const out = new Float64Array(img.rgb.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let i = -1; i <= 1; i++) {
          const yy = Math.min(h - 1, Math.max(0, y + i));
          acc += tmp[(yy * w + x) * 3 + c] * k[i + 1];
        }
        out[(y * w + x) * 3 + c] = acc / sw;
      }
    }
  }
  // 半径 >1 时再迭代一次强度（轻量近似）
  if (r > 1) return gaussianBlur({ w, h, rgb: out }, r - 1);
  return { w, h, rgb: out };
}

// ── 选区 / 去背 / 文字 ───────────────────────────────────────────────────────

/** 取像素 RGB */
function pxAt(img: Img, x: number, y: number): [number, number, number] {
  const i = (y * img.w + x) * 3;
  return [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 背景蒙版：从中位边框色出发，从四边漫水填充「与边框色相近」的连通区域。
 * 适用于纯色 / 近纯色背景（demo 样片均为纯灰底），对复杂背景是近似实现。
 * 返回 Uint8Array：1=背景，0=前景。
 */
export function backgroundMask(img: Img): Uint8Array {
  const { w, h, rgb } = img;
  const border: [number, number, number][] = [];
  for (let x = 0; x < w; x++) {
    border.push(pxAt(img, x, 0));
    border.push(pxAt(img, x, h - 1));
  }
  for (let y = 0; y < h; y++) {
    border.push(pxAt(img, 0, y));
    border.push(pxAt(img, w - 1, y));
  }
  const cr = median(border.map((b) => b[0]));
  const cg = median(border.map((b) => b[1]));
  const cb = median(border.map((b) => b[2]));
  const tol = 28;
  const tol2 = tol * tol * 3;
  const mask = new Uint8Array(w * h);
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  const tryPush = (x: number, y: number) => {
    const idx = y * w + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    const i = idx * 3;
    const dr = rgb[i] - cr;
    const dg = rgb[i + 1] - cg;
    const db = rgb[i + 2] - cb;
    if (dr * dr + dg * dg + db * db <= tol2) {
      mask[idx] = 1;
      queue.push(idx);
    }
  };
  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }
  while (queue.length) {
    const idx = queue.pop() as number;
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0) tryPush(x - 1, y);
    if (x < w - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < h - 1) tryPush(x, y + 1);
  }
  return mask;
}

function parseColor(s: string): [number, number, number] | null {
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  return null;
}

/** 编码带 alpha 的 RGBA PNG（pngjs 直出，避免改动 fidelity 的 RGB 编解码） */
function encodeRgba(img: RgbaImg, alpha: Float64Array): Buffer {
  const png = new PngJs({ width: img.w, height: img.h });
  for (let i = 0, j = 0; i < img.w * img.h; i++, j += 4) {
    png.data[j] = clamp255(Math.round(img.rgb[i * 3]));
    png.data[j + 1] = clamp255(Math.round(img.rgb[i * 3 + 1]));
    png.data[j + 2] = clamp255(Math.round(img.rgb[i * 3 + 2]));
    png.data[j + 3] = clamp255(Math.round(alpha[i] * 255));
  }
  return PngJs.sync.write(png);
}

function encodeImg(img: RgbaImg): Buffer {
  return img.alpha ? encodeRgba(img, img.alpha) : encodePng(img as Img);
}

/** 用 sharp 合成半透明文字水印（SVG overlay），质量优于位图字体 */
async function renderText(buf: Buffer, params?: Record<string, unknown>): Promise<Buffer> {
  const p = params ?? {};
  const text = String(p.text ?? "SUREPIX");
  const x = Number(p.x ?? 40);
  const y = Number(p.y ?? 40);
  const size = Number(p.size ?? 36);
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 1200;
  const H = meta.height ?? 900;
  const safe = text.replace(
    /[<>&]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string,
  );
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${x}" y="${y + size}" transform="rotate(-18 ${x} ${y})"
      font-family="Arial, Helvetica, sans-serif" font-size="${size}" font-weight="700"
      fill="#ffffff" fill-opacity="0.5" stroke="#000000" stroke-opacity="0.12"
      stroke-width="1">${safe}</text>
  </svg>`;
  return sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ── 命令实现 ────────────────────────────────────────────────────────────────

function applyCurves(img: Img, params: Record<string, unknown>): Img {
  const points = (params.points as [number, number][]) ?? [
    [0, 0],
    [255, 255],
  ];
  const lut = monotoneCubicLut(points as [number, number][]);
  return mapPixels(img, (r, g, b) => [lut[Math.round(r)], lut[Math.round(g)], lut[Math.round(b)]]);
}

function applyBrightnessContrast(img: Img, params: Record<string, unknown>): Img {
  const brightness = Number(params.brightness ?? 0);
  const contrast = Number(params.contrast ?? 0);
  const cf = (259 * (contrast + 255)) / (255 * (259 - contrast));
  return mapPixels(img, (r, g, b) => [
    clamp255(cf * (r - 128) + 128 + brightness),
    clamp255(cf * (g - 128) + 128 + brightness),
    clamp255(cf * (b - 128) + 128 + brightness),
  ]);
}

function applyHueSaturation(img: Img, params: Record<string, unknown>): Img {
  const hue = Number(params.hue ?? 0);
  const sat = Number(params.saturation ?? 0);
  const light = Number(params.lightness ?? 0);
  const sf = 1 + sat / 100;
  const lf = 1 + light / 100;
  return mapPixels(img, (r, g, b) => {
    let [h, s, l] = rgbToHsl(r, g, b);
    h = (h + hue) % 360;
    s = Math.max(0, Math.min(100, s * sf));
    l = Math.max(0, Math.min(100, l * lf));
    return hslToRgb(h, s, l);
  });
}

function applyLevels(img: Img, params: Record<string, unknown>): Img {
  const inB = Number(params.inBlack ?? 0);
  const inW = Number(params.inWhite ?? 255);
  const gamma = Number(params.gamma ?? 1);
  const denom = Math.max(1, inW - inB);
  return mapPixels(img, (r, g, b) => {
    const f = (v: number) => {
      const n = (v - inB) / denom;
      const c = n <= 0 ? 0 : n >= 1 ? 1 : n ** gamma;
      return clamp255(c * 255);
    };
    return [f(r), f(g), f(b)];
  });
}

function applySharpen(img: Img, params: Record<string, unknown>): Img {
  const amount = Number(params.amount ?? 80) / 100;
  const radius = Number(params.radius ?? 1.5);
  const low = gaussianBlur(img, radius);
  const out = new Float64Array(img.rgb.length);
  for (let i = 0; i < img.rgb.length; i++) {
    out[i] = clamp255(img.rgb[i] + amount * (img.rgb[i] - low.rgb[i]));
  }
  return { w: img.w, h: img.h, rgb: out };
}

// ── 调度 ────────────────────────────────────────────────────────────────────

const ADJUSTMENT_CMDS = new Set([
  "layer.newAdjustmentLayer.curves",
  "layer.newAdjustmentLayer.brightnessContrast",
  "layer.newAdjustmentLayer.hueSaturation",
  "layer.newAdjustmentLayer.levels",
]);

export function isToneEdit(chain: ChainStep[]): boolean {
  return chain.length > 0 && chain.every((s) => ADJUSTMENT_CMDS.has(s.cmd));
}

/** 执行链时可注入的上下文（预处理好的语义分割结果） */
export interface EngineContext {
  /** 前景 alpha（0-255，尺寸需与源图一致），来自 rmbg 模型 */
  alpha?: Uint8Array;
}

/** 需要主体分割的命令 */
function needsSegmentation(cmd: string): boolean {
  return cmd === "layer.removeBackground" || cmd === "select.subject";
}

/**
 * 执行一条命令链（按顺序叠加图层 / 几何变换）。
 * @returns 处理后的 Img 与坐标变换；遇到不支持的命令抛 UnsupportedCommandError。
 */
export function executeChain(src: Img, chain: ChainStep[], ctx?: EngineContext): EngineRun {
  let img: Img = { w: src.w, h: src.h, rgb: Float64Array.from(src.rgb) };
  let scale: [number, number] = [1, 1];
  let translate: [number, number] = [0, 0];
  let selection: Uint8Array | null = null;
  let resultAlpha: Float64Array | undefined;
  /** 语义分割的软 alpha（0-1），用于让填充/去背在边缘自然过渡，而非硬切 */
  let soft: Float64Array | null =
    ctx?.alpha && ctx.alpha.length === src.w * src.h
      ? Float64Array.from(ctx.alpha, (v) => v / 255)
      : null;
  /** 当前选区语义：主体的软 alpha 只有在这两种状态下才能正确混合 */
  let selKind: "none" | "subject" | "bg" = "none";
  /** 主体蒙版：调色/投影只作用于主体，白底不会被染色 */
  let subjectMask: Float64Array | null = null;

  for (const step of chain) {
    const p = (step.params ?? {}) as Record<string, unknown>;
    switch (step.cmd) {
      case "layer.newAdjustmentLayer.curves":
        img = applyCurves(img, p);
        break;
      case "layer.newAdjustmentLayer.brightnessContrast":
        img = applyBrightnessContrast(img, p);
        break;
      case "layer.newAdjustmentLayer.hueSaturation":
        img = applyHueSaturation(img, p);
        break;
      case "layer.newAdjustmentLayer.levels":
        img = applyLevels(img, p);
        break;
      // ── Surepix 自研算子（非 PhotoCraft 命令，语义对齐 Lightroom / Photoroom）──
      case "grade.pro": {
        const mask = subjectMask ?? resultAlpha ?? undefined;
        img = {
          w: img.w,
          h: img.h,
          rgb: gradePro(img, {
            exposure: numOr(p.exposure, 0.08),
            contrast: numOr(p.contrast, 0.16),
            warmth: numOr(p.warmth, 0.5),
            satBoost: numOr(p.satBoost, 0.06),
            ...(mask ? { alpha: mask } : {}),
          }).rgb,
        };
        break;
      }
      case "effect.contactShadow": {
        const mask = subjectMask ?? resultAlpha;
        if (!mask) break; // 没有主体蒙版就不画影，宁缺勿错
        img = {
          w: img.w,
          h: img.h,
          rgb: contactShadow(img, mask, { opacity: numOr(p.opacity, 0.26) }).rgb,
        };
        break;
      }
      case "filter.sharpen.smartSharpen":
        img = applySharpen(img, p);
        break;
      case "image.imageSize": {
        if (typeof p.percent === "number") {
          const s = p.percent / 100;
          img = resize(img, Math.round(img.w * s), Math.round(img.h * s));
          scale = [scale[0] * s, scale[1] * s];
        } else {
          const w = Number(p.width);
          const h = Number(p.height);
          const s: [number, number] = [w / src.w, h / src.h];
          img = resize(img, w, h);
          scale = [scale[0] * s[0], scale[1] * s[1]];
        }
        soft = null;
        break;
      }
      case "image.canvasSize": {
        const W = Number(p.width);
        const H = Number(p.height);
        const anchor = String(p.anchor ?? "center");
        const ext = p.extensionColor === "white" ? [255, 255, 255] : [255, 255, 255];
        const cw = img.w;
        const ch = img.h;
        let offX = 0;
        let offY = 0;
        const h2 = anchor.includes("Left") ? "l" : anchor.includes("Right") ? "r" : "c";
        const v2 = anchor.includes("Top") ? "t" : anchor.includes("Bottom") ? "b" : "c";
        if (h2 === "c") offX = Math.round((W - cw) / 2);
        else if (h2 === "r") offX = W - cw;
        if (v2 === "c") offY = Math.round((H - ch) / 2);
        else if (v2 === "b") offY = H - ch;
        img = canvas(img, W, H, anchor, ext as [number, number, number]);
        // 原图坐标 → 处理图坐标：processed = (orig - translate) * scale
        // 内容偏移 off 在 processed 像素里，换算回 orig 单位：translate_orig = -off / scale
        translate = [translate[0] - offX / scale[0], translate[1] - offY / scale[1]];
        soft = null;
        break;
      }
      case "image.crop": {
        const x = Math.round(Number(p.x ?? 0));
        const y = Math.round(Number(p.y ?? 0));
        const w = Math.round(Number(p.width));
        const h = Math.round(Number(p.height));
        const sub = { w, h, rgb: new Float64Array(w * h * 3) };
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            const sx = x + xx;
            const sy = y + yy;
            if (sx >= 0 && sx < img.w && sy >= 0 && sy < img.h) {
              sub.rgb[(yy * w + xx) * 3] = img.rgb[(sy * img.w + sx) * 3];
              sub.rgb[(yy * w + xx) * 3 + 1] = img.rgb[(sy * img.w + sx) * 3 + 1];
              sub.rgb[(yy * w + xx) * 3 + 2] = img.rgb[(sy * img.w + sx) * 3 + 2];
            }
          }
        }
        img = sub;
        translate = [translate[0] + x / scale[0], translate[1] + y / scale[1]];
        soft = null;
        break;
      }
      case "select.subject": {
        const modelAlpha = ctx?.alpha && ctx.alpha.length === img.w * img.h ? ctx.alpha : null;
        const sel = new Uint8Array(img.w * img.h);
        if (modelAlpha) {
          // 语义分割结果：alpha≥128 视为前景
          for (let i = 0; i < sel.length; i++) sel[i] = modelAlpha[i] >= 128 ? 1 : 0;
        } else {
          // 降级：参考引擎无 AI 主体识别，以「背景蒙版取反」近似主体选区
          const mask = backgroundMask(img);
          for (let i = 0; i < sel.length; i++) sel[i] = mask[i] ? 0 : 1;
        }
        selection = sel;
        selKind = "subject";
        // 记录软蒙版：后续 grade.pro / contactShadow 只作用在主体上
        subjectMask = modelAlpha
          ? Float64Array.from(modelAlpha, (v) => v / 255)
          : soft
            ? Float64Array.from(soft)
            : Float64Array.from(sel);
        break;
      }
      case "select.inverse": {
        if (selection) for (let i = 0; i < selection.length; i++) selection[i] ^= 1;
        selKind = selKind === "subject" ? "bg" : selKind === "bg" ? "subject" : "none";
        break;
      }
      case "select.deselect": {
        selection = null;
        selKind = "none";
        break;
      }
      case "edit.fill": {
        const contents = String(p.contents ?? "white");
        const col =
          contents === "white" || contents === "background"
            ? [255, 255, 255]
            : (parseColor(contents) ?? [255, 255, 255]);
        if (selection) {
          if (soft && soft.length === img.w * img.h && selKind === "bg") {
            // 先做边缘去灰：原图背景色会混在半透明边缘里，直接混合会在白底上留下
            // 一圈发灰的脏边。把轮廓 1-2px 内的颜色换成内侧前景色再混合。
            img.rgb = bleedColor(img.rgb, soft, img.w, img.h);
            // 软混合：像素 = 前景*alpha + 填充色*(1-alpha)，边缘不再出现灰环或硬切口
            for (let i = 0; i < img.w * img.h; i++) {
              const a = soft[i];
              const j = i * 3;
              img.rgb[j] = img.rgb[j] * a + col[0] * (1 - a);
              img.rgb[j + 1] = img.rgb[j + 1] * a + col[1] * (1 - a);
              img.rgb[j + 2] = img.rgb[j + 2] * a + col[2] * (1 - a);
            }
          } else {
            for (let i = 0; i < img.w * img.h; i++) {
              if (selection[i]) {
                const j = i * 3;
                img.rgb[j] = col[0];
                img.rgb[j + 1] = col[1];
                img.rgb[j + 2] = col[2];
              }
            }
          }
        }
        break;
      }
      case "layer.removeBackground": {
        // 去背到透明：有语义分割结果时输出软 alpha；否则退回几何蒙版二值化
        if (soft && soft.length === img.w * img.h) {
          // 透明输出的边缘像素是「半个背景色」，导出到深色画布会露出灰环，先做去灰
          img.rgb = bleedColor(img.rgb, soft, img.w, img.h);
          resultAlpha = Float64Array.from(soft);
        } else {
          const mask = backgroundMask(img);
          const alpha = new Float64Array(img.w * img.h).fill(1);
          for (let i = 0; i < alpha.length; i++) if (mask[i]) alpha[i] = 0;
          resultAlpha = alpha;
        }
        break;
      }
      case "type.create":
        // 文字层由 runChainOnBuffer 统一用 sharp 合成（此处跳过，避免重复处理）
        break;
      default:
        throw new UnsupportedCommandError(step.cmd);
    }
  }

  return { ok: true, img, alpha: resultAlpha, transform: { scale, translate } };
}

/**
 * 便捷入口：直接对 PNG buffer 跑链，返回 base64（与 runChain 对齐的契约）。
 * 文字层（type.create）统一用 sharp 合成；去透明背景（layer.removeBackground）
 * 输出 RGBA PNG。
 */
export async function runChainOnBuffer(
  inputBuf: Buffer,
  chain: ChainStep[],
): Promise<{ ok: boolean; base64: string; transform: EngineRun["transform"]; error?: string }> {
  try {
    const textSteps = chain.filter((s) => s.cmd === "type.create");
    const other = chain.filter((s) => s.cmd !== "type.create");
    let baseBuf = inputBuf;
    let transform: EngineRun["transform"] = { scale: [1, 1], translate: [0, 0] };
    if (other.length) {
      const src = decodePng(inputBuf);
      // 去背类命令优先用语义分割（rmbg）；模型不可用时 segmentAlpha 返回 null，
      // executeChain 内部自动回退到几何蒙版，不会中断管线。
      let alpha: Uint8Array | undefined;
      if (other.some((s) => needsSegmentation(s.cmd))) {
        try {
          alpha = (await segmentAlpha(src)) ?? undefined;
        } catch {
          alpha = undefined;
        }
      }
      const run = executeChain(src, other, { alpha });
      baseBuf = encodeImg({ w: run.img.w, h: run.img.h, rgb: run.img.rgb, alpha: run.alpha });
      transform = run.transform;
    }
    for (const ts of textSteps) {
      baseBuf = await renderText(baseBuf, ts.params);
    }
    return { ok: true, base64: baseBuf.toString("base64"), transform };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, base64: "", transform: { scale: [1, 1], translate: [0, 0] }, error: msg };
  }
}
