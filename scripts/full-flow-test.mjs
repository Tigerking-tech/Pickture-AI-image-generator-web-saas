/**
 * full-flow-test.mjs — 客户视角全流程验证（桌面 + 手机）
 * 流程：落地页(滑动/4个能力Tab/展示区/FAQ) → 定价页(新价格+竞品表) → Demo(白底预设跑通)
 */
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const OUT = "/workspace/verify-evidence";
const CHROME = "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome";
import fs from "node:fs";
if (!fs.existsSync(CHROME)) {
  // fallback: discover
  const glob = fs.readdirSync("/root/.cache/ms-playwright").filter(d => d.startsWith("chromium-"));
  if (glob.length) {
    console.log("using chromium:", glob[0]);
  }
}

const errors = [];
let shotIdx = 0;
async function shot(page, name) {
  shotIdx += 1;
  const p = `${OUT}/${String(shotIdx).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log("  📸", p);
}

async function flow(browser, { label, viewport, touch }) {
  console.log(`\n======== ${label} (${viewport.width}x${viewport.height}, touch=${touch}) ========`);
  const ctx = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: touch,
    userAgent: touch
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await ctx.newPage();
  const tag = touch ? "m" : "d";
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`[${label}] ${msg.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  // ---- 1. 落地页 ----
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(800);
  await shot(page, `${tag}-landing-hero`);

  // hero before/after 拖动
  const hero = page.locator(".hero-shot [role=slider]").first();
  const hb = await hero.boundingBox();
  if (hb) {
    const y = hb.y + hb.height / 2;
    if (touch) {
      await page.touchscreen.tap(hb.x + 200, y).catch(() => {});
      // drag via CDP-ish: use touchscreen fallback -> mouse with force
    }
    await page.mouse.move(hb.x + hb.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(hb.x - 120, y, { steps: 6 });
    await page.mouse.up();
    const v1 = await hero.getAttribute("aria-valuenow");
    console.log(`  hero slider aria-valuenow after drag: ${v1}`);
    await shot(page, `${tag}-landing-hero-dragged`);
  } else {
    console.log("  ⚠ hero slider not found");
  }

  // 4 个能力 Tab 逐个点
  const tabs = page.locator(".cap-tab");
  const n = await tabs.count();
  console.log(`  capability tabs: ${n}`);
  for (let i = 0; i < n; i++) {
    const t = tabs.nth(i);
    const name = (await t.textContent())?.trim();
    await t.click();
    await page.waitForTimeout(350);
    const h = await page.locator(".cap-panel h3").first().textContent();
    const sel = await t.getAttribute("aria-selected");
    console.log(`  tab[${i}] "${name}" -> selected=${sel}, panel="${h?.trim()}"`);
    if (i === 0) await shot(page, `${tag}-cap-whitebg`);
  }

  // 展示区 + FAQ
  await page.locator("#fidelity").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, `${tag}-showcase`);
  const faq = page.locator("summary").first();
  await faq.scrollIntoViewIfNeeded();
  await faq.click();
  await page.waitForTimeout(300);
  const faqOpen = await page.locator("details").first().evaluate((el) => el.hasAttribute("open"));
  console.log(`  FAQ open: ${faqOpen}`);

  // ---- 2. 定价页 ----
  await page.goto(`${BASE}/pricing`, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await shot(page, `${tag}-pricing-top`);
  const planPrices = await page.locator(".plans .plan .price").allTextContents();
  console.log(`  plan prices: ${planPrices.map((s) => s.replace(/\s+/g, "")).join(" | ")}`);
  const body = await page.locator("body").innerText();
  const hasCompetitorTable = body.includes("Photoroom Pro") && body.includes("remove.bg (Canva)") && body.includes("~$0.002");
  console.log(`  competitor table present: ${hasCompetitorTable}`);
  await page.locator("table").nth(0).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, `${tag}-pricing-competitors`);

  // ---- 3. Demo 全流程 ----
  await page.goto(`${BASE}/demo`, { waitUntil: "load" });
  await page.waitForTimeout(700);
  const whiteBtn = page.locator(".action-btn", { hasText: "去背景换白底" });
  await whiteBtn.scrollIntoViewIfNeeded();
  await whiteBtn.click();
  const on = await whiteBtn.getAttribute("class");
  console.log(`  white-bg preset selected: ${on?.includes("on")}`);
  const run = page.locator("button", { hasText: "Run & verify" });
  await run.scrollIntoViewIfNeeded();
  await run.click();
  await page.waitForSelector(".route-box", { timeout: 20000 });
  await page.waitForTimeout(500);
  const route = await page.locator(".route-box").innerText();
  console.log(`  route: ${route.split("\n")[0]}`);
  const report = await page.locator(".result-meta").first().innerText().catch(() => "");
  console.log(`  report excerpt: ${report.replace(/\n/g, " ").slice(0, 120)}`);
  const slider = page.locator("[role=slider]").first();
  const sb = await slider.boundingBox();
  if (sb) {
    const y = sb.y + sb.height / 2;
    await page.mouse.move(sb.x + sb.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(sb.x - 150, y, { steps: 6 });
    await page.mouse.up();
    console.log(`  result slider after drag: ${await slider.getAttribute("aria-valuenow")}`);
  }
  await shot(page, `${tag}-demo-whitebg-result`);

  await ctx.close();
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

await flow(browser, { label: "desktop", viewport: { width: 1440, height: 900 }, touch: false });
await flow(browser, { label: "mobile", viewport: { width: 390, height: 844 }, touch: true });

await browser.close();
console.log("\n======== console errors ========");
console.log(errors.length ? errors.join("\n") : "(none)");
