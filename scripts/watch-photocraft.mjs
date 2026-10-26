#!/usr/bin/env node
/**
 * watch-photocraft.mjs — 手动检查 PhotoCraft 上游是否有新版本（"自动盯梢"的本地版）
 *
 * 用法：
 *   node scripts/watch-photocraft.mjs            # 对比锁定的版本与上游最新 release
 *   GITHUB_TOKEN=ghp_xxx node ...               # 带 token 可避免 GitHub API 限流
 *
 * 输出：人类可读的报告 + 升级建议。退出码恒为 0（方便 CI / 手动运行）。
 * 真正"无人值守"的自动盯梢见 .github/workflows/watch-photocraft.yml（每天跑一次，有新版本就开 Issue）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "storytold/photocraft"; // 上游仓库（不是我们自己的仓库）
const VERSION_FILE = path.join(ROOT, "vendor", "photocraft", "VERSION");

function pinned() {
  try { return fs.readFileSync(VERSION_FILE, "utf8").trim(); } catch { return null; }
}
function parse(v) {
  const m = String(v).replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); }
  return 0;
}

async function latest() {
  const token = process.env.GITHUB_TOKEN;
  const headers = { accept: "application/vnd.github+json", "user-agent": "surepix-watch" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  return r.json();
}

(async () => {
  const pin = pinned();
  console.log(`[watch] 本地锁定版本: ${pin || "(未知，请确认 vendor/photocraft/VERSION 存在)"}`);
  let rel;
  try {
    rel = await latest();
  } catch (e) {
    console.log(`[watch] 无法连接 GitHub：${e.message}`);
    console.log("[watch] 网络不通或触发限流时可稍后重试（带 GITHUB_TOKEN 可提升额度）。");
    process.exit(0);
  }
  const tag = String(rel.tag_name || "");
  const ver = parse(tag);
  const pinVer = parse(pin || "0.0.0");
  console.log(`[watch] 上游最新 release: ${tag}  (${rel.html_url || ""})`);
  if (!ver || !pinVer) { console.log("[watch] 版本号无法解析，请人工核对。"); process.exit(0); }
  const diff = cmp(ver, pinVer);
  if (diff <= 0) {
    console.log("[watch] ✅ 已是最新，无需升级。");
    process.exit(0);
  }
  const breaking = /break|breaking|BREAKING|不兼容|破坏性/i.test(rel.body || "");
  console.log("");
  console.log(`🔔 发现新版本 v${ver.join(".")}（当前锁定 v${pinVer.join(".")}）`);
  console.log(`   发布说明: ${rel.html_url}`);
  console.log(`   升级建议: ${breaking ? "⚠️ 可能含不兼容改动，先让别人踩坑，过阵子再升" : "✅ 常规更新，可安排升级"}`);
  console.log("");
  console.log("下一步：让 AI 助手「评估官方 v" + ver.join(".") + " 是否升级」，它会读发布说明、改版本号与校验和、跑校验、再部署。");
  process.exit(0);
})();
