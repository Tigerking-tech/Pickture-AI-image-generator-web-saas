#!/usr/bin/env node
/**
 * engine/server.mjs — Surepix 引擎微服务（方案 A 的"引擎侧"，部署在 Render 等常驻主机）
 *
 * 作用：把本地 photocraft-cli 包成最小 HTTP 服务，对外只暴露纯引擎能力（不含鉴权/积分等业务逻辑）：
 *   GET  /api/pc/healthz       健康检查（无需鉴权，供 Render 探活）
 *   POST /api/pc/run            { chain:[{cmd,params?}], format?, quality?, input:{b64?|url?}, resultPutUrl? }
 *   POST /api/pc/convert        { outFormat?, quality?, input:{b64?|url?}, resultPutUrl? }
 *   POST /api/pc/info           { input:{b64?|url?} }
 *
 * 鉴权：Authorization: Bearer <PC_TOKEN>。未设置 PC_TOKEN 时不鉴权（仅本地/测试用）。
 *
 * 并发：每个请求各自 spawn 一个 photocraft-cli 子进程，由 Node 事件循环并发调度；
 *       Render 侧可通过"提高套餐 / 多实例"进一步扩容。生产大文件建议传 resultPutUrl（预签名 URL），
 *       由本服务 PUT 结果，避免把大图以 base64 在 JSON 里来回传。
 */

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PC_CLI = process.env.PC_CLI || path.join(ROOT, "vendor", "photocraft", "photocraft-cli");
const TOKEN = process.env.PC_TOKEN || "";
const PORT = Number(process.env.PORT || 3000);
const TIMEOUT_MS = Number(process.env.PC_TIMEOUT_MS || 120000);
const MAX_BODY = 64 * 1024 * 1024;

function cleanup(files) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}
function tmp(ext) {
  return path.join(os.tmpdir(), `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}
function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function deny(res, code, msg) {
  send(res, code, { ok: false, error: msg });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function resolveInput(input) {
  if (!input || (typeof input !== "object")) throw new Error("input required");
  const out = tmp("in");
  if (input.b64) { fs.writeFileSync(out, Buffer.from(input.b64, "base64")); return out; }
  if (input.url) {
    const r = await fetch(input.url);
    if (!r.ok) throw new Error(`fetch input failed: ${r.status}`);
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    return out;
  }
  throw new Error("input must have b64 or url");
}

function execCli(args, { timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let stdout = ""; let stderr = ""; let killed = false;
    let child;
    try { child = spawn(PC_CLI, args, { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { return resolve({ ok: false, ms: Date.now() - t0, code: null, error: `spawn: ${e.message}`, stdout, stderr }); }
    const timer = setTimeout(() => { killed = true; try { child.kill("SIGKILL"); } catch { /* */ } }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, ms: Date.now() - t0, code: null, killed, error: `spawn: ${e.message}`, stdout, stderr }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0 && !killed, ms: Date.now() - t0, code, killed, stdout, stderr }); });
  });
}

async function deliver(outFile, ms, resultPutUrl, cleanupFiles) {
  try {
    if (resultPutUrl) {
      const r = await fetch(resultPutUrl, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: fs.readFileSync(outFile),
      });
      cleanup(cleanupFiles);
      if (!r.ok) return { ok: false, error: `put result failed: ${r.status}`, ms };
      return { ok: true, url: resultPutUrl, ms };
    }
    const b64 = fs.readFileSync(outFile).toString("base64");
    cleanup(cleanupFiles);
    return { ok: true, out: { b64, bytes: b64.length, format: path.extname(outFile).slice(1) }, ms };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms };
  }
}

async function handleRun(body) {
  const inFile = await resolveInput(body.input);
  const outFile = tmp(body.format || "png");
  const args = ["run", inFile];
  for (const step of (body.chain || [])) {
    args.push("--cmd", step.cmd);
    if (step.params !== undefined) args.push("--params", JSON.stringify(step.params));
  }
  args.push("--out", outFile);
  if (body.format) args.push("--format", body.format);
  if (body.quality) args.push("--quality", String(body.quality));
  const r = await execCli(args);
  if (!r.ok) { cleanup([inFile, outFile]); return { ok: false, error: r.stderr || r.error || "run failed", ms: r.ms }; }
  return deliver(outFile, r.ms, body.resultPutUrl, [inFile, outFile]);
}

async function handleConvert(body) {
  const inFile = await resolveInput(body.input);
  const outFile = tmp(body.outFormat || "png");
  const args = ["convert", inFile, outFile];
  if (body.outFormat) args.push("--format", body.outFormat);
  if (body.quality) args.push("--quality", String(body.quality));
  const r = await execCli(args);
  if (!r.ok) { cleanup([inFile, outFile]); return { ok: false, error: r.stderr || r.error || "convert failed", ms: r.ms }; }
  return deliver(outFile, r.ms, body.resultPutUrl, [inFile, outFile]);
}

async function handleInfo(body) {
  const inFile = await resolveInput(body.input);
  const r = await execCli(["info", inFile]);
  let info;
  try { info = JSON.parse(r.stdout); }
  catch {
    const s = r.stdout; const i = s.indexOf("{"); const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) { try { info = JSON.parse(s.slice(i, j + 1)); } catch { /* */ } }
  }
  cleanup([inFile]);
  return { ok: r.ok, info: r.ok ? info : undefined, error: r.ok ? undefined : (r.stderr || r.error), ms: r.ms };
}

function pinnedVersion() {
  try { return fs.readFileSync(path.join(ROOT, "vendor", "photocraft", "VERSION"), "utf8").trim(); }
  catch { return "unknown"; }
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || "").split("?")[0];
  // 探活不鉴权，方便 Render 健康检查
  if (req.method === "GET" && url === "/api/pc/healthz") {
    return send(res, 200, { ok: true, engine: "photocraft", version: pinnedVersion(), pid: process.pid });
  }
  if (TOKEN && req.headers["authorization"] !== `Bearer ${TOKEN}`) {
    return deny(res, 401, "unauthorized");
  }
  try {
    if (req.method === "POST" && url === "/api/pc/run") { const b = await readBody(req); return send(res, 200, await handleRun(b)); }
    if (req.method === "POST" && url === "/api/pc/convert") { const b = await readBody(req); return send(res, 200, await handleConvert(b)); }
    if (req.method === "POST" && url === "/api/pc/info") { const b = await readBody(req); return send(res, 200, await handleInfo(b)); }
    return deny(res, 404, "not found");
  } catch (e) {
    return deny(res, 400, e instanceof Error ? e.message : "bad request");
  }
});

server.listen(PORT, () => {
  console.log(`[engine] listening on :${PORT} | photocraft-cli: ${PC_CLI} | token: ${TOKEN ? "on" : "off"}`);
});
