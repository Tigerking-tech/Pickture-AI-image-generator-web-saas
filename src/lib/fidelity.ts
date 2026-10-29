/**
 * fidelity.ts — LOGO/文字保真校验算法（Surepix 独有算法层 #1）
 *
 * lib/fidelity.py 的忠实 TypeScript 移植（同一套指标与阈值，单元测试对齐 Python 版）。
 * 输入：原图 + 处理后的图（PNG buffer）+ 元素 manifest（bbox）
 * 输出：结构化质检报告 { verdict: PASS|REPAIR|REGENERATE, elements, summary }
 *
 * 算法（多指标融合，阈值按元素类型自适应）：
 *  1. 像素级 MAE —— 检测全局色偏是否在"预期调整方向"
 *  2. 简化 MS-SSIM（3 尺度，亮度补偿）—— 检测结构是否保留（LOGO 是否还是那个 LOGO）
 *  3. 边缘召回（Sobel 阈值 60，±2px 容差）—— 检测文字笔画/LOGO 轮廓是否完整
 *  4. 对比度保持率 —— 文字变模糊会掉对比度
 *  5. 自适应阈值：LOGO/文字严（SSIM>0.95），商品主体中，背景松
 *
 * 几何变换（resize/crop/pad）下的比对策略：
 *  交付图与原图分辨率不同时，先把原图按同一几何变换做成"参考图"
 *  （双线性重采样 + 补边填充），在与交付图相同的分辨率上逐元素比对——
 *  衡量的是"CLI 的执行是否忠于原图"，而不是"降采样本身有损"。
 *
 * 边缘指标的演进（实测驱动，v0.15.1 保真算法 #1 修订）：
 *  初版用对称 IoU（|E1∩E2|/|E1∪E2|）。实测发现 smartSharpen 后
 *  product_logo 的 IoU 仅 0.40——但逐像素分析显示 73 条原边缘一条没少
 *  （recall=1.0），多出的 339 个边缘像素是 halo 与"被放大到阈值之上的
 *  原有低对比度结构"（该徽章中心本就有 130-200 灰度的横带）。对称 IoU
 *  把锐化的预期效果误判成损伤。改为边缘召回后：锐化=1.0、模糊=0.0、
 *  涂灰=0.0、暖调=0.97——损伤检出能力不降反升（模糊/涂灰从 0.4 档
 *  变成 0.0 断崖）。"凭空新增结构"由 MS-SSIM 结构项 + 对比度保持 + MAE 把关。
 *
 * verdict 语义（产品直接用）：
 *  PASS       该元素保真通过，可交付
 *  REPAIR     局部损伤，走 PhotoCraft 修复命令链（不重新生成，不花钱）
 *  REGENERATE 结构崩塌，必须重生成（说明该属性应该走生成模型而非修图）
 */

import { PNG } from "pngjs";

export type Bbox = [number, number, number, number]; // x1,y1,x2,y2

export interface Img {
  w: number;
  h: number;
  rgb: Float64Array; // length w*h*3
}

export interface ElementReport {
  verdict: "PASS" | "REPAIR" | "REGENERATE";
  mae: number;
  ms_ssim: number;
  edge_recall: number;
  contrast_retention: number;
  reasons: string[];
  /** true = 该元素被裁剪操作故意移除（在输出帧之外），不计入损伤判定 */
  removed?: boolean;
}

export interface FidelityReport {
  verdict: "PASS" | "REPAIR" | "REGENERATE";
  elements: Record<string, ElementReport>;
  summary: Record<string, number>;
}

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

const STRICT_KINDS = new Set(["brand_logo", "product_logo", "price_tag", "text_small"]);
const MID_KINDS = new Set(["product_body", "product_label", "whole_image"]);

/** PNG buffer → RGB 图像（带 alpha 的上传图按白色底合成） */
export function decodePng(buf: Buffer): Img {
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;
  const rgb = new Float64Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const a = data[j + 3] / 255;
    rgb[i * 3] = data[j] * a + 255 * (1 - a);
    rgb[i * 3 + 1] = data[j + 1] * a + 255 * (1 - a);
    rgb[i * 3 + 2] = data[j + 2] * a + 255 * (1 - a);
  }
  return { w, h, rgb };
}

/** PNG buffer 编码（用于把处理结果回传给前端） */
export function encodePng(img: Img): Buffer {
  const png = new PNG({ width: img.w, height: img.h });
  const out = png.data;
  for (let i = 0, j = 0; i < img.w * img.h; i++, j += 4) {
    out[j] = Math.max(0, Math.min(255, Math.round(img.rgb[i * 3])));
    out[j + 1] = Math.max(0, Math.min(255, Math.round(img.rgb[i * 3 + 1])));
    out[j + 2] = Math.max(0, Math.min(255, Math.round(img.rgb[i * 3 + 2])));
    out[j + 3] = 255;
  }
  return PNG.sync.write(png);
}

function crop(img: Img, bbox: Bbox): Img {
  const [x1, y1, x2, y2] = bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  const rgb = new Float64Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = ((y1 + y) * img.w + x1) * 3;
    rgb.set(img.rgb.subarray(src, src + w * 3), y * w * 3);
  }
  return { w, h, rgb };
}

function mae(a: Img, b: Img): number {
  let sum = 0;
  for (let i = 0; i < a.rgb.length; i++) sum += Math.abs(a.rgb[i] - b.rgb[i]);
  return sum / a.rgb.length;
}

function toGray(img: Img): Float64Array {
  const g = new Float64Array(img.w * img.h);
  for (let i = 0; i < g.length; i++) {
    g[i] = (img.rgb[i * 3] + img.rgb[i * 3 + 1] + img.rgb[i * 3 + 2]) / 3;
  }
  return g;
}

/** 单尺度 SSIM（亮度/对比度/结构三项，全局统计量近似） */
function ssimSimple(a: Float64Array, b: Float64Array): number {
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let va = 0,
    vb = 0,
    cov = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    va += da * da;
    vb += db * db;
    cov += da * db;
  }
  va /= n;
  vb /= n;
  cov /= n;
  const luminance = (2 * ma * mb + C1) / (ma * ma + mb * mb + C1);
  const contrast = (2 * Math.sqrt(va * vb) + C2) / (va + vb + C2);
  const structure = (cov + C2 / 2) / (Math.sqrt(va * vb) + C2 / 2);
  return luminance * contrast * structure;
}

/**
 * 亮度补偿 SSIM：先把两块灰度图的均值各自归零，再算 SSIM。
 * 为什么：curves/brightness 类编辑会整体移动亮度——普通 SSIM 的 luminance 项
 * 因此下降，把"故意的调色"误判成"结构损伤"（实测 warm_up 下深底价格签
 * SSIM=0.93-0.95，频繁误触 REPAIR）。归零后 luminance≡1，SSIM 只度量
 * 对比度与结构的保持——调色通过、模糊/涂灰仍然断崖下降。
 * 全局色偏由 MAE 单独把关（文字类 MAE>40 → REGENERATE）。
 */
function luminanceCompensatedSsim(
  ga: Float64Array,
  gb: Float64Array,
  w: number,
  h: number,
  scales = 3,
): number {
  const na = new Float64Array(ga.length);
  const nb = new Float64Array(gb.length);
  let ma = 0,
    mb = 0;
  for (let i = 0; i < ga.length; i++) {
    ma += ga[i];
    mb += gb[i];
  }
  ma /= ga.length;
  mb /= gb.length;
  for (let i = 0; i < ga.length; i++) {
    na[i] = ga[i] - ma;
    nb[i] = gb[i] - mb;
  }
  return msSsim(na, nb, w, h, scales);
}

function decimate(
  g: Float64Array,
  w: number,
  h: number,
): { g: Float64Array; w: number; h: number } {
  const nw = Math.ceil(w / 2);
  const nh = Math.ceil(h / 2);
  const out = new Float64Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      out[y * nw + x] = g[y * 2 * w + x * 2];
    }
  }
  return { g: out, w: nw, h: nh };
}

/** 多尺度 SSIM：逐级 2x 降采样后取平均 */
function msSsim(
  grayA: Float64Array,
  grayB: Float64Array,
  w: number,
  h: number,
  scales = 3,
): number {
  const scores: number[] = [];
  let a = { g: grayA, w, h };
  let b = { g: grayB, w, h };
  for (let s = 0; s < scales; s++) {
    if (Math.min(a.w, a.h) < 16) break;
    scores.push(ssimSimple(a.g, b.g));
    a = decimate(a.g, a.w, a.h);
    b = decimate(b.g, b.w, b.h);
  }
  return scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : 0;
}

/** Sobel 边缘（简化：一阶差分，阈值 60） */
function sobelEdges(g: Float64Array, w: number, h: number): Uint8Array {
  const e = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x === 0 ? 0 : Math.abs(g[y * w + x] - g[y * w + x - 1]);
      const dy = y === 0 ? 0 : Math.abs(g[y * w + x] - g[(y - 1) * w + x]);
      e[y * w + x] = dx + dy > 60 ? 1 : 0;
    }
  }
  return e;
}

/**
 * 边缘召回：原边缘像素中，在处理图 ±r px 邻域内仍能找到边缘的比例。
 *  - 衡量"笔画/轮廓完整性"：模糊/位移>r/擦除都会让它掉下去
 *  - 锐化的 halo、对比度放大不会让它掉——原边缘一条没少（recall=1.0）
 *  - 对称 IoU 把这些预期效果误判成损伤，故弃用（见文件头演进说明）
 */
function edgeRecall(e1: Uint8Array, e2: Uint8Array, w: number, h: number, r = 2): number {
  const d2 = dilate(e2, w, h, r);
  let hit = 0;
  let total = 0;
  for (let i = 0; i < e1.length; i++) {
    if (e1[i]) {
      total++;
      if (d2[i]) hit++;
    }
  }
  return total ? hit / total : 1; // 原图该区域本就没有边缘（纯色）→ 不构成损伤
}

function std(g: Float64Array): number {
  const n = g.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += g[i];
  m /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (g[i] - m) ** 2;
  return Math.sqrt(v / n);
}

function contrastRetention(ga: Float64Array, gb: Float64Array): number {
  const ca = std(ga);
  const cb = std(gb);
  return ca > 1e-6 ? cb / ca : 1.0;
}

/** 双线性重采样到目标尺寸（缩放场景下把处理图区域拉回原尺寸再比对） */
function resampleTo(img: Img, tw: number, th: number): Img {
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

/** 单元素校验：原图区域 + 处理图区域（两个坐标系各自裁剪）+ 元素名（决定阈值档位） */
export function verifyElement(
  orig: Img,
  proc: Img,
  origBbox: Bbox,
  procBbox: Bbox,
  name: string,
  opts?: { toneEdit?: boolean },
): ElementReport {
  const ro = crop(orig, origBbox);
  let rp = crop(proc, procBbox);
  if (ro.rgb.length === 0 || rp.rgb.length === 0) {
    return {
      verdict: "REGENERATE",
      mae: 0,
      ms_ssim: 0,
      edge_recall: 0,
      contrast_retention: 0,
      reasons: ["region missing/size changed"],
    };
  }
  // 缩放场景：处理图区域尺寸 ≠ 原图区域尺寸 → 重采样回原尺寸再比对
  if (rp.w !== ro.w || rp.h !== ro.h) {
    rp = resampleTo(rp, ro.w, ro.h);
  }
  const m = mae(ro, rp);
  const go = toGray(ro);
  const gp = toGray(rp);
  const s = luminanceCompensatedSsim(go, gp, ro.w, ro.h);
  const e = edgeRecall(sobelEdges(go, ro.w, ro.h), sobelEdges(gp, rp.w, rp.h), ro.w, ro.h);
  const cr = contrastRetention(go, gp);

  let ssimTh: number, edgeTh: number, crTh: number;
  if (STRICT_KINDS.has(name)) {
    ssimTh = 0.95;
    edgeTh = 0.75;
    crTh = 0.85;
  } else if (MID_KINDS.has(name)) {
    ssimTh = 0.85;
    edgeTh = 0.6;
    crTh = 0.7;
  } else {
    ssimTh = 0.7;
    edgeTh = 0.4;
    crTh = 0.5;
  }

  // 纯调色 / 调光编辑（curves / 亮度对比 / 色相饱和度 / 色阶）会**有意**改变全局
  // 对比度——这正是用户要的效果，不是损伤。若仍用 0.7~0.85 的对比度下限，会被反复
  // 误判为 REPAIR 并自动降级到「几乎无变化的温吞配方」，导致着陆页对比滑块看不出
  // 区别。这里把对比度下限放宽到 0.5（仍能在整体灰白化 / 洗白时断崖下降），而结构类
  // 指标（去均值 SSIM、边缘召回）完全不变，继续拦截模糊 / 位移 / 擦除。
  if (opts?.toneEdit) crTh = 0.5;

  const reasons: string[] = [];
  if (s < ssimTh) reasons.push(`ssim=${s.toFixed(3)}<${ssimTh}`);
  if (e < edgeTh) reasons.push(`edge_recall=${e.toFixed(3)}<${edgeTh}`);
  if (cr < crTh) reasons.push(`contrast=${cr.toFixed(3)}<${crTh}`);

  let verdict: ElementReport["verdict"];
  if (reasons.length === 0) {
    verdict = "PASS";
  } else if (STRICT_KINDS.has(name) && m > 40) {
    verdict = "REGENERATE"; // 文字类严重损伤 → 重生成
  } else {
    verdict = "REPAIR";
  }
  return {
    verdict,
    mae: Math.round(m * 100) / 100,
    ms_ssim: Math.round(s * 10000) / 10000,
    edge_recall: Math.round(e * 10000) / 10000,
    contrast_retention: Math.round(cr * 10000) / 10000,
    reasons,
  };
}

const ORDER: Record<string, number> = { PASS: 0, REPAIR: 1, REGENERATE: 2 };

/** 图像几何变换：先平移（裁剪）再缩放（重采样）。bbox 从原图坐标映射到处理图坐标 */
export interface ImgTransform {
  scale: [number, number];
  translate: [number, number];
}

export const IDENTITY_TRANSFORM: ImgTransform = { scale: [1, 1], translate: [0, 0] };

function applyTransform(bbox: Bbox, t: ImgTransform): Bbox {
  return [
    Math.round((bbox[0] - t.translate[0]) * t.scale[0]),
    Math.round((bbox[1] - t.translate[1]) * t.scale[1]),
    Math.round((bbox[2] - t.translate[0]) * t.scale[0]),
    Math.round((bbox[3] - t.translate[1]) * t.scale[1]),
  ];
}

/** 边缘图膨胀（边缘召回的 ±r px 容差：吸收抗锯齿/重采样/锐化 halo 造成的边界抖动，不放过成片边缘消失） */
function dilate(e: Uint8Array, w: number, h: number, r = 2): Uint8Array {
  const out = new Uint8Array(e.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!e[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < h && nx >= 0 && nx < w) out[ny * w + nx] = 1;
        }
      }
    }
  }
  return out;
}

/** 把 bbox 限制在图像范围内；完全在帧外返回 null（裁剪场景：元素被故意移除） */
function clampBbox(bbox: Bbox, w: number, h: number): Bbox | null {
  const x1 = Math.max(0, Math.min(bbox[0], w));
  const y1 = Math.max(0, Math.min(bbox[1], h));
  const x2 = Math.max(0, Math.min(bbox[2], w));
  const y2 = Math.max(0, Math.min(bbox[3], h));
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return [x1, y1, x2, y2];
}

/**
 * 按几何变换把原图重采样到目标尺寸（保真校验的"参考图"）：
 *  逆映射 p = p'/s + t，双线性采样，域外填 fill（补边色，默认白）。
 * 为什么需要：resize/pad 后交付图与原图分辨率不同，若把交付图拉回原尺寸
 * 再比对，往返重采样的模糊会被误判成损伤；改为在同一分辨率上与
 * "正确的重采样结果" 比对，衡量的才是 CLI 的执行质量。
 */
function warpToTransform(img: Img, outW: number, outH: number, t: ImgTransform, fill = 255): Img {
  const out = new Float64Array(outW * outH * 3);
  const [sx, sy] = t.scale;
  const [tx, ty] = t.translate;
  for (let y = 0; y < outH; y++) {
    const fy = y / sy + ty;
    for (let x = 0; x < outW; x++) {
      const fx = x / sx + tx;
      const o = (y * outW + x) * 3;
      if (fx < 0 || fy < 0 || fx > img.w - 1 || fy > img.h - 1) {
        out[o] = fill;
        out[o + 1] = fill;
        out[o + 2] = fill;
        continue;
      }
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(x0 + 1, img.w - 1);
      const y1 = Math.min(y0 + 1, img.h - 1);
      const wx = fx - x0;
      const wy = fy - y0;
      for (let c = 0; c < 3; c++) {
        const p00 = img.rgb[(y0 * img.w + x0) * 3 + c];
        const p10 = img.rgb[(y0 * img.w + x1) * 3 + c];
        const p01 = img.rgb[(y1 * img.w + x0) * 3 + c];
        const p11 = img.rgb[(y1 * img.w + x1) * 3 + c];
        out[o + c] =
          p00 * (1 - wx) * (1 - wy) + p10 * wx * (1 - wy) + p01 * (1 - wx) * wy + p11 * wx * wy;
      }
    }
  }
  return { w: outW, h: outH, rgb: out };
}

/** 全图校验：逐元素跑 verifyElement，汇总最差 verdict。
 *  transform 由管线按命令语义提供（crop=平移+缩放，imageSize=缩放，canvasSize=平移）；
 *  缺省时按输出/输入尺寸比缩放（上传流等无命令语义场景）。
 *  恒等变换 → 原图/交付图同分辨率直接比对；
 *  非恒等 → 原图 warp 成参考图，在与交付图相同的分辨率上逐元素比对。 */
export function verify(
  origBuf: Buffer,
  procBuf: Buffer,
  manifest: { elements: Record<string, { bbox: Bbox }> },
  transform?: ImgTransform,
  opts?: { toneEdit?: boolean },
): FidelityReport {
  const orig = decodePng(origBuf);
  const proc = decodePng(procBuf);
  const t: ImgTransform = transform ?? {
    scale: [proc.w / orig.w, proc.h / orig.h],
    translate: [0, 0],
  };
  const geometric =
    t.scale[0] !== 1 || t.scale[1] !== 1 || t.translate[0] !== 0 || t.translate[1] !== 0;
  const ref = geometric ? warpToTransform(orig, proc.w, proc.h, t, 255) : orig;

  const report: FidelityReport = { verdict: "PASS", elements: {}, summary: {} };
  let worst = "PASS";
  for (const [name, spec] of Object.entries(manifest.elements)) {
    // 元素 bbox 映射到交付图坐标系
    const eBbox = geometric ? applyTransform(spec.bbox, t) : spec.bbox;
    const clamped = clampBbox(eBbox, ref.w, ref.h);
    if (!clamped) {
      // 完全在输出帧之外：被裁剪故意移除，不是损伤
      report.elements[name] = {
        verdict: "PASS",
        mae: 0,
        ms_ssim: 1,
        edge_recall: 1,
        contrast_retention: 1,
        reasons: ["outside output frame — removed by crop"],
        removed: true,
      };
      report.summary.REMOVED = (report.summary.REMOVED || 0) + 1;
      continue;
    }
    const r = verifyElement(ref, proc, clamped, clamped, name, opts);
    report.elements[name] = r;
    if (ORDER[r.verdict] > ORDER[worst]) worst = r.verdict as FidelityReport["verdict"];
  }
  report.verdict = worst as FidelityReport["verdict"];
  for (const r of Object.values(report.elements)) {
    if (r.removed) continue;
    report.summary[r.verdict] = (report.summary[r.verdict] || 0) + 1;
  }
  return report;
}

/** 无 manifest 的上传图：全图作为单元素校验（whole_image 走商品主体档阈值） */
export function verifyGlobal(
  origBuf: Buffer,
  procBuf: Buffer,
  transform?: ImgTransform,
  opts?: { toneEdit?: boolean },
): FidelityReport {
  const orig = decodePng(origBuf);
  return verify(
    origBuf,
    procBuf,
    {
      elements: { whole_image: { bbox: [0, 0, orig.w, orig.h] as Bbox } },
    },
    transform,
    opts,
  );
}
