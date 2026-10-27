import type { NextRequest } from "next/server";

/**
 * 从请求提取匿名限流 key：**只用 IP**，不再掺 UA。
 *
 * 变更说明：旧实现是 `anon:${ip}::${ua前64字符}`，而 UA 完全由客户端控制 ——
 * 改一个字符就是一个全新的配额 key，所谓「每天 3 次免费试用」形同虚设。
 * 现在只取 IP（x-forwarded-for 首段 / x-real-ip）。
 *
 * 取舍：同一出口 IP 下的多个访客会共享匿名配额（家庭 / 公司 NAT 场景）。
 * 这是「可随意绕过」与「可能误伤共享 IP」之间的必要取舍 —— 生成式编辑按次
 * 真实计费（≈$0.02/次），前者会导致成本失控。真实额度请登录后使用
 * （登录用户走积分账本 credits.ts，不受此配额限制）。
 *
 * /api/edit 与 /api/anon-quota 必须复用同一推导，否则前后端配额展示不一致。
 */
export function extractAnonKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip =
    (fwd ? fwd.split(",")[0].trim() : undefined) || req.headers.get("x-real-ip") || "unknown";
  return `anon:${ip}`;
}
