import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/**
 * 计费 / 订阅操作：10 次 / 分钟 / 用户。
 * 这些动作都会打到 Creem API 或直接改变账单，收紧一点是对的。
 */
const rateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "60 s"),
    })
  : null;

/**
 * 编辑管线专用：60 次 / 分钟 / identifier。
 *
 * 为什么要单独一条：
 *  - 编辑是用户的主路径（链式编辑一次会话会连点几次），沿用 10/60s 太紧；
 *  - 但 /api/edit 会真实烧钱（生成式走 fal ≈ $0.02/次，确定性编辑烧本机 CPU），
 *    完全不限则任何人都能把它当免费算力。
 *
 * 未配置 Upstash → 两个 limiter 都为 null，check* 恒返回 success=true
 * （dev / demo 行为不变）。**生产必须配 Upstash**，否则等于没有限流。
 */
const editLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, "60 s"),
      prefix: "ratelimit:edit",
    })
  : null;

export async function checkRateLimit(identifier: string): Promise<{ success: boolean }> {
  if (!rateLimiter) return { success: true };
  return rateLimiter.limit(identifier);
}

/** 编辑管线的专用限流（identifier 由调用方按 IP 或 userId 决定） */
export async function checkEditRateLimit(identifier: string): Promise<{ success: boolean }> {
  if (!editLimiter) return { success: true };
  return editLimiter.limit(identifier);
}

/** 限流是否真实启用（配了 Upstash 才为 true）—— 上线自检用 */
export function rateLimitsActive(): boolean {
  return redis !== null;
}
