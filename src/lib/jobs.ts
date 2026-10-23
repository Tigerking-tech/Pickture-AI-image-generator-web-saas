/**
 * 异步作业表（内存）—— 拆解与生图共用
 *
 * 为什么需要（2026-10-23 实测）：
 *   线上链路（外网代理）对"长时间无响应"的请求会在约 15s 时返回 524 / 掐断连接
 *   （手机端表现为 "Failed to fetch"）。而本产品的两个 AI 步骤都远超 15s：
 *     · 拆句：带思维链 40~70s（关掉思维链虽快到 16s，但"背对着镜头"会错抽）
 *     · 出图：4~9 张候选 15~25s
 *   因此统一改为「短请求提交任务 + 短请求轮询结果」：
 *   提交 <1s、每次轮询 <1s，任何一次都不会触碰超时。
 *
 * 适用范围：单进程部署（sandbox / next start）。迁到 Serverless 时，
 *   把本文件换成 Supabase 表或 Redis 即可，调用方无需改动。
 */
export type JobStatus = "pending" | "done" | "error";

export interface AsyncJob {
  status: JobStatus;
  /** 人可读进度，如 "2/3 element groups done" */
  progress?: string;
  /** 作业结果：拆解为 VISTA 要素树；生图为 { mode, images, ... } */
  result?: unknown;
  /** 失败原因（人话） */
  message?: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000;

// 进程内共享（dev 热更新也要保住，故挂 globalThis）
const globalRef = globalThis as { __asyncJobs?: Map<string, AsyncJob> };
if (!globalRef.__asyncJobs) {
  globalRef.__asyncJobs = new Map();
}
const store: Map<string, AsyncJob> = globalRef.__asyncJobs;

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of store) {
    if (now - job.createdAt > TTL_MS) store.delete(id);
  }
}

export function createJob(): string {
  sweep();
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  store.set(id, { status: "pending", createdAt: Date.now() });
  return id;
}

export function getJob(id: string): AsyncJob | undefined {
  sweep();
  return store.get(id);
}

export function updateJob(id: string, patch: Partial<AsyncJob>): void {
  const cur = store.get(id);
  if (!cur) return;
  store.set(id, { ...cur, ...patch });
}

export function completeJob(id: string, result: unknown): void {
  updateJob(id, { status: "done", result, progress: "done" });
}

export function failJob(id: string, message: string): void {
  updateJob(id, { status: "error", message });
}
