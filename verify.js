#!/usr/bin/env node
/**
 * verify.js — Surepix Web 全流程闭环验证
 * 对运行中的服务逐项断言：SEO / 页面 / API 管线 / 反例。
 */
const BASE = process.env.BASE || "http://127.0.0.1:3100";
const fs = require("node:fs");
const path = require("node:path");

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${extra ? "  " + extra : ""}`);
}

async function get(url) {
  const r = await fetch(BASE + url);
  return { status: r.status, text: await r.text(), headers: r.headers };
}

async function postJson(url, body) {
  const r = await fetch(BASE + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}

(async () => {
  console.log("== V1 Landing SEO ==");
  const home = await get("/");
  check("landing 200", home.status === 200);
  check("<title> 含品牌词", /<title>[^<]*Surepix[^<]*<\/title>/.test(home.text));
  check("meta description", /name="description"[^>]*content="[^"]{80,}/.test(home.text));
  check("canonical", /rel="canonical"/.test(home.text));
  check("OpenGraph", /property="og:title"/.test(home.text) && /property="og:image"/.test(home.text));
  check("Twitter card", /name="twitter:card"/.test(home.text));
  check("JSON-LD SoftwareApplication", /"@type":"SoftwareApplication"/.test(home.text));
  check("JSON-LD FAQPage", /"@type":"FAQPage"/.test(home.text));
  check("唯一 H1", (home.text.match(/<h1[\s>]/g) || []).length === 1);
  check("语义化 heading 层级", /<h2[\s>]/.test(home.text));
  check("MIT 署名（许可义务）", /PhotoCraft[\s\S]{0,80}MIT/.test(home.text));
  check("英文面向欧美市场", /en_US/.test(home.text) || /EU/.test(home.text));

  console.log("== V2 Demo 页 ==");
  const demo = await get("/demo");
  check("demo 200", demo.status === 200);
  check("demo 含交互挂载点", /Run &amp; verify|Run & verify/.test(demo.text));

  console.log("== V3 sitemap / robots ==");
  const sm = await get("/sitemap.xml");
  check("sitemap 200 + 含 /demo", sm.status === 200 && sm.text.includes("/demo"));
  const rb = await get("/robots.txt");
  check("robots 200 + disallow /api/", rb.status === 200 && rb.text.includes("Disallow: /api/"));

  console.log("== V4 六个意图全跑（serum 样本） ==");
  const intents = [
    ["make it warmer", "warm_up"],
    ["brighten the photo", "brighten"],
    ["make colours more vivid", "boost_saturation"],
    ["resize to 800x800", "resize_for_platform"],
    ["sharpen the image", "sharpen"],
    ["add a SUREPIX watermark", "watermark"],
  ];
  for (const [instruction, expect] of intents) {
    const t0 = Date.now();
    const r = await postJson("/api/edit", { intent: instruction, sampleId: "serum" });
    const wall = Date.now() - t0;
    if (!r.json.ok) {
      check(`${expect}`, false, r.json.error || `status ${r.status}`);
      continue;
    }
    const j = r.json;
    const imgOk = j.image.base64.length > 5000;
    const fidOk = j.fidelity && j.fidelity.elements && Object.keys(j.fidelity.elements).length >= 1;
    // 验收标准：最终交付的图必须保真 PASS（允许 L0 失败后自动降级修复）
    check(
      `${expect} (${j.timingMs.total}ms)`,
      r.status === 200 && imgOk && fidOk && j.fidelity.verdict === "PASS",
      `verdict=${j.fidelity.verdict} route=${j.route.route} wall=${wall}ms${j.repairTrail && j.repairTrail.length ? " repaired@" + j.levelUsed : ""}`,
    );
    if (expect === "resize_for_platform") {
      check("resize 输出 800×800", j.image.width === 800 && j.image.height === 800, `${j.image.width}×${j.image.height}`);
    }
    if (expect === "watermark") {
      const typeLayers = (j.psd?.layers || []).filter((l) => l.kind === "Type");
      check("watermark 产出 PSD 真文字层", !!j.psd && typeLayers.length === 1, typeLayers.map((l) => l.name).join(","));
    }
  }

  console.log("== V5 三个样本跑 warm_up（批量一致性） ==");
  for (const s of ["serum", "phones", "coffee"]) {
    const r = await postJson("/api/edit", { intent: "make it warmer", sampleId: s });
    check(`sample ${s}`, r.json.ok && r.json.fidelity.verdict === "PASS", `verdict=${r.json.fidelity?.verdict} ${r.json.timingMs?.total}ms`);
  }

  console.log("== V6 上传流（无 manifest → 全局保真） ==");
  const uploadB64 = fs.readFileSync(path.join(__dirname, "public", "samples", "phones.png")).toString("base64");
  const up = await postJson("/api/edit", { intent: "make it warmer", imageBase64: uploadB64 });
  check(
    "上传图走全局校验",
    up.json.ok && up.json.fidelity.elements.whole_image !== undefined,
    `verdict=${up.json.fidelity?.verdict} source=${up.json.meta?.source}`,
  );

  console.log("== V7 反例：听不懂的意图被拒绝 ==");
  const bad = await postJson("/api/edit", { intent: "把背景换成火星", sampleId: "serum" });
  check("语义级意图 → regenerate 明确拒绝（不猜着改）", bad.json.ok === false && bad.json.route?.route === "regenerate" && /generative path/.test(bad.json.error || ""), bad.json.error?.slice(0, 70));
  const bad0 = await postJson("/api/edit", { intent: "阿巴阿巴完全看不懂", sampleId: "serum" });
  check("无意图匹配 → reject", bad0.json.ok === false && bad0.json.route?.route === "reject");
  const bad2 = await postJson("/api/edit", { intent: "", sampleId: "serum" });
  check("空意图 → 400", bad2.status === 400);
  const bad3 = await postJson("/api/edit", { intent: "make it warmer", sampleId: "not_exist" });
  check("不存在样本 → 明确错误", bad3.json.ok === false && /not found/.test(bad3.json.error || ""));

  console.log("== V8 性能基准（10 次连续调用） ==");
  const times = [];
  for (let i = 0; i < 10; i++) {
    const r = await postJson("/api/edit", { intent: "make it warmer", sampleId: "serum" });
    if (r.json.ok) times.push(r.json.timingMs.total);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);
  check("10 次调用全部成功", times.length === 10);
  check("平均耗时 < 1000ms", avg < 1000, `avg=${avg.toFixed(0)}ms max=${max}ms`);

  console.log("\n== 汇总 ==");
  const pass = results.filter((r) => r.ok).length;
  console.log(`${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
