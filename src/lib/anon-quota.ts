/**
 * anon-quota.ts — 匿名生成式试用配额（轻量 IP/UA 指纹限流）
 *
 * 对标竞品漏斗（Photoroom / remove.bg 都不强制生成式登录）：
 *   · 确定性编辑（去背景换白底、调色、resize，走本地 PhotoCraft）→ $0 → 免登录全开
 *   · 生成式编辑（fal.ai 按次计费 ≈ $0.02）→ 对匿名用户开放有限次试用，
 *     超出后返回 ANON_QUOTA_EXCEEDED 提示登录；登录后走积分账本（credits.ts）。
 *
 * 存储（成本闸门，非安全鉴权门）：
 *   · 优先 Upstash Redis：多实例共享、进程重启不丢、每日独立 key + TTL 次日 UTC 零点自动过期。
 *   · 未配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 时降级为进程内内存 Map
 *     （dev / demo / 单实例场景；重启清零，行为与旧版一致）。
 */

import { Redis } from "@upstash/redis";
import { isDemoMode } from "@/lib/demo/mode";

/** 匿名生成式每日试用上限（运营可调，见 .env.example 的 ANON_GENERATIVE_DAILY_LIMIT） */
const DEFAULT_DAILY_LIMIT = Number(process.env.ANON_GENERATIVE_DAILY_LIMIT ?? 3);

// 复用 rate-limit.ts 的 Upstash 客户端初始化方式：仅当 env 齐全才建立客户端。
const redis: Redis | null =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// 降级存储（无 Redis 时使用）
type MemEntry = { day: string; count: number };
const memStore = new Map<string, MemEntry>();

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD（UTC）
}

function nextMidnightUTC(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** 距下次 UTC 零点的秒数（用作 Redis key 的 TTL，使其次日自动过期，无需手动清理） */
function secondsUntilNextMidnightUTC(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return Math.max(1, Math.floor((d.getTime() - Date.now()) / 1000));
}

/** 把任意 anonKey（可能含 IP/UA 特殊字符）编码为安全 Redis key，并加每日前缀 */
function dailyRedisKey(anonKey: string): string {
  const safe = Buffer.from(anonKey).toString("base64url");
  return `anonq:${todayUTC()}:${safe}`;
}

export interface AnonQuotaStatus {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: string; // 下次 UTC 零点 ISO
}

async function getCount(anonKey: string): Promise<number> {
  if (redis) {
    const c = await redis.get<number>(dailyRedisKey(anonKey));
    return typeof c === "number" ? c : 0;
  }
  const e = memStore.get(anonKey);
  return e && e.day === todayUTC() ? e.count : 0;
}

async function incrCount(anonKey: string): Promise<void> {
  if (redis) {
    const k = dailyRedisKey(anonKey);
    await redis.incr(k);
    await redis.expire(k, secondsUntilNextMidnightUTC());
    return;
  }
  const day = todayUTC();
  const e = memStore.get(anonKey);
  if (!e || e.day !== day) {
    memStore.set(anonKey, { day, count: 1 });
  } else {
    e.count += 1;
    memStore.set(anonKey, e);
  }
}

/**
 * 预检：匿名用户是否还有今日生成式试用额度。
 * demo 模式短路放行（fal 为 mock，不烧钱）。
 */
export async function checkAnonGenerativeQuota(key: string): Promise<AnonQuotaStatus> {
  const limit = DEFAULT_DAILY_LIMIT;
  if (isDemoMode()) {
    return { allowed: true, remaining: limit, limit, resetAt: nextMidnightUTC() };
  }
  const count = await getCount(key);
  const remaining = Math.max(0, limit - count);
  return { allowed: remaining > 0, remaining, limit, resetAt: nextMidnightUTC() };
}

/** 生成成功后消费一次额度（best-effort；demo 模式内部短路不计）。 */
export async function consumeAnonGenerativeQuota(key: string): Promise<void> {
  if (isDemoMode()) return;
  await incrCount(key);
}

/** 查询当前配额状态（同 check，供前端展示） */
export async function getAnonQuotaStatus(key: string): Promise<AnonQuotaStatus> {
  return checkAnonGenerativeQuota(key);
}
