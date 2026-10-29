import { chromium } from "playwright";
const URL = process.argv[2] || "https://a04ce861a77d38736.app.workbuddy.host/?sharecode=MD4YKLIAV6";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("requestfailed", (r) => errors.push("REQFAIL: " + r.url() + " " + (r.failure()?.errorText || "")));
try {
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
} catch (e) { console.log("goto error:", e.message); }
await page.waitForTimeout(5000);
const baCount = await page.$$eval(".ba", (els) => els.length).catch(() => -1);
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
const hasAmber = (await page.locator("text=Amber serum").count());
const imgCount = await page.locator("img").count();
const showcaseImgs = await page.locator("img[src*='showcase'], img[src*='samples']").count();
console.log("URL:", URL);
console.log(".ba DOM 数:", baCount);
console.log("Amber serum 文本命中:", hasAmber);
console.log("img 总数:", imgCount, "展示图:", showcaseImgs);
console.log("body 前 300 字:", JSON.stringify(bodyText));
console.log("--- 控制台/网络错误 (前 15) ---");
errors.slice(0, 15).forEach((e) => console.log("  ✗", e));
if (!errors.length) console.log("  ✓ 无");
await browser.close();
