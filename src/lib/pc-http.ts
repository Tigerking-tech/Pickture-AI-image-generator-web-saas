/**
 * pc-http.ts — 远程引擎客户端（方案 A：Vercel 前端侧使用）
 *
 * 当环境变量 PC_API 指向一个"引擎微服务"（部署在 Render 等常驻主机上的 engine/server.mjs）
 * 时，pc.ts 会把所有引擎调用改走 HTTP，而不是在本地 spawn 二进制。
 *
 * 这样：
 *  - Vercel 这种无状态 serverless 也能用（它无法本地跑 photocraft-cli）；
 *  - 重活全部交给常驻的引擎服务，天然支持并发（每个请求一个子进程，Node 事件循环并发调度）；
 *  - pipeline.ts / /api/edit 等上层代码完全不用改。
 *
 * 合约与服务端 engine/server.mjs 严格对应：POST {PC_API}/api/pc/{run,convert,info}，
 * Authorization: Bearer <PC_API_TOKEN>。
 */

import fs from "node:fs";
import path from "node:path";
import type { CliResult } from "./pc";

const BASE = (process.env.PC_API ?? "").replace(/\/+$/, "");
const TOKEN = process.env.PC_API_TOKEN ?? "";

export function remoteConfigured(): boolean {
  return BASE.length > 0;
}

type ChainStep = { cmd: string; params?: Record<string, unknown> };

function okResult(ms: number): CliResult {
  return { ok: true, cmd: "", ms, code: 0, killed: false, stdout: "", stderr: "" };
}
function errResult(ms: number, error: string): CliResult {
  return { ok: false, cmd: "", ms, code: 1, killed: false, stdout: "", stderr: error, error };
}

async function inputFromFile(inFile: string): Promise<{ b64: string; name: string }> {
  return { b64: fs.readFileSync(inFile).toString("base64"), name: path.basename(inFile) };
}

async function postJson(api: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${api}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

/** 把引擎返回的结果落地到 outFile：优先用 base64，其次用结果 URL（resultPutUrl） */
async function writeOutput(res: Response, outFile: string): Promise<void> {
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    out?: { b64: string };
    url?: string;
  };
  if (!data.ok) throw new Error(data.error || "engine error");
  if (data.out?.b64) {
    fs.writeFileSync(outFile, Buffer.from(data.out.b64, "base64"));
  } else if (data.url) {
    const r = await fetch(data.url);
    if (!r.ok) throw new Error(`download result failed: ${r.status}`);
    fs.writeFileSync(outFile, Buffer.from(await r.arrayBuffer()));
  } else {
    throw new Error("engine returned no output");
  }
}

export async function remoteRunChain(
  inFile: string,
  chain: ChainStep[],
  outFile: string,
  opts: { timeoutMs?: number; format?: string; quality?: number } = {},
): Promise<CliResult> {
  const t0 = Date.now();
  try {
    const res = await postJson("/api/pc/run", {
      chain,
      format: opts.format,
      quality: opts.quality,
      input: await inputFromFile(inFile),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      return errResult(
        t0 - Date.now() === 0 ? 0 : Date.now() - t0,
        `HTTP ${res.status}: ${e.error || res.statusText}`,
      );
    }
    await writeOutput(res, outFile);
    return okResult(Date.now() - t0);
  } catch (e) {
    return errResult(Date.now() - t0, e instanceof Error ? e.message : String(e));
  }
}

export async function remoteConvertFile(
  inFile: string,
  outFile: string,
  opts: { format?: string; quality?: number } = {},
): Promise<CliResult> {
  const t0 = Date.now();
  try {
    const res = await postJson("/api/pc/convert", {
      outFormat: opts.format,
      quality: opts.quality,
      input: await inputFromFile(inFile),
    });
    if (!res.ok) {
      const e = (await res.json().catch(() => ({}))) as { error?: string };
      return errResult(Date.now() - t0, `HTTP ${res.status}: ${e.error || res.statusText}`);
    }
    await writeOutput(res, outFile);
    return okResult(Date.now() - t0);
  } catch (e) {
    return errResult(Date.now() - t0, e instanceof Error ? e.message : String(e));
  }
}

export async function remoteDocInfo(
  file: string,
): Promise<CliResult & { info?: Record<string, unknown> }> {
  const t0 = Date.now();
  try {
    const res = await postJson("/api/pc/info", { input: await inputFromFile(file) });
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      info?: Record<string, unknown>;
    };
    if (!res.ok || !data.ok) {
      return { ...errResult(Date.now() - t0, data.error || `HTTP ${res.status}`), info: undefined };
    }
    return { ...okResult(Date.now() - t0), info: data.info };
  } catch (e) {
    return {
      ...errResult(Date.now() - t0, e instanceof Error ? e.message : String(e)),
      info: undefined,
    };
  }
}
