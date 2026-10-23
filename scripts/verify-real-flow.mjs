// 真实客户流程：腾讯 hy3 拆句 + 阿里 qwen-image-3.0-pro 出图
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:3000";
const OUT = "/root/.codebuddy/artifact/real-runs";
mkdirSync(OUT, { recursive: true });

const DECISION_TREE_ORDER = [
  ["character", "pose"],
  ["character", "orientation"],
  ["lighting", "direction"],
  ["environment", "timeofday"],
  ["environment", "weather"],
  ["composition", "framing"],
  ["style", "aesthetic"],
];

const sentence = process.argv[2] ?? "a girl and a dog running at sunset";
const tag = process.argv[3] ?? "A";
const doImages = process.argv[4] !== "noimg";

async function j(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, raw: text };
}

async function dl(url, file) {
  const r = await fetch(url);
  if (!r.ok) return 0;
  const b = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, b);
  return b.length;
}

const t0 = Date.now();
console.log(`\n########## 客户会话 ${tag}: "${sentence}" ##########`);

// ── 步骤1：拆句（真实 hy3）
console.log("\n[步骤1] 拆解句子为视觉要素树 …");
const d = await j(`${BASE}/api/decompose`, { sentence, stream: false });
const tree = d.json;
if (!tree || !tree.character) {
  console.log(`  拆解失败 HTTP ${d.status}: ${d.raw.slice(0, 300)}`);
  process.exit(1);
}
console.log(`  HTTP ${d.status}  耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const visualNodes = DECISION_TREE_ORDER.filter(([g, k]) => {
  const a = tree?.[g]?.[k];
  return a && Array.isArray(a.candidates) && a.candidates.length >= 2;
});
console.log(`  分组数: ${Object.keys(tree).filter((k) => k !== "meta").length}/8`);
console.log(`  出图节点(${visualNodes.length}):`);
for (const [g, k] of visualNodes) {
  const a = tree[g][k];
  console.log(`    ${g}.${k} = "${a.value}"  候选${a.candidates.length}: ${a.candidates.join(" | ")}`);
}
console.log(`  原句保留: ${tree.meta?.sentence ?? "(无)"}`);
writeFileSync(`${OUT}/tree_${tag}.json`, JSON.stringify(tree, null, 2));

if (!doImages) {
  console.log("\n(仅拆解模式，跳过生图)");
  process.exit(0);
}

// ── 步骤2：首个出图节点的候选预览（真实出图）
const [g, k] = visualNodes[0];
// candLimit>0 时只取前 N 个候选（节省额度 / 模拟免费档）
const candLimit = Number(process.argv[5] ?? 0);
const candidates =
  candLimit > 0 ? tree[g][k].candidates.slice(0, candLimit) : tree[g][k].candidates;
console.log(`\n[步骤2] 生成节点 ${g}.${k} 的 ${candidates.length} 张候选图 …`);
const t1 = Date.now();
const p = await j(`${BASE}/api/generate`, {
  mode: "preview",
  candidates,
  tree,
  attribute: { group: g, key: k },
  varySubject: true,
});
console.log(`  HTTP ${p.status}  耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);
const images = p.json?.images ?? [];
console.log(`  返回图数: ${images.length} / 候选 ${candidates.length}`);
if (p.status !== 200) console.log(`  错误: ${p.raw.slice(0, 300)}`);

const files = [];
for (let i = 0; i < images.length; i++) {
  const f = `${OUT}/cand_${tag}_${i}.png`;
  const sz = await dl(images[i], f);
  files.push(sz ? f : null);
  console.log(`    [${i}] ${candidates[i]} → ${sz ? `${(sz / 1024).toFixed(0)}KB` : "下载失败"}`);
}

// 拼 3x3 对照图
const ok = files.filter(Boolean);
if (ok.length > 0) {
  const cell = 300;
  const cols = 3;
  const rows = Math.ceil(ok.length / cols);
  const comps = [];
  for (let i = 0; i < ok.length; i++) {
    comps.push({
      input: await sharp(ok[i]).resize(cell, cell, { fit: "cover" }).toBuffer(),
      left: (i % cols) * cell,
      top: Math.floor(i / cols) * cell,
    });
  }
  await sharp({
    create: { width: cols * cell, height: rows * cell, channels: 3, background: "#000" },
  })
    .composite(comps)
    .png()
    .toFile(`${OUT}/candidates_${tag}_sheet.png`);
  console.log(`  候选对照图: ${OUT}/candidates_${tag}_sheet.png`);
}

// ── 步骤3：终图
console.log("\n[步骤3] 合成终图（扣 10 积分）…");
const t2 = Date.now();
const f = await j(`${BASE}/api/generate`, { mode: "final", tree });
console.log(`  HTTP ${f.status}  耗时 ${((Date.now() - t2) / 1000).toFixed(1)}s`);
if (f.json?.image) {
  const sz = await dl(f.json.image, `${OUT}/final_${tag}.png`);
  console.log(`  终图: ${OUT}/final_${tag}.png (${(sz / 1024).toFixed(0)}KB)  model=${f.json.model}`);
} else {
  console.log(`  终图失败: ${f.raw.slice(0, 300)}`);
}

writeFileSync(
  `${OUT}/report_${tag}.json`,
  JSON.stringify({ sentence, tree, candidates, images, final: f.json }, null, 2),
);
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
