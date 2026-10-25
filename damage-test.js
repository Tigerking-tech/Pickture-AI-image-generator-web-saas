#!/usr/bin/env node
/**
 * damage-test.js — 保真算法损伤检出回归（防"亮度补偿"把算法改松）
 *
 * 方法：用 tsc 把 src/lib/fidelity.ts 转译成 CJS，直接调用 verify()。
 * 场景（原图 = serum.png，处理图 = 损伤版）：
 *   1. LOGO 模糊        → 应 REPAIR（可修复的局部损伤）
 *   2. LOGO 涂灰        → 应 REGENERATE（结构崩塌）
 *   3. 全局暖调(模拟)    → 应 PASS（故意调色不是损伤）
 */
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = __dirname;

// 1. 转译 fidelity.ts → CJS（输出放项目内，保证 pngjs 模块解析）
const outDir = path.join(ROOT, ".tmp-fidelity-cjs");
fs.rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/fidelity.ts --outDir ${outDir} --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node`,
  { cwd: ROOT, stdio: "pipe" },
);
const { verify } = require(path.join(outDir, "fidelity.js"));

// 2. 用 PIL 生成损伤图
const ROOT_DIR = ROOT;
const samples = path.join(ROOT, "public", "samples");
execSync(`python3 - "${ROOT_DIR}" <<'EOF'
import sys, json
from PIL import Image, ImageFilter
import numpy as np
root = sys.argv[1]
m = json.load(open(f"{root}/public/samples/serum.json"))
img = Image.open(f"{root}/public/samples/serum.png").convert("RGB")
logo = m["elements"]["brand_logo"]["bbox"]

# 场景1：LOGO 高斯模糊
d1 = img.copy()
region = np.array(d1.crop(logo)).astype("uint8")
d1.paste(Image.fromarray(region).filter(ImageFilter.GaussianBlur(6)), (logo[0], logo[1]))
d1.save(f"{root}/damage_blur.png")

# 场景2：LOGO 涂灰
d2 = img.copy()
d2.paste(Image.new("RGB", (logo[2]-logo[0], logo[3]-logo[1]), (128, 128, 128)), (logo[0], logo[1]))
d2.save(f"{root}/damage_gray.png")

# 场景3：全局暖调（每个像素 R+18 G+6，模拟 curves 调色）
a = np.array(img).astype(int)
a[..., 0] = (a[..., 0] + 18).clip(0, 255)
a[..., 1] = (a[..., 1] + 6).clip(0, 255)
Image.fromarray(a.astype("uint8")).save(f"{root}/damage_warm.png")
print("damage images ready")
EOF`, { cwd: ROOT, stdio: "inherit" });

const manifest = JSON.parse(fs.readFileSync(path.join(samples, "serum.json"), "utf8"));
const orig = fs.readFileSync(path.join(samples, "serum.png"));

const cases = [
  { name: "LOGO 模糊 → REPAIR", file: "damage_blur.png", expect: "REPAIR" },
  { name: "LOGO 涂灰 → REGENERATE", file: "damage_gray.png", expect: "REGENERATE" },
  { name: "全局暖调 → PASS", file: "damage_warm.png", expect: "PASS" },
];

let pass = 0;
for (const c of cases) {
  const proc = fs.readFileSync(path.join(ROOT, c.file));
  const r = verify(orig, proc, manifest);
  const ok = r.verdict === c.expect;
  if (ok) pass++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${c.name}  (got ${r.verdict})`);
  for (const [k, v] of Object.entries(r.elements)) {
    if (v.verdict !== "PASS") console.log(`      ${k}: ${v.verdict} ssim=${v.ms_ssim} edge_recall=${v.edge_recall} cr=${v.contrast_retention} ${JSON.stringify(v.reasons)}`);
  }
}
console.log(`${pass}/${cases.length} 通过`);
process.exit(pass === cases.length ? 0 : 1);
