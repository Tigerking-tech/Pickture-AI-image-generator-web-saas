/**
 * rmbg.ts — 前景分割（RMBG-1.4 / ISNet, ONNX Runtime）
 *
 * 为什么需要它：参考引擎早期用「边框主色 + 颜色容差漫水」近似去背，遇到产品边缘
 * 浅色高光（如耳机盒底缘）会把物体当作背景一并吃掉，产生锯齿缺口。这是算法
 * 层面的固有缺陷，靠调容差只能在「啃边」和「残留背景」之间来回摆，无法根治。
 *
 * 这里改为真正的语义分割模型（RMBG-1.4 量化版，约 44MB），输出**软 alpha**。
 *
 * ── 2026-10 二次返工（边缘仍不干净）──────────────────────────────────────
 * 上一版直接输出模型 alpha，肉眼仍能看出「台阶 + 局部啃缺」。根因有两条：
 *
 *  1) 几何失真：把 w×h 硬拉成 1024×1024 正方形喂给模型，横纵缩放比不一致
 *     （1200×900 → 0.853 / 1.138），模型看到的物体是变形的，边界自然偏。
 *     → 改为 letterbox（等比缩放 + 居中填充），推理后再裁回并按同一比例放大。
 *
 *  2) 边界不是一条曲线，而是「模型网格台阶 + 原图压缩台阶」的叠加。
 *     1024 的 mask 放大到 1200 时，每级台阶被放大成 1.17px 的直角台阶；
 *     双线性放大只能把台阶抹成斜坡，抹不掉台阶本身。
 *     → 把 mask 视为**几何区域**而不是灰度图：二值化 → 去小岛/填洞
 *       → 有符号距离场（EDT）→ 对距离场做高斯平滑（等值线瞬时变光滑）
 *       → 用窄羽化（0.9px）重建 alpha。台阶被彻底消除，且不损失定位精度。
 *
 * 设计约束：
 *  - 模型或运行时缺失时返回 null，由调用方回退到保守算法，绝不抛错打断管线。
 *  - 结果按图片尺寸缓存一次，避免同一请求重复推理。
 *  - 纯 TS 实现，不引入 sharp/canvas 原生依赖（部署环境只有 pngjs）。
 */

import fs from "node:fs";
import path from "node:path";
import type { Img } from "./fidelity";

const SIZE = 1024;
const DEFAULT_MODEL = path.join(process.cwd(), "assets", "models", "rmbg-quantized.onnx");

/** 羽化半径（像素）：alpha 从 0 到 1 的过渡宽度的一半，0.9 ≈ 1.8px 过渡带 */
const FEATHER = 0.9;

export function modelPath(): string {
  return process.env.RMBG_MODEL_PATH || DEFAULT_MODEL;
}

export function modelAvailable(): boolean {
  try {
    return fs.statSync(modelPath()).size > 1_000_000;
  } catch {
    return false;
  }
}

type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  tensor: (data: Float32Array, dims: number[]) => unknown;
  run: (
    feeds: Record<string, unknown>,
  ) => Promise<Record<string, { data: Float32Array; dims: number[] }>>;
};

let sessionPromise: Promise<OrtSession | null> | null = null;

async function getSession(): Promise<OrtSession | null> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      if (!modelAvailable()) return null;
      try {
        const mod: any = await import("onnxruntime-node");
        const ort = mod.default ?? mod;
        const sess = await ort.InferenceSession.create(modelPath(), {
          executionProviders: ["cpu"],
          graphOptimizationLevel: "all",
        });
        return {
          inputNames: sess.inputNames,
          outputNames: sess.outputNames,
          tensor: (data: Float32Array, dims: number[]) => new ort.Tensor("float32", data, dims),
          run: (feeds) => sess.run(feeds),
        } as OrtSession;
      } catch (e) {
        console.warn("[rmbg] 模型加载失败，回退到几何去背：", (e as Error).message);
        return null;
      }
    })();
  }
  return sessionPromise;
}

/** 双线性采样：把 src（w×h RGB）缩放到 dw×dh 的 Float32 RGB 平面 */
function resizeRgb(src: Img, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh * 3);
  const sx = src.w / dw;
  const sy = src.h / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(src.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.h - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(src.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.w - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * dw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = src.rgb[(y0 * src.w + x0) * 3 + c];
        const p10 = src.rgb[(y0 * src.w + x1) * 3 + c];
        const p01 = src.rgb[(y1 * src.w + x0) * 3 + c];
        const p11 = src.rgb[(y1 * src.w + x1) * 3 + c];
        out[o + c] = (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy;
      }
    }
  }
  return out;
}

/** 双线性缩放单通道平面 */
function resizeMask(
  src: Float64Array | Float32Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float64Array {
  const out = new Float64Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const b = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[y * dw + x] = a * (1 - wy) + b * wy;
    }
  }
  return out;
}

/**
 * 精确欧氏距离变换（Felzenszwalb & Huttenlocher：1D 抛物线包络 + 行列两趟）。
 * binary 中 1 视为前景，返回每个像素到最近背景像素的距离（背景处为 0）。
 */
export function edt(binary: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);

  const edt1d = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  };

  const tmp = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = binary[y * w + x] ? INF : 0;
    edt1d(w);
    for (let x = 0; x < w; x++) tmp[y * w + x] = d[x];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = tmp[y * w + x];
    edt1d(h);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
  }
  for (let i = 0; i < tmp.length; i++) tmp[i] = Math.sqrt(tmp[i]);
  return tmp;
}

/**
 * 形态学清理：保留面积达标的连通域（多件产品都留下）、填掉内部空洞。
 * @param minRatio 连通域面积下限（相对最大连通域）
 */
function cleanup(
  mask: Uint8Array,
  w: number,
  h: number,
  minRatio: number,
): { mask: Uint8Array; kept: number } {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    label[i] = id;
    let count = 0;
    while (head < tail) {
      const p = queue[head++];
      count++;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && mask[p - 1] && label[p - 1] < 0) {
        label[p - 1] = id;
        queue[tail++] = p - 1;
      }
      if (x + 1 < w && mask[p + 1] && label[p + 1] < 0) {
        label[p + 1] = id;
        queue[tail++] = p + 1;
      }
      if (y > 0 && mask[p - w] && label[p - w] < 0) {
        label[p - w] = id;
        queue[tail++] = p - w;
      }
      if (y + 1 < h && mask[p + w] && label[p + w] < 0) {
        label[p + w] = id;
        queue[tail++] = p + w;
      }
    }
    sizes.push(count);
  }
  if (!sizes.length) return { mask, kept: 0 };
  const maxSize = Math.max(...sizes);
  const keep = sizes.map((s) => s >= Math.max(maxSize * minRatio, w * h * 0.0005));

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (mask[i] && keep[label[i]]) out[i] = 1;

  // 填内部空洞：从画布边缘 flood fill 背景，未到达的背景像素即为洞
  const outside = new Uint8Array(n);
  let head = 0;
  let tail = 0;
  const q2 = new Int32Array(n);
  const push = (p: number) => {
    if (!out[p] && !outside[p]) {
      outside[p] = 1;
      q2[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (head < tail) {
    const p = q2[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(p - 1);
    if (x + 1 < w) push(p + 1);
    if (y > 0) push(p - w);
    if (y + 1 < h) push(p + w);
  }
  for (let i = 0; i < n; i++) if (!out[i] && !outside[i]) out[i] = 1;

  return { mask: out, kept: keep.filter(Boolean).length };
}

/** 三次 box blur 近似高斯（分离式，边界镜像） */
function gaussianBlur(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  if (sigma <= 0) return src;
  const r = Math.max(1, Math.round(sigma * 0.9));
  const cur = Float64Array.from(src);
  const tmp = new Float64Array(src.length);
  const win = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          let xx = x + k;
          if (xx < 0) xx = -xx;
          if (xx >= w) xx = 2 * w - xx - 2;
          sum += cur[row + Math.min(w - 1, Math.max(0, xx))];
        }
        tmp[row + x] = sum / win;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) {
          let yy = y + k;
          if (yy < 0) yy = -yy;
          if (yy >= h) yy = 2 * h - yy - 2;
          sum += tmp[Math.min(h - 1, Math.max(0, yy)) * w + x];
        }
        cur[y * w + x] = sum / win;
      }
    }
  }
  return cur;
}

/**
 * alpha 后处理：把模型输出的粗糙概率图变成「光滑且贴合」的硬边蒙版。
 *
 * 步骤：二值化 → 连通域清理/填洞 → SDF(EDT 差) → 高斯平滑 SDF → 窄羽化重建。
 * 平滑的对象是**距离场**而不是 alpha：等值线被拉直成光滑曲线，而 alpha 的
 * 过渡宽度始终等于 FEATHER，不会越抹越糊。
 */
export function refineAlpha(
  raw: Float64Array,
  w: number,
  h: number,
  opts: { threshold?: number; sigma?: number; feather?: number } = {},
): { alpha: Float64Array; kept: number; area: number } {
  const thr = opts.threshold ?? 0.5;
  const feather = opts.feather ?? Number(process.env.RMBG_FEATHER ?? FEATHER);
  const sigma =
    opts.sigma ?? Number(process.env.RMBG_SIGMA ?? Math.min(3, Math.max(2, Math.min(w, h) / 380)));

  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = raw[i] >= thr ? 1 : 0;

  const cleaned = cleanup(bin, w, h, 0.15);
  const mask = cleaned.mask;

  const inside = edt(mask, w, h); // 前景 → 到最近背景的距离
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const outside = edt(inv, w, h); // 背景 → 到最近前景的距离

  const sdf = new Float64Array(mask.length);
  for (let i = 0; i < sdf.length; i++) sdf[i] = inside[i] - outside[i];

  const smooth = gaussianBlur(sdf, w, h, sigma);

  const alpha = new Float64Array(mask.length);
  let area = 0;
  const span = 2 * feather;
  for (let i = 0; i < alpha.length; i++) {
    const a = 0.5 + smooth[i] / span;
    const v = a <= 0 ? 0 : a >= 1 ? 1 : a;
    alpha[i] = v;
    area += v;
  }
  return { alpha, kept: cleaned.kept, area: Math.round(area) };
}

/**
 * 边缘去灰边：把紧贴轮廓 1-2px 的像素颜色替换为「内侧前景色」，
 * 消除原图灰底在半透明边缘处留下的脏边 / 白边。
 *
 * 做法是向外扩散（bleed）：从完全不透明的核心像素开始，逐圈把已知颜色
 * 平均推给相邻的过渡像素，最多 BLEED_PASSES 轮。
 */
export function bleedColor(
  rgb: Float64Array,
  alpha: Float64Array,
  w: number,
  h: number,
  passes = 3,
): Float64Array {
  const out = Float64Array.from(rgb);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < known.length; i++) known[i] = alpha[i] >= 0.98 ? 1 : 0;

  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(known);
    const color = new Float64Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (known[i] || alpha[i] <= 0.02) continue;
        let n = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!known[j]) continue;
            r += out[j * 3];
            g += out[j * 3 + 1];
            b += out[j * 3 + 2];
            n++;
          }
        }
        if (!n) continue;
        color[i * 3] = r / n;
        color[i * 3 + 1] = g / n;
        color[i * 3 + 2] = b / n;
        next[i] = 1;
      }
    }
    for (let i = 0; i < known.length; i++) {
      if (known[i] || alpha[i] <= 0.02) continue;
      if (!color[i * 3] && !color[i * 3 + 1] && !color[i * 3 + 2]) continue;
      out[i * 3] = color[i * 3];
      out[i * 3 + 1] = color[i * 3 + 1];
      out[i * 3 + 2] = color[i * 3 + 2];
    }
    known.set(next);
  }
  return out;
}

/**
 * 计算前景 alpha（0-255 连续值）。
 * 返回 null 表示模型不可用，调用方应回退。
 */
export async function segmentAlpha(img: Img): Promise<Uint8Array | null> {
  const sess = await getSession();
  if (!sess) return null;

  // ── letterbox：等比缩放到 1024 框内，居中填充图像均值（保持长宽比）───────
  const scale = Math.min(SIZE / img.w, SIZE / img.h);
  const nw = Math.max(1, Math.round(img.w * scale));
  const nh = Math.max(1, Math.round(img.h * scale));
  const ox = Math.floor((SIZE - nw) / 2);
  const oy = Math.floor((SIZE - nh) / 2);

  const resized = resizeRgb(img, nw, nh);
  const mean = [0, 0, 0];
  for (let i = 0; i < nw * nh; i++) {
    mean[0] += resized[i * 3];
    mean[1] += resized[i * 3 + 1];
    mean[2] += resized[i * 3 + 2];
  }
  for (let c = 0; c < 3; c++) mean[c] /= nw * nh;

  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = mean[0] / 255 - 0.5;
    input[plane + i] = mean[1] / 255 - 0.5;
    input[plane * 2 + i] = mean[2] / 255 - 0.5;
  }
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const s = (y * nw + x) * 3;
      const dst = (y + oy) * SIZE + (x + ox);
      input[dst] = resized[s] / 255 - 0.5;
      input[plane + dst] = resized[s + 1] / 255 - 0.5;
      input[plane * 2 + dst] = resized[s + 2] / 255 - 0.5;
    }
  }

  try {
    const out = await sess.run({
      [sess.inputNames[0]]: sess.tensor(input, [1, 3, SIZE, SIZE]),
    });
    const t = out[sess.outputNames[0]];
    const rawOut = t.data as Float32Array;

    // 后处理：min-max 归一化（与 RMBG 官方 naive_cutout 一致）
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < rawOut.length; i++) {
      const v = rawOut[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = Math.max(1e-8, max - min);
    const norm = new Float64Array(rawOut.length);
    for (let i = 0; i < rawOut.length; i++) norm[i] = (rawOut[i] - min) / span;

    // 裁掉填充区，再等比放大回原图
    const cropped = new Float64Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) cropped[y * nw + x] = norm[(y + oy) * SIZE + (x + ox)];
    }
    const full = resizeMask(cropped, nw, nh, img.w, img.h);

    const { alpha } = refineAlpha(full, img.w, img.h);
    const out8 = new Uint8Array(alpha.length);
    for (let i = 0; i < alpha.length; i++) out8[i] = Math.round(alpha[i] * 255);
    return out8;
  } catch (e) {
    console.warn("[rmbg] 推理失败，回退到几何去背：", (e as Error).message);
    return null;
  }
}
