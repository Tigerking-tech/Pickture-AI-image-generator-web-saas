/**
 * pc.ts — PhotoCraft CLI 封装（服务端专用）
 *
 * PhotoCraft v0.15.1, MIT OR Apache-2.0 双许可（见 vendor/photocraft/LICENSE-MIT）。
 * 设计约束：
 *  - 只允许白名单命令（见 lib/whitelist.ts）
 *  - 每次调用有超时保护和输出大小上限
 *  - 所有调用返回结构化结果
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PC_CLI =
  process.env.PC_CLI || path.join(process.cwd(), "vendor", "photocraft", "photocraft-cli");
const DEFAULT_TIMEOUT_MS = Number(process.env.PC_TIMEOUT_MS || 30000);
const MAX_STDOUT = 512 * 1024;

export interface CliResult {
  ok: boolean;
  cmd: string;
  ms: number;
  code: number | null;
  killed: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export function cliPath(): string {
  return PC_CLI;
}

export function cliAvailable(): boolean {
  try {
    fs.accessSync(PC_CLI, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** 执行一条 CLI 子命令（convert/run/batch/info/commands），返回结构化结果 */
export function execCli(args: string[], opts: { timeoutMs?: number; fullOutput?: boolean } = {}): Promise<CliResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, fullOutput = false } = opts;
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = "";
    let stderr = "";
    let killed = false;
    const child = spawn(PC_CLI, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX_STDOUT) stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX_STDOUT) stderr += d.toString();
    });
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        cmd: args.join(" "),
        ms: Date.now() - t0,
        code: null,
        killed,
        error: `spawn: ${err.message}`,
        stdout,
        stderr,
      });
    });
    child.on("close", (code: number | null) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        cmd: args.join(" "),
        ms: Date.now() - t0,
        code,
        killed,
        stdout: fullOutput ? stdout : stdout.slice(-4000),
        stderr: fullOutput ? stderr : stderr.slice(-4000),
      });
    });
  });
}

/** 执行一条 run 命令链（多个 --cmd） */
export async function runChain(
  inputFile: string,
  chain: { cmd: string; params?: Record<string, unknown> }[],
  outFile: string,
  opts: { timeoutMs?: number } = {},
): Promise<CliResult> {
  const args = ["run", inputFile];
  for (const step of chain) {
    args.push("--cmd", step.cmd);
    if (step.params !== undefined) {
      args.push("--params", JSON.stringify(step.params));
    }
  }
  args.push("--out", outFile);
  return execCli(args, opts);
}

/** 格式转换（PSD 往返等） */
export async function convertFile(inFile: string, outFile: string): Promise<CliResult> {
  return execCli(["convert", inFile, outFile]);
}

/** 文档检视：返回 JSON（尺寸、模式、图层树）。info 子命令不接受 --json，默认即输出 JSON */
export async function docInfo(file: string): Promise<CliResult & { info?: Record<string, unknown> }> {
  const r = await execCli(["info", file]);
  if (r.ok) {
    try {
      (r as CliResult & { info?: unknown }).info = JSON.parse(r.stdout);
    } catch {
      const s = r.stdout;
      const i = s.indexOf("{");
      const j = s.lastIndexOf("}");
      if (i >= 0 && j > i) {
        try {
          (r as CliResult & { info?: unknown }).info = JSON.parse(s.slice(i, j + 1));
        } catch {
          /* 放弃 */
        }
      }
    }
  }
  return r as CliResult & { info?: Record<string, unknown> };
}

/** 临时文件工具（服务端 /tmp 或系统临时目录） */
export function tmpPath(ext: string): string {
  return path.join(os.tmpdir(), `surepix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

export function rmQuiet(files: string[]): void {
  for (const f of files) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* 忽略 */
    }
  }
}
