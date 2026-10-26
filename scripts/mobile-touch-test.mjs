import { chromium } from 'playwright';

const URL = 'http://localhost:3000/';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });

// ---- Test 1: hero before/after slider via real touch (with vertical drift) ----
const slider = page.locator('[role=slider]').first();
await slider.scrollIntoViewIfNeeded();
const box = await slider.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
const before = await slider.getAttribute('aria-valuenow');

const client = await context.newCDPSession(page);
await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
const targetX = cx - 150;
for (let i = 1; i <= 6; i++) {
  const x = cx + ((targetX - cx) * i) / 6;
  const y = cy + 45 * Math.sin(i * 1.1); // vertical finger drift
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
}
await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(300);
const afterTouch = await slider.getAttribute('aria-valuenow');
console.log(`[HERO touch drag] before=${before} after=${afterTouch} changed=${before !== afterTouch}`);

// screenshot proof
await page.screenshot({ path: '/workspace/verify-evidence/14-mobile-hero.png' });

// ---- Test 2: capability tab switch on mobile (real tap) ----
const tab = page.getByRole('tab', { name: 'Crop & resize' });
if (await tab.count()) {
  await tab.scrollIntoViewIfNeeded();
  await tab.tap();
  await page.waitForTimeout(300);
  const selected = await page.locator('[role=tab][aria-selected="true"]').innerText();
  console.log(`[MOBILE tab] selected now: ${selected.trim()}`);
}

// ---- Test 3: console errors on landing ----
console.log(`[LANDING console errors] ${errors.length ? JSON.stringify(errors) : 'none'}`);

// ---- Test 4: demo page console errors + run an edit ----
const dErrors = [];
const dPage = await context.newPage();
dPage.on('console', (m) => { if (m.type() === 'error') dErrors.push(m.text()); });
dPage.on('pageerror', (e) => dErrors.push('PAGEERR: ' + e.message));
await dPage.goto('http://localhost:3000/demo', { waitUntil: 'networkidle' });
// tap "Brighten" then "Run & verify"
await dPage.getByRole('button', { name: /Brighten/ }).tap();
await dPage.getByRole('button', { name: /Run & verify/ }).tap();
await dPage.waitForTimeout(3500);
const hasReport = await dPage.getByText('Pipeline report').count();
console.log(`[DEMO edit] pipeline report visible=${hasReport > 0}`);
// mobile before/after after edit
const dSlider = dPage.locator('[role=slider]').first();
if (await dSlider.count()) {
  const b2 = await dSlider.boundingBox();
  const x2 = b2.x + b2.width / 2, y2 = b2.y + b2.height / 2;
  const before2 = await dSlider.getAttribute('aria-valuenow');
  const c2 = await context.newCDPSession(dPage);
  await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x2, y: y2 }] });
  for (let i = 1; i <= 5; i++) {
    await c2.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x2 - 120 * (i / 5), y: y2 + 30 * Math.sin(i) }] });
  }
  await c2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await dPage.waitForTimeout(300);
  const after2 = await dSlider.getAttribute('aria-valuenow');
  console.log(`[DEMO touch drag] before=${before2} after=${after2} changed=${before2 !== after2}`);
}
console.log(`[DEMO console errors] ${dErrors.length ? JSON.stringify(dErrors) : 'none'}`);

await browser.close();
console.log('MOBILE TEST DONE');
