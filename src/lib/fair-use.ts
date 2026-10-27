/**
 * fair-use.ts — 月度 fair-use 计数器（防薅：免费确定性编辑 / 导出的 CPU 成本闸门）
 *
 * 产品楔子："确定性编辑（白底 / 调色 / resize，走本地 PhotoCraft）免费且一致"——
 * 边际成本≈本地 CPU、无第三方按次 API 费，但无限制会被脚本刷爆。本模块按自然月
 * 对每个用户（登录用 userId，匿名用 anonKey 指纹）累计用量，超出计划上限时拒绝并提示升级。
 *
 * 上限（与定价页 COMPARISON 表对齐）：
 *   Free 50 · Pro 5,000 · Max 15,000 · Enterprise 无限（每月 edits 与 exports 同上限）
 *
 * 存储：复用 anon-quota.ts 的 Upstash Redis 客户端模式；未配置则降级进程内内存 Map。
 * demo 模式短路放行（不计数），与 credits / anon-quota 行为一致。
 */

import { Redis } from "@upstash/redis";
import { isDemoMode } from "@/lib/demo/mode";

export type FairUseKind = "edits" | "exports";

const DEFAULT_LIMITS: Record<string, { edits: number; exports: number }> = {
  free: { edits: 50, exports: 50 },
  starter: { edits: 50, exports: 50 },
  pro: { edits: 5000, exports: 5000 },
  max: { edits: 15000, exports: 15000 },
  scale: { edits: 15000, exports: 15000 },
  enterprise: { edits: -1, exports: -1 }, // -1 = 无限
};

function normalizePlan(plan: string): string {
  const p = (plan || "").toLowerCase();
  if (p === "starter") return "free";
  if (p === "scale") return "max";
  return p;
}

/** 某计划某类用量的月度上限（-1 = 无限） */
export function fairUseLimit(plan: string, kind: FairUseKind): number {
  const key = normalizePlan(plan);
  const lim = DEFAULT_LIMITS[key] ?? DEFAULT_LIMITS.free;
  return lim[kind];
}

// 复用 rate-limit.ts / anon-quota.ts 的 Upstash 客户端初始化方式：仅当 env 齐全才建立客户端。
const redis: Redis | null =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// 降级存储（无 Redis 时使用）
const memStore = new Map<string, number>();

function monthBucket(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM（UTC）
}

function nextMonthUTC(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

function redisKey(subject: string, kind: FairUseKind): string {
  const safe = Buffer.from(subject).toString("base64url");
  return `fairuse:${monthBucket()}:${kind}:${safe}`;
}

/** 距下次 UTC 月初的秒数（用作 Redis key 的 TTL，使其下月自动过期，无需手动清理） */
function secondsUntilNextMonthUTC(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.max(1, Math.floor((d.getTime() - Date.now()) / 1000));
}

/** subject：登录用户 u:{userId}，匿名 a:{anonKey}；均无则 a:anonymous */
function subjectKey(userId: string | undefined, anonKey?: string): string {
  if (userId) return `u:${userId}`;
  if (anonKey) return `a:${anonKey}`;
  return "a:anonymous";
}

export interface FairUseStatus {
  used: number;
  limit: number; // -1 = 无限
  remaining: number; // -1 = 无限
  unlimited: boolean;
  resetAt: string; // 下月 UTC 零点
}

async function getCount(key: string): Promise<number> {
  if (redis) {
    const c = await redis.get<number>(key);
    return typeof c === "number" ? c : 0;
  }
  return memStore.get(key) ?? 0;
}

async function incr(key: string): Promise<void> {
  if (redis) {
    await redis.incr(key);
    await redis.expire(key, secondsUntilNextMonthUTC());
    return;
  }
  memStore.set(key, (memStore.get(key) ?? 0) + 1);
}

export async function getFairUseStatus(
  userId: string | undefined,
  anonKey: string | undefined,
  plan: string,
  kind: FairUseKind,
): Promise<FairUseStatus> {
  const limit = fairUseLimit(plan, kind);
  if (limit < 0) {
    return { used: 0, limit: -1, remaining: -1, unlimited: true, resetAt: nextMonthUTC() };
  }
  const used = await getCount(redisKey(subjectKey(userId, anonKey), kind));
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    unlimited: false,
    resetAt: nextMonthUTC(),
  };
}

/** 预检：本月是否还有额度（demo 模式恒为 ok） */
export async function checkFairUse(
  userId: string | undefined,
  anonKey: string | undefined,
  plan: string,
  kind: FairUseKind,
): Promise<{ ok: boolean; status: FairUseStatus }> {
  if (isDemoMode()) {
    const limit = fairUseLimit(plan, kind);
    return {
      ok: true,
      status: {
        used: 0,
        limit,
        remaining: limit < 0 ? -1 : limit,
        unlimited: limit < 0,
        resetAt: nextMonthUTC(),
      },
    };
  }
  const status = await getFairUseStatus(userId, anonKey, plan, kind);
  if (status.unlimited) return { ok: true, status };
  return { ok: status.remaining > 0, status };
}

/** 成功后消费一次（best-effort；demo / 无限计划不计数） */
export async function consumeFairUse(
  userId: string | undefined,
  anonKey: string | undefined,
  plan: string,
  kind: FairUseKind,
): Promise<void> {
  if (isDemoMode()) return;
  if (fairUseLimit(plan, kind) < 0) return;
  try {
    await incr(redisKey(subjectKey(userId, anonKey), kind));
  } catch {
    // 计数失败不阻断交付
  }
}
