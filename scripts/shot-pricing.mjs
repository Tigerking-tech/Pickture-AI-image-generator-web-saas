/**
 * shot-pricing.mjs — 定价页截图（年付 / 月付 两种状态，桌面 + 手机）
 */
import { chromium } from "playwright-core";
const BASE = "http://localhost:3000";
const OUT = "/workspace/verify-evidence";
const CHROME = "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";

const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

for (const [tag, vp] of [
  ["d", { width: 1440, height: 1000 }],
  ["m", { width: 390, height: 900 }],
]) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: tag === "m", isMobile: tag === "m" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

  await p.goto(`${BASE}/pricing`, { waitUntil: "load" });
  await p.waitForTimeout(900);
  // 默认年付
  await p.screenshot({ path: `${OUT}/pr-${tag}-yearly.png`, fullPage: false });
  await p.screenshot({ path: `${OUT}/pr-${tag}-yearly-full.png`, fullPage: true });

  // 切到月付
  const monthlyBtn = p.locator(".plan-toggle button", { hasText: "Monthly" });
  await monthlyBtn.click();
  await p.waitForTimeout(400);
  const priceNow = await p.locator(".plan .price").nth(1).innerText();
  console.log(`[${tag}] after switch to Monthly, Pro price = ${priceNow.replace(/\n/g, "")}`);
  await p.screenshot({ path: `${OUT}/pr-${tag}-monthly.png`, fullPage: false });

  // 价格读数
  const prices = await p.locator(".plan .price").allTextContents();
  const credits = await p.locator(".plan-credits").allTextContents();
  console.log(`[${tag}] prices: ${prices.map((s) => s.replace(/\s+/g, "")).join(" | ")}`);
  console.log(`[${tag}] credits: ${credits.join(" | ")}`);
  console.log(`[${tag}] console errors: ${errs.length ? errs.join("; ") : "(none)"}`);
  await ctx.close();
}
await b.close();
console.log("done");
