import { chromium } from "playwright";
import fs from "node:fs";
import { PNG as PngJs } from "pngjs";

const BASE = process.env.BASE || "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(5000);

// 找到所有 .ba 对比容器，对每个抓取 0% / 100% 元素截图并比对
const handles = await page.$$(".ba");
console.log("发现 .ba 容器数:", handles.length);
if (handles.length === 0) {
  console.log("✗ 未发现任何对比卡容器，页面可能未渲染");
  await browser.close();
  process.exit(1);
}
let allOk = true;
for (let i = 0; i < handles.length; i++) {
  const el = handles[i];
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  // 在 .ba 上设 --pos，clip-path 子层继承
  await el.evaluate((node) => {
    node.style.setProperty("--pos", "0%");
    node.querySelectorAll("*").forEach((c) => c.style.setProperty("--pos", "0%"));
  });
  await page.waitForTimeout(150);
  await el.screenshot({ path: `/tmp/slider-${i}-0.png` });
  await el.evaluate((node) => {
    node.style.setProperty("--pos", "100%");
    node.querySelectorAll("*").forEach((c) => c.style.setProperty("--pos", "100%"));
  });
  await page.waitForTimeout(150);
  await el.screenshot({ path: `/tmp/slider-${i}-100.png` });

  const a = PngJs.sync.read(fs.readFileSync(`/tmp/slider-${i}-0.png`));
  const b = PngJs.sync.read(fs.readFileSync(`/tmp/slider-${i}-100.png`));
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  let diff = 0, tot = 0, maxd = 0;
  for (let p = 0; p < w * h; p++)
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]);
      diff += d; tot += 255; if (d > maxd) maxd = d;
    }
  const mae = diff / tot;
  const ok = mae > 0.01;
  allOk = allOk && ok;
  console.log(`滑块#${i}: ${w}x${h} MAE=${mae.toFixed(4)} maxΔ=${maxd} ${ok ? "✓ 两端明显不同" : "✗ 相同"}`);
}
await browser.close();
console.log(allOk ? "\n✓ 所有对比卡两端均有可见差异" : "\n✗ 存在无差异的对比卡");
process.exit(allOk ? 0 : 1);
