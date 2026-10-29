import { chromium } from "playwright";
import fs from "node:fs";
import { PNG as PngJs } from "pngjs";

const BASE_HOST = process.env.BASE_HOST || "http://localhost:3000";
const SHARE = process.env.SHARECODE ? `?sharecode=${process.env.SHARECODE}` : "";
const route = (p) => `${BASE_HOST}${p}${SHARE}`;
const BASE = BASE_HOST;
const results = [];
const errors = [];
const log = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
};

function diffPng(pathA, pathB) {
  const a = PngJs.sync.read(fs.readFileSync(pathA));
  const b = PngJs.sync.read(fs.readFileSync(pathB));
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  let diff = 0, tot = 0, maxd = 0;
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]);
      diff += d; tot += 255; if (d > maxd) maxd = d;
    }
  }
  return { mae: diff / tot, maxd };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") errors.push(`[console] ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

// ---- 1) Landing 对比滑块：真实拖到两端后截图比对 ----
// 注意：BeforeAfter 用 React state 控制分割线位置，写 CSS 变量无效；
// 必须用指针真实拖动，否则两次截图都是同一位置（MAE 恒为 0 的假失败）。
await page.goto(route("/"), { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(5000);

// 1a) 展示图必须都真的加载成功（防 404 / 破损图）
const imgStats = await page.evaluate(() =>
  [...document.querySelectorAll("img")]
    .filter((i) => i.getAttribute("src")?.includes("/showcase/"))
    .map((i) => ({ src: i.getAttribute("src"), w: i.naturalWidth, h: i.naturalHeight })),
);
const broken = imgStats.filter((i) => i.w === 0 || i.h === 0);
log(
  "landing 展示图全部加载成功",
  imgStats.length > 0 && broken.length === 0,
  `${imgStats.length} 张，破损 ${broken.length}${broken.length ? "：" + broken.map((b) => b.src).join(",") : ""}`,
);

// 1b) 拖动滑块到两端：用 Playwright locator 取坐标（自动处理滚动/变换），
//     功能上读 `--pos` CSS 变量确认分割线真的移动，并对滑块区域做裁剪像素 diff。
let baBox = null;
let baLoc = null;
const baAll = page.locator(".ba");
const baCount = await baAll.count();
for (let i = 0; i < baCount; i++) {
  const loc = baAll.nth(i);
  try {
    await loc.waitFor({ state: "visible", timeout: 4000 });
    const b = await loc.boundingBox();
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.width > 50 && b.height > 20 && b.y < 900) { baBox = b; baLoc = loc; break; }
  } catch {
    /* 该滑块不可见，尝试下一个 */
  }
}
if (baLoc) {
  const box = baBox;
  const readPos = () =>
    baLoc.evaluate((el) => Number(getComputedStyle(el).getPropertyValue("--pos").replace("%", "")) || 0);
  const dragTo = async (fx) => {
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) throw new Error("坐标非有限值，跳过拖动");
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * fx, cy, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(450);
  };
  const pos0 = await readPos();
  await dragTo(0.98); // 几乎全 before
  const posA = await readPos();
  await baLoc.screenshot({ path: "/tmp/ba-a.png" });
  await dragTo(0.02); // 几乎全 after
  const posB = await readPos();
  await baLoc.screenshot({ path: "/tmp/ba-b.png" });
  const moved = Math.abs(posA - posB) > 30; // 两端位置差应 >30%
  log(
    "landing 对比卡滑块可拖动（分割线位置变化）",
    moved,
    `pos ${pos0.toFixed(0)}% → ${posA.toFixed(0)}% → ${posB.toFixed(0)}%`,
  );
  const d = diffPng("/tmp/ba-a.png", "/tmp/ba-b.png");
  log("landing 对比卡 before/after 露出区域像素差", d.mae > 0.01, `MAE=${d.mae.toFixed(4)} maxΔ=${d.maxd}`);

// 1a-2) 逐个能力 tab 点开：默认只渲染第一个 tab，其余 tab 的 before/after
// 不会预加载，图 404 在这之前是查不出来的。
const capTabs = await page.locator(".cap-tab");
const tabN = await capTabs.count();
const tabBroken = [];
for (let i = 0; i < tabN; i++) {
  await capTabs.nth(i).click();
  await page.waitForTimeout(650);
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll(".cap-panel img")]
      .filter((im) => !im.complete || im.naturalWidth === 0)
      .map((im) => im.getAttribute("src")),
  );
  tabBroken.push(...bad);
}
if (tabN > 0) await capTabs.nth(0).click();
await page.waitForTimeout(300);
log(
  `每个能力 tab 的 before/after 都能加载（${tabN} 个 tab）`,
  tabN > 0 && tabBroken.length === 0,
  tabBroken.length ? tabBroken.slice(0, 3).join(", ") : `${tabN} tabs ok`,
);

} else {
  log("landing 对比卡滑块拖动", false, `未找到可见的 .ba 滑块（共 ${baCount} 个）`);
}

// ---- 2) Demo：逐个编辑动作真实出图 ----
await page.goto(route("/demo"), { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(4000);

// 选择样片"Serum bottles"（默认可能已选），再逐个动作 + Run & verify
async function runAction(actionText) {
  // 点击动作按钮（按文案匹配）
  const btns = page.locator("button");
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const t = (await btns.nth(i).innerText()).trim();
    if (t.startsWith(actionText)) { await btns.nth(i).click(); return true; }
  }
  return false;
}

const actions = ["去背景换白底", "Warm it up", "Brighten", "Vivid colours", "Resize 800×800", "Sharpen", "Add watermark"];
for (const a of actions) {
  const found = await runAction(a);
  if (!found) { log(`demo 动作 ${a}`, false, "按钮未找到"); continue; }
  await page.waitForTimeout(300);
  // 记录点击前的结果图，用于判断「这张是不是新生成的」
  const dataImg = page.locator("img[src^='data:image']");
  const prevSrc = (await dataImg.count()) ? await dataImg.first().getAttribute("src") : null;
  // 点击 Run & verify
  const runBtn = page.locator("button:has-text('Run & verify')");
  if (await runBtn.count()) await runBtn.first().click();
  // 轮询等待新图出现（去背是第一个动作，要等模型冷启动，固定 3.5s 会误判超时）
  await page
    .waitForFunction(
      (prev) => {
        const im = document.querySelector("img[src^='data:image']");
        return !!im && im.src.length > 500 && im.src !== prev;
      },
      prevSrc,
      { timeout: 30000 },
    )
    .catch(() => {});
  let ok = false, detail = "";
  const cnt = await dataImg.count();
  if (cnt > 0) {
    const src = await dataImg.first().getAttribute("src");
    ok = (src || "").length > 500 && src !== prevSrc; // 真实图 base64 应远大于占位，且必须是新的
    detail = `dataImg len=${src ? src.length : 0}`;
  }
  // 检查错误文案
  const errTxt = await page.locator("text=/failed|error|422|undefined|NaN/i").count();
  log(`demo 真实出图「${a}」`, ok && errTxt === 0, detail + (errTxt ? ` errNodes=${errTxt}` : ""));
}

await browser.close();
console.log("\n=== JS 错误 ===");
errors.length ? errors.forEach((e) => console.log("✗ " + e)) : console.log("✓ 无");
const failed = results.filter((r) => !r.ok);
console.log(`\n=== 汇总 ${results.length - failed.length}/${results.length} 通过，错误 ${errors.length} ===`);
process.exit(failed.length || errors.length ? 1 : 0);
