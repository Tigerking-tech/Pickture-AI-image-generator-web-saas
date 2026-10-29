/**
 * 防回归：去背必须"削不掉主体"，边缘必须是软的。
 *
 * 这两个断言直接来自 2026-10 的事故——旧的颜色容差漫水填充把耳机盒底缘
 * 当作背景吃掉 8844 像素，而当时的全局指标（MAE/SSIM）反而显示"更好"。
 * 任何人把去背改回按颜色容差切的实现，这里会立刻红。
 */
import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../src/lib/fidelity";
import { runChainOnBuffer } from "../../src/lib/js-engine";
import { modelAvailable, segmentAlpha } from "../../src/lib/rmbg";

const SAMPLE = "public/samples/phones.png";
const hasModel = modelAvailable();

describe("去背（RMBG 语义分割）", () => {
  it.skipIf(!hasModel)(
    "参考 alpha 是软过渡而非二值",
    async () => {
      const alpha = await segmentAlpha(decodePng(fs.readFileSync(SAMPLE)));
      expect(alpha).not.toBeNull();
      let soft = 0;
      for (const v of alpha as Uint8Array) if (v > 12 && v < 243) soft++;
      expect(soft).toBeGreaterThan(200);
    },
    120_000,
  );

  it.skipIf(!hasModel)(
    "去白底后主体轮廓保留率 ≥ 0.995（不被啃边）",
    async () => {
      const buf = fs.readFileSync(SAMPLE);
      const alpha = await segmentAlpha(decodePng(buf));
      expect(alpha).not.toBeNull();

      const r = await runChainOnBuffer(buf, [
        { cmd: "select.subject" },
        { cmd: "select.inverse" },
        { cmd: "edit.fill", params: { contents: "white" } },
      ]);
      expect(r.ok).toBe(true);

      const { data, info } = await sharp(Buffer.from(r.base64, "base64"))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      let hit = 0;
      let total = 0;
      for (let i = 0; i < (alpha as Uint8Array).length; i++) {
        if ((alpha as Uint8Array)[i] < 128) continue;
        total++;
        const j = i * info.channels;
        const d = Math.abs(data[j] - 255) + Math.abs(data[j + 1] - 255) + Math.abs(data[j + 2] - 255);
        if (d > 30) hit++;
      }
      expect(total).toBeGreaterThan(1000);
      expect(hit / total).toBeGreaterThanOrEqual(0.995);
    },
    120_000,
  );
});
