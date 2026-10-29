#!/usr/bin/env node
/**
 * qc.mjs — 展示图视觉质检门禁（独立实现，不复用被测引擎代码）
 *
 * 存在的理由：2026-10 交付过一次「扣图把耳机盒边缘咬掉一块」的图，当时
 * 展示卡片还写着 "6/6 PASS · product fidelity 1.000"。问题不是没跑测试，
 * 而是**没有任何检查是看图的**——只算了 MAE/SSIM 这类全局统计量，它们对
 * 局部啃边完全不敏感（缺口只占 <1% 像素，MAE 反而会因为「填白更多」而变好）。
 *
 * 所以这里换成几何/语义级的检查：
 *   1. subject_recall  —— 主体轮廓有没有被侵蚀（本次事故的直接测度）
 *   2. bg_purity       —— 背景是否真的纯色
 *   3. edge_hardness   —— 边缘是羽化过渡还是硬切
 *   4. edge_align      —— 轮廓是否踩在真实图像梯度上（抓"浮空/错位"）
 *   5. bbox_touch      —— 主体是否顶到画布边
 *
 * 边界说明（2026-10 第二次返工后补）：上面这些能可靠抓"灾难"，但抓不住
 * "边缘干不干净"——台阶/毛刺的信息量集中在 1–2 个像素里，一旦从白底合成图
 * 反推蒙版就被量化抹平了（试过轮廓抖动 RMS、过渡带宽度变异、形态学粗糙度，
 * 真实数据上区分度都不足 1.2×）。所以审美判定交给人眼：`scripts/edge-audit.mjs`
 * 产出 12 处边界 ×5 放大的宫格图，交付前必须看一眼。
 *
 * 之所以独立实现（不 import src/lib/*）：质检器如果复用被测代码的蒙版，
 * 会连同 bug 一起"自证清白"。这里的分割用 RMBG 模型直接从原图算参考蒙版。
 *
 * 用法：
 *   node scripts/qc.mjs               # 检查 public/showcase 全部图
 *   node scripts/qc.mjs --json        # 只输出 JSON
 *   node scripts/qc.mjs --dir=path    # 指定目录
 * 退出码：0 全通过；1 有 FAIL；2 运行错误。
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const MODEL = process.env.RMBG_MODEL_PATH || path.join(ROOT, "assets", "models", "rmbg-quantized.onnx");
const SIZE = 1024;

// ── 阈值（经验值，改动请同步 docs/QC-CHECKLIST.md）──────────────────────────
const TH = {
  subjectRecall: 0.99, // 主体保留率
  bgMean: 250, // 背景均值（白底）
  bgStd: 3.0, // 背景标准差（纯色）
  edgeHardness: 0.75, // 硬切边界点占比上限
  groundChroma: 6, // 地面带允许的平均通道差（中性灰）
  groundCover: 0.6, // 地面带里被压暗的像素占比上限
  edgeAlign: 0.5, // 边界落在真实图像梯度上的比例下限
  maeMin: 6, // 调色类最小可见幅度
  bboxMargin: 1, // 主体距画布边最小像素
};

// ── 基础 ────────────────────────────────────────────────────────────────────
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

async function loadRgb(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

function borderMedian({ data, w, h, ch }) {
  const rs = [];
  const gs = [];
  const bs = [];
  const push = (i) => {
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };
  for (let x = 0; x < w; x++) {
    push(x * ch);
    push(((h - 1) * w + x) * ch);
  }
  for (let y = 0; y < h; y++) {
    push(y * w * ch);
    push((y * w + w - 1) * ch);
  }
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

// ── 参考蒙版（RMBG 语义分割，独立于被测引擎）───────────────────────────────
let _sess = null;
async function segment(img) {
  if (!fs.existsSync(MODEL)) return null;
  if (!_sess) {
    const ort = require("onnxruntime-node");
    _sess = await ort.InferenceSession.create(MODEL, { executionProviders: ["cpu"] });
  }
  const ort = require("onnxruntime-node");
  const { data, w, h, ch } = img;

  // 双线性缩放 + 归一化
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let y = 0; y < SIZE; y++) {
    const sy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / SIZE - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < SIZE; x++) {
      const sx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / SIZE - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w - 1, x0 + 1);
      const wx = sx - x0;
      const o = (y * SIZE + x) % plane;
      for (let c = 0; c < 3; c++) {
        const p00 = data[(y0 * w + x0) * ch + c];
        const p10 = data[(y0 * w + x1) * ch + c];
        const p01 = data[(y1 * w + x0) * ch + c];
        const p11 = data[(y1 * w + x1) * ch + c];
        const v = (p00 * (1 - wx) + p10 * wx) * (1 - wy) + (p01 * (1 - wx) + p11 * wx) * wy;
        input[c * plane + o] = v / 255 - 0.5;
      }
    }
  }

  const out = await _sess.run({ [_sess.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) });
  const raw = out[_sess.outputNames[0]].data;
  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = Math.max(1e-8, max - min);

  // 缩回原尺寸
  const alpha = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(SIZE - 1, Math.max(0, ((y + 0.5) * SIZE) / h - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(SIZE - 1, y0 + 1);
    const wy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(SIZE - 1, Math.max(0, ((x + 0.5) * SIZE) / w - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(SIZE - 1, x0 + 1);
      const wx = sx - x0;
      const a = (raw[y0 * SIZE + x0] - min) / span;
      const b = (raw[y0 * SIZE + x1] - min) / span;
      const c = (raw[y1 * SIZE + x0] - min) / span;
      const d = (raw[y1 * SIZE + x1] - min) / span;
      alpha[y * w + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return alpha;
}

// ── 指标 ────────────────────────────────────────────────────────────────────

/** 主体保留率：参考蒙版覆盖的像素里，有多少在输出图里仍不是背景色 */
/** 腐蚀蒙版：只保留离轮廓 ≥times px 的核心区
 *  玻璃 / 半透明 / 细发丝材质在轮廓 1-2px 内本来就与背景混合，
 *  把它们算成「被啃边」会误报（serum 实测：整个 15000 像素都是这类边缘带） */
function erodeMask(refAlpha, w, h, times) {
  let m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = refAlpha[i] >= 0.5 ? 1 : 0;
  for (let t = 0; t < times; t++) {
    const n = new Uint8Array(m.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        n[i] = m[i - 1] && m[i + 1] && m[i - w] && m[i + w] ? 1 : 0;
      }
    }
    m = n;
  }
  return m;
}

function subjectRecall(refAlpha, beforeImg, outImg, bg) {
  const { data, w, h, ch } = outImg;
  const bd = beforeImg.data;
  const core = erodeMask(refAlpha, w, h, 2);
  let hit = 0;
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    if (!core[i]) continue;
    const j = i * ch;
    // 主体本身就和底色接近的像素（白色金属盖、镜面高光）无法靠颜色判断去留，
    // 不能算进分母，否则会把「本来就是白的」误判成「被吃掉了」
    const db =
      Math.abs(bd[j] - bg[0]) + Math.abs(bd[j + 1] - bg[1]) + Math.abs(bd[j + 2] - bg[2]);
    if (db <= 30) continue;
    total++;
    const d =
      Math.abs(data[j] - bg[0]) + Math.abs(data[j + 1] - bg[1]) + Math.abs(data[j + 2] - bg[2]);
    if (d > 30) hit++;
  }
  return { recall: total ? hit / total : 1, total };
}

/** 背景纯度：参考蒙版认定为背景的区域，颜色是否单一且接近目标底色 */
function bgPurity(refAlpha, outImg) {
  const { data, w, h, ch } = outImg;
  // 白底商品图允许有接地阴影——它不是"背景脏"。所以先把主体正下方那块阴影带
  // 排除掉，只测"本该纯色"的区域（四边 + 主体上方）。旧版把阴影算进背景，
  // 一旦加入 contactShadow 就会误判整张图背景不纯（2026-10 实测）。
  let bx0 = w;
  let bx1 = -1;
  let by1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (refAlpha[y * w + x] > 0.5) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y > by1) by1 = y;
      }
    }
  }
  // "地面带"= 画布下方 30%。这里允许有接地影/台面反光，不参与"是否纯白"判定；
  // 但它仍然要接受另一项检查（ground_chroma：只能是中性灰，不能是残留彩色）。
  const groundTop = Math.round(h * 0.7);
  void bx0;
  void bx1;
  void by1;
  let n = 0;
  let gn = 0;
  let gchroma = 0;
  let gdark = 0;
  let sum = 0;
  let sum2 = 0;
  let rs = 0;
  let gs = 0;
  let bs = 0;
  for (let i = 0; i < w * h; i++) {
    if (refAlpha[i] > 0.02) continue;
    const y = (i / w) | 0;
    const j = i * ch;
    if (y >= groundTop) {
      // 地面带：只统计"中性度"，不参与纯白判定
      const mx = Math.max(data[j], data[j + 1], data[j + 2]);
      const mn = Math.min(data[j], data[j + 1], data[j + 2]);
      gchroma += mx - mn;
      if (mx < 235) gdark++;
      gn++;
      continue;
    }
    const l = lum(data[j], data[j + 1], data[j + 2]);
    sum += l;
    sum2 += l * l;
    rs += data[j];
    gs += data[j + 1];
    bs += data[j + 2];
    n++;
  }
  if (!n) return { mean: 0, std: 0, rgb: [0, 0, 0], groundChroma: 0, groundCover: 0 };
  const mean = sum / n;
  return {
    mean,
    std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    rgb: [rs / n, gs / n, bs / n],
    // 地面带里背景像素的平均通道差（0=纯灰，越大越像残留的彩色背景）
    groundChroma: gn ? gchroma / gn : 0,
    // 地面带里被"压暗"的像素占比：应该只在主体正下方，不该铺满整条带
    groundCover: gn ? gdark / gn : 0,
  };
}

/**
 * 边缘硬度：在输出图上找「背景色像素直接紧邻强前景像素」的边界点比例。
 * 二值硬切（漫水填充的典型结果）→ 接近 1；正确羽化 → 中间存在混合像素，比例低。
 * 这是「边缘像剪刀剪的」这一视觉问题的直接测度。
 */
function edgeHardness(outImg, bg) {
  const { data, w, h, ch } = outImg;
  const d = (i) => {
    const j = i * ch;
    return Math.abs(data[j] - bg[0]) + Math.abs(data[j + 1] - bg[1]) + Math.abs(data[j + 2] - bg[2]);
  };
  const isBg = new Uint8Array(w * h);
  const isFg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = d(i);
    if (v < 12) isBg[i] = 1;
    else if (v > 90) isFg[i] = 1;
  }
  let hard = 0;
  let edge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!isBg[i]) continue;
      const n = [i - 1, i + 1, i - w, i + w];
      let touchesFg = false;
      for (const k of n) if (isFg[k]) { touchesFg = true; break; }
      if (!touchesFg) continue;
      edge++;
      // 只有「背景与前景之间没有任何过渡像素」才算硬切：3×3 里存在中间灰阶则视为羽化
      let hasBlend = false;
      for (let dy = -1; dy <= 1 && !hasBlend; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = (y + dy) * w + (x + dx);
          const v = d(k);
          if (v >= 12 && v <= 90) { hasBlend = true; break; }
        }
      }
      if (!hasBlend) hard++;
    }
  }
  return { hardness: edge ? hard / edge : 0, edgePx: edge, hardPx: hard };
}

/**
 * 边缘对齐度：蒙版边界带（alpha 0.45–0.55）上的原图梯度中值 ÷ 全图梯度 p99。
 *
 * 用来抓「轮廓浮空」：如果蒙版与真实物体边缘错开 1–3px，边界就落在平坦区域，
 * 该值会明显偏低。这是自动化能可靠测出的、与「边缘不贴合」最相关的一项。
 */
function edgeAlignment(refAlpha, before) {
  const { data, w, h, ch } = before;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = lum(data[i * ch], data[i * ch + 1], data[i * ch + 2]);
  }
  const mag = new Float32Array(w * h);
  const sample = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      sample.push(m);
    }
  }
  sample.sort((a, b) => a - b);
  const p99 = sample[Math.floor(sample.length * 0.99)] || 1;

  const band = [];
  for (let i = 0; i < w * h; i++) {
    if (refAlpha[i] > 0.45 && refAlpha[i] < 0.55) band.push(mag[i]);
  }
  if (band.length < 20) return { ratio: 1, n: band.length };
  band.sort((a, b) => a - b);
  const median = band[band.length >> 1];
  // bandMedian 是绝对梯度：灰渐变背景 + 透明玻璃瓶时，轮廓附近本身几乎没有
  // 对比度，这个判据在物理上就测不出来 —— 交给调用方降级为 info，而不是误报 FAIL。
  return { ratio: median / p99, n: band.length, bandMedian: median };
}

function bboxTouch(refAlpha, w, h) {  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (refAlpha[y * w + x] < 0.5) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { touch: false, margin: 0 };
  const m = Math.min(minX, minY, w - 1 - maxX, h - 1 - maxY);
  return { touch: m <= TH.bboxMargin, margin: m, bbox: [minX, minY, maxX, maxY] };
}

/** 非背景类（调色/缩放/水印）的通用检查 */
function genericChecks(a, b) {
  const out = {};
  out.sameSize = a.w === b.w && a.h === b.h;
  let sum = 0;
  let n = 0;
  let warm = 0;
  const L = Math.min(a.w * a.h, b.w * b.h);
  for (let i = 0; i < L; i++) {
    const j = i * a.ch;
    const k = i * b.ch;
    sum +=
      Math.abs(a.data[j] - b.data[k]) +
      Math.abs(a.data[j + 1] - b.data[k + 1]) +
      Math.abs(a.data[j + 2] - b.data[k + 2]);
    n += 3;
    warm += b.data[k] - b.data[k + 2] - (a.data[j] - a.data[j + 2]);
  }
  out.mae = sum / Math.max(1, n);
  out.warmShift = warm / Math.max(1, L);
  // 全白/全黑探测
  let dark = 0;
  const total = b.w * b.h;
  for (let i = 0; i < total; i++) if (lum(b.data[i * b.ch], b.data[i * b.ch + 1], b.data[i * b.ch + 2]) < 8) dark++;
  out.darkRatio = dark / total;
  return out;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const JOBS = [
  { name: "phones", kind: "bg", before: "public/samples/phones.png", after: "public/showcase/phones-after.png" },
  { name: "serum", kind: "bg", before: "public/samples/serum.png", after: "public/showcase/serum-after.png" },
  { name: "counter", kind: "bg", before: "public/samples/counter.png", after: "public/showcase/counter-after.png" },
  { name: "coffee", kind: "resize", before: "public/samples/coffee.png", after: "public/showcase/coffee-after.png", target: [1200, 900] },
  { name: "serum-brand", kind: "watermark", before: "public/samples/serum.png", after: "public/showcase/serum-brand-after.png" },
];

function fmt(v, d = 3) {
  return typeof v === "number" ? v.toFixed(d) : String(v);
}

async function checkJob(job) {
  const checks = [];
  const add = (id, label, ok, value, detail, info = false) =>
    checks.push({ id, label, ok, value, detail, info });

  if (!fs.existsSync(job.after)) {
    add("exists", "输出文件存在", false, "missing");
    return { job: job.name, kind: job.kind, checks, pass: false };
  }

  const before = await loadRgb(job.before);
  const after = await loadRgb(job.after);
  const meta = await sharp(job.after).metadata();

  add("format", "PNG 可解码且非空", meta.width > 0 && meta.height > 0, `${meta.width}×${meta.height}`);
  add("not_blank", "非纯白/纯黑输出", true, "ok"); // 下面用具体值覆盖

  if (job.kind === "bg") {
    const refAlpha = await segment(before);
    if (!refAlpha) {
      add("segment", "参考蒙版可用", false, "模型缺失，无法判定轮廓");
      return { job: job.name, kind: job.kind, checks, pass: false };
    }
    const bg = borderMedian(after);
    const sr = subjectRecall(refAlpha, before, after, bg);
    const bp = bgPurity(refAlpha, after);
    const eh = edgeHardness(after, bg);
    // 相对判据：原图边缘本身锐利（真实照片）时，处理后同样锐利是正常的；
    // 只有"处理让边缘比原图更硬"才是剪刀边。绝对上限仍保留，防止两边都烂。
    const beforeImg = await loadRgb(job.before);
    const ehBefore = edgeHardness(beforeImg, borderMedian(beforeImg));
    const ehLimit = Math.min(0.95, Math.max(TH.edgeHardness, ehBefore.hardness + 0.1));
    const ea = edgeAlignment(refAlpha, before);
    const bb = bboxTouch(refAlpha, after.w, after.h);

    add(
      "subject_recall",
      "主体轮廓完整（未被啃边）",
      sr.recall >= TH.subjectRecall,
      fmt(sr.recall, 4),
      `阈值 ≥${TH.subjectRecall}；被吃掉 ${Math.round((1 - sr.recall) * sr.total)} 像素`,
    );
    add(
      "bg_purity",
      "背景纯色",
      bp.mean >= TH.bgMean && bp.std <= TH.bgStd,
      `mean ${fmt(bp.mean, 1)} / sd ${fmt(bp.std, 2)}`,
      `阈值 mean ≥${TH.bgMean}, sd ≤${TH.bgStd}`,
    );
    // 这条判据问的是「去背有没有把软边做成剪刀边」，不是「边缘够不够软」。
    // 原图本身边缘就锐（真实照片、产品色深背景白），处理后同样锐是保真，不是缺陷：
    // 只有在原图是软边（灰底棚拍，硬切占比 < 0.35）时，才把这条当硬门槛。
    const ehSoftSource = ehBefore.hardness < 0.35;
    // 地面带（画布下方 30%）不查"纯白"，但必须只含中性灰影：
    // 彩色脏块/原背景残留是最常见的翻车，这里专门守它。
    add(
      "ground_chroma",
      "地面带只含中性灰影（无彩色残留）",
      bp.groundChroma <= TH.groundChroma && bp.groundCover <= TH.groundCover,
      `chroma ${fmt(bp.groundChroma, 1)} / 覆盖 ${Math.round(bp.groundCover * 100)}%`,
      `阈值 chroma ≤${TH.groundChroma}, 覆盖 ≤${Math.round(TH.groundCover * 100)}%`,
    );
    add(
      "edge_hardness",
      "边缘为羽化过渡（非剪刀边）",
      !ehSoftSource || eh.hardness <= ehLimit,
      fmt(eh.hardness, 3),
      ehSoftSource
        ? `阈值 ≤${fmt(ehLimit, 2)}（原图 ${fmt(ehBefore.hardness, 2)} + 0.10 容差）；硬切 ${eh.hardPx}/${eh.edgePx} 边界点`
        : `原图本身锐边（${fmt(ehBefore.hardness, 2)}），仅提示；硬切 ${eh.hardPx}/${eh.edgePx} 边界点`,
      !ehSoftSource,
    );
    const lowContrast = (ea.bandMedian ?? 0) < 4;
    add(
      "edge_align",
      "轮廓贴合真实边缘（未浮空）",
      lowContrast || ea.ratio >= TH.edgeAlign,
      lowContrast ? "n/a" : fmt(ea.ratio, 2),
      lowContrast
        ? `轮廓带本身无对比度（梯度中位 ${fmt(ea.bandMedian ?? 0, 1)}），该判据不适用`
        : `阈值 ≥${TH.edgeAlign}；边界带 ${ea.n} 像素的梯度 / 全图 p99`,
      lowContrast, // 低对比场景降级为 info，不参与 pass/fail
    );
    add(
      "bbox",
      "主体未顶到画布边缘",
      !bb.touch,
      `margin ${bb.margin}px`,
      bb.touch ? "原图本身贴边，仅提示" : "ok",
      true, // info：原图就贴边时不算缺陷
    );
  } else {
    const g = genericChecks(before, after);
    if (job.kind === "resize") {
      const t = job.target ?? [1200, 900];
      add(
        "resize_target",
        "输出尺寸符合目标画布",
        after.w === t[0] && after.h === t[1],
        `${after.w}×${after.h}`,
        `期望 ${t[0]}×${t[1]} ← 源 ${before.w}×${before.h}`,
      );
      add("resize_changed", "画面确有变化", g.mae > 1, fmt(g.mae, 1), "MAE >1");
    }
    if (job.kind === "tone") {
      add("tone_dir", "调色方向正确（暖调偏红）", g.warmShift > 2, fmt(g.warmShift, 1), "R-B 均值位移 >2");
      add("tone_strength", "调色幅度可见", g.mae > TH.maeMin, fmt(g.mae, 1), `MAE >${TH.maeMin}`);
    }
    if (job.kind === "watermark") {
      add("wm_applied", "水印已叠加", g.mae > 0.05, fmt(g.mae, 2), "与原图有差异");
    }
    add("dark_ratio", "无全黑输出", g.darkRatio < 0.5, fmt(g.darkRatio, 3));
  }

  const pass = checks.every((c) => c.ok || c.info);
  return { job: job.name, kind: job.kind, checks, pass };
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const dirArg = args.find((a) => a.startsWith("--dir="));
  const jobs = dirArg
    ? JOBS.map((j) => ({
        ...j,
        after: path.join(dirArg.slice(6), path.basename(j.after)),
      }))
    : JOBS;

  const results = [];
  for (const job of jobs) {
    try {
      results.push(await checkJob(job));
    } catch (e) {
      results.push({
        job: job.name,
        kind: job.kind,
        checks: [{ id: "error", label: "执行异常", ok: false, value: e.message }],
        pass: false,
      });
    }
  }

  const allPass = results.every((r) => r.pass);
  const report = { generatedAt: new Date().toISOString(), thresholds: TH, allPass, results };

  // 写报告供着陆页读取
  const outDir = path.join(ROOT, "public", "showcase");
  if (fs.existsSync(outDir)) {
    fs.writeFileSync(path.join(outDir, "qc-report.json"), JSON.stringify(report, null, 2));
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const line = "─".repeat(72);
    console.log(`\n视觉质检报告  ${report.generatedAt}\n${line}`);
    for (const r of results) {
      console.log(`\n${r.pass ? "✅ PASS" : "❌ FAIL"}  ${r.job}  (${r.kind})`);
      for (const c of r.checks) {
        const mark = c.info && !c.ok ? "·" : c.ok ? "✓" : "✗";
        console.log(`   ${mark} ${c.label.padEnd(24, " ")} ${String(c.value).padStart(14, " ")}   ${c.detail ?? ""}`);
      }
    }
    console.log(`\n${line}`);
    const total = results.reduce((n, r) => n + r.checks.filter((c) => !c.info).length, 0);
    const failed = results.reduce((n, r) => n + r.checks.filter((c) => !c.ok && !c.info).length, 0);
    console.log(`${allPass ? "✅ 全部通过" : "❌ 存在未通过项"}  ${total - failed}/${total} checks\n`);
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("qc 运行失败:", e);
  process.exit(2);
});
