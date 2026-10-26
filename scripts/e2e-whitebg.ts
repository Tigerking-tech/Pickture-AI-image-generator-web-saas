/**
 * e2e-whitebg.ts — 端到端验证：真实跑通 pipeline.runEdit（router→whitelist→pc.ts→PhotoCraft CLI）
 *  - Case 1：单意图「换成白底」→ 路由 photocraft、引擎 PhotoCraft、输出白底
 *  - Case 2：多确定性意图「提亮并抠图」→ 路由 photocraft、chain 同时含 brighten 与 edit.fill(white) 两条链
 */
import fs from "node:fs";
import { runEdit } from "../src/lib/pipeline";

const img = fs.readFileSync("/tmp/test_bg.png");
const b64 = img.toString("base64");

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("  ✗", msg);
    failed = true;
  } else {
    console.log("  ✓", msg);
  }
}

async function main() {
  // Case 1: 单意图换白底
  console.log("Case 1: 换成白底（单意图）");
  {
    const res = await runEdit({ intent: "换成白底", imageBase64: b64 });
    fs.writeFileSync("/tmp/e2e_white.png", Buffer.from(res.image.base64, "base64"));
    assert(res.ok, "ok");
    assert(res.route.route === "photocraft", `route=photocraft (got ${res.route.route})`);
    assert(/PhotoCraft/.test(res.meta.engine), `engine=PhotoCraft (got ${res.meta.engine})`);
    assert(
      res.chain.some((s) => s.cmd === "edit.fill" && (s.params as Record<string, unknown>)?.contents === "white"),
      "chain 含 edit.fill(white)",
    );
  }

  // Case 2: 多确定性意图合并
  console.log("Case 2: 提亮并抠图（多确定性意图合并执行）");
  {
    const res = await runEdit({ intent: "提亮并抠图", imageBase64: b64 });
    fs.writeFileSync("/tmp/e2e_multi.png", Buffer.from(res.image.base64, "base64"));
    assert(res.ok, "ok");
    assert(res.route.route === "photocraft", `route=photocraft (got ${res.route.route})`);
    assert(
      res.chain.some((s) => s.cmd === "layer.newAdjustmentLayer.brightnessContrast"),
      "chain 含 brighten 命令",
    );
    assert(
      res.chain.some((s) => s.cmd === "edit.fill" && (s.params as Record<string, unknown>)?.contents === "white"),
      "chain 含 edit.fill(white) 命令",
    );
    assert(
      res.chain.length >= 4,
      `chain 长度=${res.chain.length}（应≥4：brighten + select.subject + select.inverse + edit.fill）`,
    );
  }

  // Case 3: 多确定性（纯调色，无背景），走保真回退循环
  console.log("Case 3: 锐化并提亮（多确定性，无背景）");
  {
    const res = await runEdit({ intent: "锐化并提亮", imageBase64: b64 });
    assert(res.ok, "ok");
    assert(res.route.route === "photocraft", `route=photocraft (got ${res.route.route})`);
    assert(
      res.chain.some((s) => s.cmd === "filter.sharpen.smartSharpen"),
      "chain 含 smartSharpen 命令",
    );
    assert(
      res.chain.some((s) => s.cmd === "layer.newAdjustmentLayer.brightnessContrast"),
      "chain 含 brighten 命令",
    );
  }

  // Case 4: 改尺寸 + 抠图白底（几何 + 背景合并，先 resize 再去白底）
  console.log("Case 4: 改成800x800并抠图（几何+背景合并）");
  {
    const res = await runEdit({ intent: "改成800x800并抠图", imageBase64: b64 });
    fs.writeFileSync("/tmp/e2e_resize_bg.png", Buffer.from(res.image.base64, "base64"));
    assert(res.ok, "ok");
    assert(res.route.route === "photocraft", `route=photocraft (got ${res.route.route})`);
    assert(res.chain.some((s) => s.cmd === "image.imageSize"), "chain 含 imageSize 命令");
    assert(
      res.chain.some((s) => s.cmd === "edit.fill" && (s.params as Record<string, unknown>)?.contents === "white"),
      "chain 含 edit.fill(white) 命令",
    );
  }

  console.log(failed ? "\nE2E FAIL ❌" : "\nE2E PASS ✅（像素校验见下方 PIL）");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
