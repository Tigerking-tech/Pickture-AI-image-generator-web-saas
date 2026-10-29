#!/usr/bin/env node
/**
 * fetch-model.mjs — 拉取 RMBG-1.4 分割模型（去背用）
 *
 * 为什么不入库：权重 44MB，超过仓库健康体积，且可复现下载。
 * 为什么不走 GitHub Release：沙箱/国内网络下 github.com:443 常被限速到 10KB/s，
 * ModelScope 是同一模型的可用镜像（2.2s 下完）。
 *
 * 用法：npm run model
 * 校验：字节数必须等于 MODEL_SIZE，否则视为下载失败（不留下半个文件）。
 */

import fs from "node:fs";
import path from "node:path";

const MODEL_SIZE = 44_403_226;
const OUT = process.env.RMBG_MODEL_PATH || path.join(process.cwd(), "assets", "models", "rmbg-quantized.onnx");
const URL =
  "https://www.modelscope.cn/api/v1/models/AI-ModelScope/RMBG-1.4/repo?Revision=master&FilePath=onnx/model_quantized.onnx";

async function main() {
  if (fs.existsSync(OUT) && fs.statSync(OUT).size === MODEL_SIZE) {
    console.log(`✓ 模型已存在：${OUT}`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  console.log(`↓ 下载 RMBG-1.4（quantized, 44MB）→ ${OUT}`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== MODEL_SIZE) {
    throw new Error(`大小不符：${buf.length} != ${MODEL_SIZE}（可能是错误页，请重试）`);
  }
  fs.writeFileSync(OUT, buf);
  console.log("✓ 完成");
}

main().catch((e) => {
  console.error("✗ 模型下载失败：", e.message);
  console.error("  可手动放置到 assets/models/rmbg-quantized.onnx，或用 RMBG_MODEL_PATH 指定路径。");
  process.exit(1);
});
