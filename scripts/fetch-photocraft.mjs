#!/usr/bin/env node
/**
 * fetch-photocraft.mjs — 自动就位 PhotoCraft CLI（src/lib/pc.ts 依赖 vendor/photocraft/photocraft-cli）
 *
 * 为什么不把 82MB 二进制提交进仓库：
 *   · 单文件超过 GitHub 50MB 警告线、逼近 100MB 硬限制；仓库会从 ~18MB 膨胀到 ~100MB
 *   · 二进制无法 diff，升级版本等于再塞一份
 *   · 上游 release 自带 SHA256SUMS.txt（2.8KB），把它入库即可做完整性校验
 *
 * 用法：
 *   node scripts/fetch-photocraft.mjs          # 幂等：版本匹配则跳过
 *   PC_VERSION=0.16.0 node scripts/fetch-photocraft.mjs
 *   PHOTOCRAFT_SKIP=1 npm install              # 离线 CI 跳过（此时编辑 API 不可用）
 *
 * 下载通道：优先 github.com release 直连；失败（如沙箱/内网只放行 api.github.com）
 * 自动回退到 api.github.com 资产接口（Accept: application/octet-stream）。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION = process.env.PC_VERSION || "0.15.1";
const VENDOR = path.join(ROOT, "vendor", "photocraft");
const TARGET = path.join(VENDOR, "photocraft-cli");

/** 平台 → release 资产（tar.gz 内取 bin/photocraft-cli；zip 内取 photocraft-cli） */
function pickAsset() {
  const p = process.platform;
  const a = process.arch;
  if (p === "linux" && a === "x64") return { name: `photocraft-${VERSION}-linux-x86_64.tar.gz`, kind: "tgz" };
  if (p === "linux" && a === "arm64") return { name: `photocraft-${VERSION}-linux-aarch64.tar.gz`, kind: "tgz" };
  if (p === "darwin") return { name: `photocraft-cli-${VERSION}-macos-universal.zip`, kind: "zip" };
  if (p === "win32") return { name: `photocraft-${VERSION}-windows-x64-portable.zip`, kind: "zip" };
  return null;
}

const log = (m) => console.log(`[photocraft] ${m}`);

async function download(name, dest) {
  const urls = [
    `https://github.com/storytold/photocraft/releases/download/v${VERSION}/${name}`,
    // 回退：先查资产 id，再走 api.github.com（部分网络只放行 api.github.com）
    `api://${name}`,
  ];
  for (const u of urls) {
    try {
      if (u.startsWith("api://")) {
        const n = u.slice(6);
        const rel = await fetchJson(`https://api.github.com/repos/storytold/photocraft/releases/tags/v${VERSION}`);
        const asset = (rel.assets || []).find((x) => x.name === n);
        if (!asset) throw new Error(`asset not found: ${n}`);
        const res = await fetch(`https://api.github.com/repos/storytold/photocraft/releases/assets/${asset.id}`, {
          headers: { Accept: "application/octet-stream" },
          redirect: "follow",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      } else {
        const res = await fetch(u, { redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      }
      log(`downloaded ${name} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
      return true;
    } catch (e) {
      log(`channel failed (${u.split("/")[2]}): ${e.message}`);
    }
  }
  return false;
}

async function fetchJson(u) {
  const r = await fetch(u, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function extract(file, kind, tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (kind === "tgz") execFileSync("tar", ["xzf", file, "-C", tmp], { stdio: "pipe" });
  else execFileSync("unzip", ["-q", "-o", file, "-d", tmp], { stdio: "pipe" });
  // 在解压产物里找 photocraft-cli（或 Windows 的 .exe）
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^photocraft-cli(\.exe)?$/.test(e.name)) hits.push(p);
    }
  };
  walk(tmp);
  if (!hits.length) throw new Error("photocraft-cli not found in archive");
  return hits[0];
}

function sha256(f) {
  return createHash("sha256").update(fs.readFileSync(f)).digest("hex");
}

async function main() {
  if (process.env.PHOTOCRAFT_SKIP === "1") {
    log("PHOTOCRAFT_SKIP=1 → 跳过（编辑 API 将不可用）");
    return;
  }
  const verFile = path.join(VENDOR, "VERSION");
  if (fs.existsSync(TARGET) && fs.existsSync(verFile) && fs.readFileSync(verFile, "utf8").trim() === VERSION) {
    log(`v${VERSION} 已就位，跳过`);
    return;
  }
  const asset = pickAsset();
  if (!asset) {
    log(`unsupported platform ${process.platform}/${process.arch} — 请手动放置 photocraft-cli 到 vendor/photocraft/`);
    return;
  }
  fs.mkdirSync(VENDOR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
  const file = path.join(tmp, asset.name);
  log(`fetching ${asset.name} …`);
  const ok = await download(asset.name, file);
  if (!ok) {
    log("!! 下载失败：所有通道不可用。可手动下载后放到 vendor/photocraft/photocraft-cli");
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exitCode = 0; // 不阻断 install
    return;
  }
  // SHA256 校验（若仓库内有该版本的校验和文件）
  const sums = path.join(ROOT, "vendor-checksums", `SHA256SUMS-${VERSION}.txt`);
  if (fs.existsSync(sums)) {
    const want = fs
      .readFileSync(sums, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.endsWith(asset.name));
    if (want) {
      const expected = want.split(/\s+/)[0];
      const got = sha256(file);
      if (expected !== got) {
        log(`!! SHA256 不匹配\n  expected ${expected}\n  got      ${got}`);
        fs.rmSync(tmp, { recursive: true, force: true });
        process.exit(1);
      }
      log("SHA256 校验通过");
    }
  }
  const bin = extract(file, asset.kind, path.join(tmp, "x"));
  fs.copyFileSync(bin, TARGET);
  fs.chmodSync(TARGET, 0o755);
  fs.writeFileSync(verFile, VERSION);
  log(`✓ ${TARGET} (v${VERSION})`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error("[photocraft] failed:", e.message);
  process.exitCode = 0; // postinstall 不应阻断
});
