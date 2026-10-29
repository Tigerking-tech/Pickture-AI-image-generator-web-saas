/**
 * grade.ts — 专业级调色与商品图合成（Surepix 自研算子）
 *
 * 为什么不用「色相旋转 + 提饱和」那种做法：
 *   全局 hue rotate 会把暖橙推成番茄红，并且把中性灰背景一起染色，
 *   这是业余调色的两个典型症状（见 2026-10 的 showcase 事故）。
 *
 * 这里的做法对齐 Lightroom / Capture One 的实际模型：
 *   1. 在 OKLab（感知均匀空间）里分离亮度 L 与色度 (a,b)；
 *   2. 亮度走 filmic S 曲线 + 高光 roll-off，避免管壁过曝成纯色块；
 *   3. 色相定向收敛：把色相往目标暖色锚点（默认 72°，琥珀橙）**部分**拉回，
 *      而不是整体旋转 —— 偏红的会被拉回橙，偏黄的不会被推成红；
 *   4. 饱和按 chroma 分段：低饱和（近灰）少动，中饱和提升，高饱和收缩，
 *      避免出现「荧光色」；
 *   5. split toning：高光加暖、阴影加冷，还原真实光线的冷暖分离；
 *   6. 低 chroma 的中性像素做保护，白底 / 灰背景不会被染色。
 *
 * 全部纯 TypeScript，无外部二进制，可在离线 / DEMO_MODE 下运行。
 */

export interface RGBImg {
  w: number;
  h: number;
  rgb: Float64Array;
}

export interface GradeOptions {
  /** 曝光补偿（EV），默认 +0.08 */
  exposure?: number;
  /** 对比度 0-1，默认 0.16 */
  contrast?: number;
  /** 暖调强度 0-1，默认 0.5 */
  warmth?: number;
  /** 目标暖色相（OKLab 色相角，度）。不填则用画面主色相 + warmShift 自适应 */
  targetHue?: number;
  /** 自适应时相对主色相的暖向偏移（度），默认 +8 */
  warmShift?: number;
  /** 向目标色相收敛的比例 0-1，默认 0.3 */
  huePull?: number;
  /** 中饱和增益，默认 0.12 */
  satBoost?: number;
  /** 高光 roll-off 强度 0-1，默认 0.55 */
  highlightRolloff?: number;
  /** 阴影加冷强度 0-1，默认 0.35 */
  shadowCool?: number;
  /** 只处理该 alpha>0 的像素（去背后调色，背景不受影响） */
  alpha?: Float64Array;
  /** 中性色保护强度 0-1，默认 0.85 */
  neutralGuard?: number;
}

/* ── sRGB ↔ 线性光 ─────────────────────────────────────────────────────── */

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

/* ── OKLab 正逆变换（Björn Ottosson） ──────────────────────────────────── */

function linToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

function oklabToLin(L: number, A: number, B: number): [number, number, number] {
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.291485548 * B;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/* ── 单调 filmic S 曲线（0-1 → 0-1） ───────────────────────────────────── */

function filmic(x: number, contrast: number, rolloff: number): number {
  const xc = x < 0 ? 0 : x > 1 ? 1 : x;
  // 对称 S：在 0.5 处斜率 1+k，两端趋 0 但不夹死
  const k = contrast * 1.6;
  const s = xc + k * (xc - 0.5) * (1 - Math.abs(xc - 0.5) * 2) * 0.5;
  // 高光 roll-off：超过 0.82 后软压缩，避免管壁高光结成纯色块
  const t0 = 0.82;
  let out = s;
  if (s > t0) {
    const span = 1 - t0;
    const u = (s - t0) / span;
    const comp = 1 - (1 - rolloff * 0.5) * (1 - u) ** 2;
    out = t0 + span * comp;
  }
  return out < 0 ? 0 : out > 1 ? 1 : out;
}

/* ── 主算子 ────────────────────────────────────────────────────────────── */

/**
 * 估计画面主色相（OKLab 色相角，弧度）：只统计有彩度的像素，取圆均值。
 * 用于「相对暖调」——以素材本身的颜色为基准往暖挪，避免把橙推成红、
 * 或把棕推成土黄。
 */
export function estimateHue(img: RGBImg, alpha?: Float64Array): number {
  let sc = 0;
  let ss = 0;
  let n = 0;
  const step = Math.max(1, Math.round(Math.sqrt((img.w * img.h) / 20000)));
  for (let y = 0; y < img.h; y += step) {
    for (let x = 0; x < img.w; x += step) {
      const i = y * img.w + x;
      if (alpha && alpha[i] < 0.9) continue;
      const r = SRGB_TO_LINEAR[Math.round(img.rgb[i * 3])];
      const g = SRGB_TO_LINEAR[Math.round(img.rgb[i * 3 + 1])];
      const b = SRGB_TO_LINEAR[Math.round(img.rgb[i * 3 + 2])];
      const [, A, B] = linToOklab(r, g, b);
      const C = Math.hypot(A, B);
      if (C < 0.035) continue; // 近灰不计入
      sc += Math.cos(Math.atan2(B, A)) * C;
      ss += Math.sin(Math.atan2(B, A)) * C;
      n++;
    }
  }
  if (n < 50 || Math.hypot(sc, ss) < 1e-6) return (60 * Math.PI) / 180;
  return Math.atan2(ss, sc);
}

export function gradePro(img: RGBImg, opts: GradeOptions = {}): RGBImg {
  const exposure = opts.exposure ?? 0.08;
  const contrast = opts.contrast ?? 0.16;
  const warmth = opts.warmth ?? 0.5;
  // 暖色锚点：只有画面主色相本身落在暖区（0-130° / 340°+）时才拿它当基准，
  // 否则用标准橙色锚点。否则一张蓝色产品图的主色相会把「暖色系」像素
  // 反向拉进黄绿区（实测：褐色内饰被拉成荧光绿）。
  const warmShift = ((opts.warmShift ?? 8) * Math.PI) / 180;
  let targetHue: number;
  if (opts.targetHue !== undefined) {
    targetHue = (opts.targetHue * Math.PI) / 180;
  } else {
    const h0 = estimateHue(img, opts.alpha);
    const deg = ((h0 * 180) / Math.PI + 360) % 360;
    const inWarmZone = deg < 130 || deg > 340;
    targetHue = (inWarmZone ? h0 : (62 * Math.PI) / 180) + warmShift;
  }
  const huePull = opts.huePull ?? 0.3;
  const satBoost = opts.satBoost ?? 0.12;
  const rolloff = opts.highlightRolloff ?? 0.55;
  const shadowCool = opts.shadowCool ?? 0.35;
  const guard = opts.neutralGuard ?? 0.85;
  const alpha = opts.alpha;
  const gain = 2 ** exposure;

  const out = new Float64Array(img.rgb.length);
  const n = img.w * img.h;

  const tA = Math.cos(targetHue);
  const tB = Math.sin(targetHue);

  for (let i = 0; i < n; i++) {
    const a = alpha ? alpha[i] : 1;
    if (a <= 0.002) {
      // 背景：原样输出（白底保持纯白）
      out[i * 3] = img.rgb[i * 3];
      out[i * 3 + 1] = img.rgb[i * 3 + 1];
      out[i * 3 + 2] = img.rgb[i * 3 + 2];
      continue;
    }
    const r0 = SRGB_TO_LINEAR[Math.round(img.rgb[i * 3])] * gain;
    const g0 = SRGB_TO_LINEAR[Math.round(img.rgb[i * 3 + 1])] * gain;
    const b0 = SRGB_TO_LINEAR[Math.round(img.rgb[i * 3 + 2])] * gain;

    // 色温：线性光下的白点增益（R↑ / B↓），是【乘】不是【加】。
    // 之前用加法，暗部被加了一个相对极大的偏移：黑色金属盖 (16,14,11) 直接变成
    // (35,19,0) —— 一张蓝瓶照片的盖子成了金色。乘增益对暗部的影响按比例缩放，
    // 深色表面才不会被"打上一层橙光"。
    const rt = r0 * (1 + 0.16 * warmth);
    const gt = g0 * (1 + 0.045 * warmth);
    const bt = b0 * (1 - 0.15 * warmth);

    // 线性域高光软压缩：色温增益会把 R 推过 1，若直接裁剪就变成纯红色块
    // （旧版「番茄红」的另一半原因）。这里用指数肩部平滑回到 [0,1]。
    // 注意必须先夹到 0：暖光会减蓝，暗部 B 可能变负；OKLab 的 cbrt 对负数
    // 有定义，会让深蓝暗部算出完全错误的色相（实测出现绿色斑块）。
    const shoulder = (v: number) =>
      v <= 0 ? 0 : v <= 0.8 ? v : 0.8 + 0.2 * (1 - Math.exp(-(v - 0.8) * 3));

    const [L, A0, B0] = linToOklab(shoulder(rt), shoulder(gt), shoulder(bt));

    // 1) 亮度：S 曲线 + roll-off
    const L2 = filmic(L, contrast, rolloff);

    // 2) 色度：极坐标
    let C = Math.hypot(A0, B0);
    let H = C > 1e-6 ? Math.atan2(B0, A0) : targetHue;

    // 3) 色相定向收敛：只对暖色系（橙/黄/褐，OKLab 0-130°）生效，
    //    冷色交给色温增益处理 —— 强拉蓝紫产品会变成脏灰。
    const hueDeg = ((H * 180) / Math.PI + 360) % 360;
    const isWarmFamily = hueDeg < 130 || hueDeg > 340;
    if (C > 1e-4 && isWarmFamily) {
      let dH = targetHue - H;
      while (dH > Math.PI) dH -= Math.PI * 2;
      while (dH < -Math.PI) dH += Math.PI * 2;
      H += dH * huePull * warmth;
      // 收敛后仍夹在暖区，绝不允许跨过 130° 溜进黄绿
      const after = ((H * 180) / Math.PI + 360) % 360;
      if (after >= 130 && after <= 340) H = (125 * Math.PI) / 180;
    }

    // 4) 饱和分段：暖色系小幅提升、冷色系小幅收敛，高饱和一律收缩
    //    （只做「暖色更醇厚」，不做「全图加饱和」—— 后者会把灰蓝变成荧光蓝）
    const boost = isWarmFamily ? satBoost : -satBoost * 0.55;
    const satCurve = (c: number) => {
      if (c < 0.02) return c * (1 + boost * 0.15); // 近灰：几乎不动
      if (c < 0.12) return c * (1 + boost); // 中低
      if (c < 0.22) return c * (1 + boost * 0.45); // 中高
      return c * (1 - 0.08); // 高饱和：略收缩，避免荧光
    };
    C = satCurve(C);

    // 5) split toning：高光加暖、阴影加冷（色温的主体来源）
    const hiW = Math.max(0, Math.min(1, (L2 - 0.42) / 0.5));
    const loW = Math.max(0, Math.min(1, (0.42 - L2) / 0.5));
    let dA = tA * 0.05 * (0.35 + 0.65 * hiW) * warmth;
    let dB = tB * 0.05 * (0.35 + 0.65 * hiW) * warmth;
    dA -= 0.008 * loW * shadowCool;
    dB += 0.014 * loW * shadowCool;

    // 中性保护：chroma 越低越只走「色温」路径，不做色相重定向
    // （灰背景/白底不会被染成橙色，这是旧实现最大的破绽）
    const neutral = 1 - guard + guard * Math.exp(-((C / 0.045) ** 2));

    // 路径 A：彩色像素 —— 色相收敛 + 分段饱和
    const aColor = Math.cos(H) * C + dA;
    const bColor = Math.sin(H) * C + dB;
    // 路径 B：中性像素 —— 只保留线性色温带来的变化，不叠加 OKLab 的分离色调
    // （灰底 / 白盖 / 金属高光一旦被 dA 染色，整张图就会发橙，这是第三个翻车点）
    const aNeutral = A0;
    const bNeutral = B0;

    const mixA = aNeutral * neutral + aColor * (1 - neutral);
    const mixB = bNeutral * neutral + bColor * (1 - neutral);

    const [lr, lg, lb] = oklabToLin(L2, mixA, mixB);
    const sr = linearToSrgb(lr) * 255;
    const sg = linearToSrgb(lg) * 255;
    const sb = linearToSrgb(lb) * 255;

    if (a >= 0.998) {
      out[i * 3] = sr;
      out[i * 3 + 1] = sg;
      out[i * 3 + 2] = sb;
    } else {
      // 半透明边：与自身原值混合，避免羽化边缘被调色推出生硬的色环
      out[i * 3] = img.rgb[i * 3] * (1 - a) + sr * a;
      out[i * 3 + 1] = img.rgb[i * 3 + 1] * (1 - a) + sg * a;
      out[i * 3 + 2] = img.rgb[i * 3 + 2] * (1 - a) + sb * a;
    }
  }
  return { w: img.w, h: img.h, rgb: out };
}

/* ── 接地投影（商品图「站稳」的关键） ──────────────────────────────────── */

export interface ShadowOptions {
  /** 投影不透明度 0-1，默认 0.26 */
  opacity?: number;
  /** 垂直衰减带高度（相对画布高），默认 0.022 */
  band?: number;
  /** 横向扩散（像素），默认按画布宽度 0.6% */
  spread?: number;
  /** 背景色（0-255），默认纯白 */
  bg?: [number, number, number];
}

/**
 * 接触投影（contact shadow）—— 商品图「放在台面上」的那层薄影。
 *
 * 不做整块 alpha 压扁模糊，因为多物体场景下会互相污染成灰雾、
 * 还会在物体之间留下悬浮的「鬼影」（2026-10 实测的翻车点）。
 * 这里改用**列底轮廓**建模：每列取主体最下方像素 y_b(x)，
 * 在该列下方画一条短距离垂直衰减的暗带，横向对 y_b 做平滑。
 * 结果是每个物体各自贴地、互不干扰，且不会浮空。
 */
export function contactShadow(img: RGBImg, alpha: Float64Array, opts: ShadowOptions = {}): RGBImg {
  const opacity = opts.opacity ?? 0.26;
  const band = Math.max(3, Math.round((opts.band ?? 0.055) * img.h));
  // 列底平滑半径：太小的话，底部是圆角时影会跟着列底的台阶走出尖角（5× 放大可见）
  const spread = Math.max(1, Math.round((opts.spread ?? 0.014) * img.w));
  const bg = opts.bg ?? [255, 255, 255];
  const { w, h } = img;

  // 1) 每列的主体底部（无主体列 -1）
  const raw = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x++) {
    for (let y = h - 1; y >= 0; y--) {
      if (alpha[y * w + x] > 0.3) {
        raw[x] = y;
        break;
      }
    }
  }
  if (!raw.some((v) => v >= 0)) return { w, h, rgb: Float64Array.from(img.rgb) };

  // 2) 只给「真的站在地面」的主体加影：用整体最低点判断，而不是逐列卡阈值。
  //    逐列判会出问题——物体是圆底/斜底时，列底天然分布在几十像素的区间里，
  //    硬阈值只放行最底部那几列，影就细成一条几乎看不见的线（2026-10 实测）。
  let y0 = -1;
  for (let x = 0; x < w; x++) if (raw[x] > y0) y0 = raw[x];
  if (y0 < h * 0.9) return { w, h, rgb: Float64Array.from(img.rgb) }; // 整体悬空，不加地面影
  // 主体被画布下缘裁切（列底贴着最后几行）：它不是"站"在画布底，而是被切断了，
  // 给它加地面影只会在角落漏出一块灰斑（serum 前瓶实测）。
  if (y0 >= h - 2) return { w, h, rgb: Float64Array.from(img.rgb) };
  // 只保留靠近最低点的列：把同一物体上明显更高的细枝/宽肩排除，
  // 避免它们各自的"底部"把影带到半空。
  const near = Math.round(h * 0.06);
  for (let x = 0; x < w; x++) {
    if (raw[x] >= 0 && raw[x] < y0 - near) raw[x] = -1;
  }
  if (!raw.some((v) => v >= 0)) return { w, h, rgb: Float64Array.from(img.rgb) };

  // 3) 横向平滑列底；只在本列确有主体（或紧邻主体）时出影，
  //    否则会在画布空白处拖出一条横向灰带（实测翻车点）。
  const valid = new Uint8Array(w);
  for (let x = 0; x < w; x++) if (raw[x] >= 0) valid[x] = 1;
  for (let x = 0; x < w; x++) {
    if (!valid[x]) continue;
    for (let k = -spread; k <= spread; k++) {
      const j = x + k;
      if (j >= 0 && j < w) valid[j] = 1;
    }
  }
  const filled = new Float64Array(w).fill(Number.NaN);
  for (let x = 0; x < w; x++) if (raw[x] >= 0) filled[x] = raw[x];
  const smooth = maskedBlur1d(filled, w, valid, spread);

  // 3b) 横向边缘渐隐：valid 的左右边界是"有/无"的硬切换，
  //     直接用会让阴影带两端像被刀切出直角。这里按距离把强度收到 0。
  const fadeX = new Float64Array(w);
  const fx = Math.max(4, Math.round(w * 0.02));
  for (let x = 0; x < w; x++) {
    if (!valid[x]) continue;
    let d = fx;
    for (let k = 1; k <= fx; k++) {
      if (x - k < 0 || !valid[x - k]) {
        d = Math.min(d, k);
        break;
      }
    }
    for (let k = 1; k <= fx; k++) {
      if (x + k >= w || !valid[x + k]) {
        d = Math.min(d, k);
        break;
      }
    }
    fadeX[x] = Math.min(1, d / fx);
  }

  // 4) 先算"阴影场"，再做横向扩散。
  //    逐列直接写像素的话，影只存在于"有主体的列"，瓶脚外侧是一条垂直直边
  //    （5× 放大一眼可见，像贴了张灰纸）。这里改成先铺场、再横向模糊，
  //    影就会从脚下自然散开。
  let yLo = Number.POSITIVE_INFINITY;
  let yHi = Number.NEGATIVE_INFINITY;
  for (let x = 0; x < w; x++) {
    const v = smooth[x];
    if (!Number.isFinite(v)) continue;
    if (v < yLo) yLo = v;
    if (v > yHi) yHi = v;
  }
  if (!Number.isFinite(yLo)) return { w, h, rgb: Float64Array.from(img.rgb) };
  const yTop = Math.max(0, Math.floor(yLo - band * 0.35));
  const yBot = Math.min(h, Math.ceil(yHi + band) + 1);
  const fh = yBot - yTop;

  const field = new Float64Array(w * fh);
  for (let x = 0; x < w; x++) {
    const yb = smooth[x];
    if (!Number.isFinite(yb)) continue;
    for (let y = yTop; y < yBot; y++) {
      const d = y - yb;
      if (d < -band * 0.35 || d > band) continue;
      const t = d < 0 ? 0 : d / band;
      // 指数衰减（不是高斯）：真实接触影是"贴地处最重、很快松开"，
      // 高斯曲线在前 40% 里几乎不掉，画出来是一片均匀薄雾，看着不像落地。
      const k = opacity * Math.exp(-t * 3.4) * (d < 0 ? 0.85 : 1) * fadeX[x];
      if (k < 0.002) continue;
      field[(y - yTop) * w + x] = k;
    }
  }

  // 横向两趟 box blur ≈ 高斯（O(n)，只在阴影带内跑）
  const rb = Math.max(2, Math.round(band * 0.3));
  const tmp = new Float64Array(w * fh);
  for (let row = 0; row < fh; row++) {
    const o = row * w;
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? field : tmp;
      const dst = pass === 0 ? tmp : field;
      let acc = 0;
      for (let x = -rb; x <= rb; x++) acc += src[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        dst[o + x] = acc / (2 * rb + 1);
        const add = src[o + Math.min(w - 1, x + rb + 1)];
        const sub = src[o + Math.max(0, x - rb)];
        acc += add - sub;
      }
    }
  }

  // 5) 合成：主体本身不动（alpha > 0.25 的像素原样保留）
  const out = Float64Array.from(img.rgb);
  for (let y = yTop; y < yBot; y++) {
    const row = (y - yTop) * w;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i] > 0.25) continue;
      const k = Math.min(0.85, field[row + x]);
      if (k < 0.004) continue;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = bg[c] * (1 - k);
    }
  }
  return { w, h, rgb: out };
}

/** 只在 valid 列上有定义的 1D 均值平滑（无效列保持 NaN，不外推） */
function maskedBlur1d(src: Float64Array, n: number, valid: Uint8Array, r: number): Float64Array {
  const out = new Float64Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    let acc = 0;
    let cnt = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const v = src[j];
      if (!Number.isFinite(v)) continue;
      acc += v;
      cnt++;
    }
    if (cnt) out[i] = acc / cnt;
  }
  return out;
}
