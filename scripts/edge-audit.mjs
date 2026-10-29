#!/usr/bin/env node
/**
 * edge-audit.mjs — 生成「边缘放大审阅图」（edge-audit.png）
 *
 * 为什么需要：2026-10 两次交付都栽在边缘上——空白图看着还行，放大 5 倍就能看到
 * 台阶、毛刺、脏边。而这类问题**量化指标抓不稳**（我试过轮廓抖动的 RMS、
 * 过渡带宽度变异系数、形态学粗糙度，在白底合成图上区分度都不足 2 倍）。
 *
 * 结论：自动门禁只能兜底"灾难"，"好不好看"必须人眼。所以这里不做判定，
 * 只做一件事——把主体边缘按轮廓均匀取 12 处、每处 100×100 放大 5 倍拼成一张
 * 宫格图，交付前打开看一眼就知道过不过。
 *
 * 用法：
 *   node scripts/edge-audit.mjs                       # 默认审 phones-after.png
 *   node scripts/edge-audit.mjs <输入> <输出>
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const CELL = 100; // 原始裁剪边长
const ZOOM = 5; // 放大倍数
const COLS = 4;
const ROWS = 3;
const GAP = 6;

const src = process.argv[2] || "public/showcase/phones-after.png";
const dst = process.argv[3] || "public/showcase/edge-audit.png";

/** 与背景色的距离 → 主体掩码 */
function maskOf(data, w, h, ch, thr = 14) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * ch;
    const d = Math.max(255 - data[j], 255 - data[j + 1], 255 - data[j + 2]);
    m[i] = d > thr ? 1 : 0;
  }
  return m;
}

/** 轮廓像素（mask 内、且 4 邻域有不属于 mask 的） */
function boundary(m, w, h) {
  const pts = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      if (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) pts.push([x, y]);
    }
  }
  return pts;
}

/** 沿轮廓按弧长均匀取 n 个点（贪心：只保留与已选点间隔 >= minGap 的） */
function spread(pts, n, minGap) {
  const out = [];
  let last = null;
  const stride = Math.max(1, Math.floor(pts.length / 400));
  for (let i = 0; i < pts.length; i += stride) {
    const p = pts[i];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < minGap) continue;
    out.push(p);
    last = p;
    if (out.length >= n * 6) break;
  }
  // 均匀抽 n 个
  const picked = [];
  for (let k = 0; k < n; k++) {
    const idx = out.length > n ? Math.floor((k * out.length) / n) : k;
    if (out[idx]) picked.push(out[idx]);
  }
  return picked;
}

async function main() {
  const file = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
  if (!fs.existsSync(file)) {
    console.error(`找不到 ${file}`);
    process.exit(1);
  }
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const m = maskOf(data, w, h, ch);
  const pts = boundary(m, w, h);
  if (!pts.length) {
    console.error("没找到主体边界");
    process.exit(1);
  }

  const pad = CELL / 2 + 2;
  const usable = pts.filter(([x, y]) => x > pad && x < w - pad && y > pad && y < h - pad);
  const picked = spread(usable.length ? usable : pts, COLS * ROWS, w / 12);

  const cellPx = CELL * ZOOM;
  const W = COLS * cellPx + (COLS + 1) * GAP;
  const H = ROWS * cellPx + (ROWS + 1) * GAP;

  const overlay = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#ffffff"/>
      ${picked
        .map((_, i) => {
          const cx = GAP + (i % COLS) * (cellPx + GAP);
          const cy = GAP + Math.floor(i / COLS) * (cellPx + GAP);
          return `<rect x="${cx}" y="${cy}" width="${cellPx}" height="${cellPx}" fill="none" stroke="#e5e5e5" stroke-width="1"/>
                  <line x1="${cx + cellPx / 2 - 10}" y1="${cy + cellPx / 2}" x2="${cx + cellPx / 2 + 10}" y2="${cy + cellPx / 2}" stroke="#ff3355" stroke-width="1" opacity="0.55"/>
                  <line x1="${cx + cellPx / 2}" y1="${cy + cellPx / 2 - 10}" x2="${cx + cellPx / 2}" y2="${cy + cellPx / 2 + 10}" stroke="#ff3355" stroke-width="1" opacity="0.55"/>
                  <text x="${cx + 6}" y="${cy + 16}" font-family="monospace" font-size="12" fill="#888">${picked[i][0]},${picked[i][1]}</text>`;
        })
        .join("\n")}
    </svg>`,
  );

  const composites = [];
  picked.forEach(([x, y], i) => {
    const left = Math.max(0, Math.min(w - CELL, x - CELL / 2));
    const top = Math.max(0, Math.min(h - CELL, y - CELL / 2));
    composites.push({
      extract: { left, top, width: CELL, height: CELL },
      left: GAP + (i % COLS) * (cellPx + GAP),
      top: GAP + Math.floor(i / COLS) * (cellPx + GAP),
    });
  });

  // 逐格裁剪放大后再合成（sharp 不能在一次 composite 里做 extract+resize）
  const tiles = [];
  for (const c of composites) {
    const buf = await sharp(file)
      .removeAlpha()
      .extract(c.extract)
      .resize(cellPx, cellPx, { kernel: "nearest" })
      .png()
      .toBuffer();
    tiles.push({ input: buf, left: c.left, top: c.top });
  }

  const outFile = path.isAbsolute(dst) ? dst : path.join(process.cwd(), dst);
  await sharp(overlay).composite(tiles).png().toFile(outFile);
  console.log(`✓ ${path.relative(process.cwd(), outFile)}  ${W}×${H}（${picked.length} 处边界 ×${ZOOM}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
