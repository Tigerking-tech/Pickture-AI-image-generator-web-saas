/**
 * make-showcase.ts — 用真实管线（router→whitelist→PhotoCraft→保真校验）产出着陆页 after 图
 * 每个 tab 的 before/after 均为真实 pipeline 输出，非合成。
 */
import fs from "node:fs";
import { runEdit } from "../src/lib/pipeline";

const JOBS = [
  { sample: "serum", intent: "make it warmer", out: "public/showcase/serum-after.png" },
  { sample: "phones", intent: "去掉背景换成白底", out: "public/showcase/phones-after.png" },
  { sample: "coffee", intent: "resize to 1200x900", out: "public/showcase/coffee-after.png" },
  { sample: "serum", intent: "add a SUREPIX watermark", out: "public/showcase/serum-brand-after.png" },
];

async function main() {
  let failed = false;
  for (const j of JOBS) {
    const res = await runEdit({ intent: j.intent, sampleId: j.sample });
    if (!res.ok) {
      console.error(`✗ ${j.sample} "${j.intent}" → ${res.error}`);
      failed = true;
      continue;
    }
    fs.writeFileSync(j.out, Buffer.from(res.image.base64, "base64"));
    const els = Object.entries(res.fidelity.elements)
      .map(([k, v]) => `${k}:${v.verdict}`)
      .join(" ");
    console.log(
      `✓ ${j.out} | route=${res.route.route} cli=${res.timingMs.cli}ms | ${els} | overall=${res.fidelity.verdict} action=${res.fidelityAction.action}`,
    );
  }
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
