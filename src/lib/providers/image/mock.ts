/**
 * Mock 图像 provider —— 仅供本地验收用，不接任何真实模型。
 *
 * 只替换"最外层的模型调用"，其余路由/校验/积分/持久化全部走真实代码。
 * 出图时本地用 sharp 渲染一张带标签的 PNG 写入 public/mock/，
 * 返回由 dev server 直接托管的 URL（http://127.0.0.1:3000/mock/...），
 * 这样真实路由里的 fetch → 转码 → 持久化链路都能跑通，前端也能看到图。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const OUT_DIR = path.resolve(process.cwd(), "public/mock");
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
let n = 0;

async function render(label: string, grid = false): Promise<string> {
  n++;
  const id = `mk${n}_${Date.now()}`;
  await mkdir(OUT_DIR, { recursive: true });
  if (grid) {
    const cells = Array.from(
      { length: 9 },
      (_, i) =>
        `<g transform="translate(${(i % 3) * 256},${Math.floor(i / 3) * 256})">` +
        `<rect width="256" height="256" fill="hsl(${(i * 40) % 360} 55% 55%)"/>` +
        `<text x="128" y="140" font-size="22" fill="#fff" text-anchor="middle">#${i + 1}</text></g>`,
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><rect width="768" height="768" fill="#111"/>${cells}</svg>`;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    await writeFile(path.join(OUT_DIR, `${id}.png`), buf);
    return `${BASE}/mock/${id}.png`;
  }
  const w = 512;
  const h = 512;
  const hue = (n * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="hsl(${hue} 55% 50%)"/>` +
    `<text x="${w / 2}" y="${h / 2}" font-size="24" fill="#fff" text-anchor="middle">${label.slice(0, 22)}</text></svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(path.join(OUT_DIR, `${id}.png`), buf);
  return `${BASE}/mock/${id}.png`;
}

export const mockImageProvider: ImageProvider = {
  name: "mock",

  isConfigured() {
    return true;
  },

  missingKeyMessage() {
    return "mock image provider is always configured (no key needed for local verification)";
  },

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    try {
      const url = await render(req.prompt);
      return { ok: true, urls: [url], model: "mock" };
    } catch (e) {
      return { ok: false, status: 500, detail: String(e) };
    }
  },

  async generateGrid(req: ImageGenRequest): Promise<ImageGenResult> {
    try {
      const url = await render(req.prompt, true);
      return { ok: true, urls: [url], model: "mock" };
    } catch (e) {
      return { ok: false, status: 500, detail: String(e) };
    }
  },
};
