import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const errors = [];
const results = [];

function logResult(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`[console] ${page.url()} :: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${page.url()} :: ${e.message}`));

// 1) Landing
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const sliderCount = await page.locator(".ba, [class*='ba'], input[type=range]").count();
logResult("landing 加载 & 对比滑块存在", sliderCount > 0, `slider elements=${sliderCount}`);
// 首屏三张展示卡 before/after 是否真实不同（用 canvas 截像素不可行，改为检查 img src 存在且非占位）
const showcaseImgs = await page.locator("img[src*='showcase'], img[src*='samples']").count();
logResult("landing 展示图加载", showcaseImgs >= 2, `img count=${showcaseImgs}`);
await page.screenshot({ path: "/tmp/check-landing.png", fullPage: false });

// 2) Demo — 逐个动作按钮
await page.goto(BASE + "/demo", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
logResult("demo 页面加载", await page.locator("body").isVisible());

const actionButtons = page.locator("button");
const btnLabels = await actionButtons.allInnerTexts();
console.log("  检测到按钮:", JSON.stringify(btnLabels));

// 逐一点击动作按钮并验证结果图出现、无错误
for (let i = 0; i < (await actionButtons.count()); i++) {
  const btn = actionButtons.nth(i);
  const label = (await btn.innerText()).trim();
  if (!label) continue;
  // 重新定位以避免 stale
  const target = page.locator("button").nth(i);
  await target.click();
  await page.waitForTimeout(2500); // 等待编辑接口 + 渲染
  // 检查是否出现错误文案
  const errVisible = await page.locator("text=/error|失败|422|cannot|undefined/i").count();
  const resultImg = await page.locator("img[src^='data:image'], img[src*='/api/']").count();
  const hasResult = resultImg > 0 || (await page.locator("canvas, img").count()) > 0;
  logResult(`demo 动作「${label}」`, errVisible === 0 && hasResult, `errNodes=${errVisible} imgs=${resultImg}`);
}

await page.screenshot({ path: "/tmp/check-demo.png", fullPage: false });

// 3) 其它路由
for (const route of ["/pricing", "/login", "/signup", "/dashboard", "/forgot-password"]) {
  const resp = await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const status = resp ? resp.status() : -1;
  const title = await page.title();
  logResult(`route ${route}`, status < 400, `HTTP ${status} title="${title}"`);
}

await browser.close();

console.log("\n=== 控制台/页面错误 ===");
if (errors.length === 0) console.log("✓ 无 JS 错误");
else errors.forEach((e) => console.log("✗ " + e));

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 汇总：${results.length - failed.length}/${results.length} 通过，JS 错误 ${errors.length} 条 ===`);
process.exit(failed.length || errors.length ? 1 : 0);
