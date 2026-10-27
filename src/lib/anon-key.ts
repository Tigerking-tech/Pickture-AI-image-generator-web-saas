import type { NextRequest } from "next/server";

/**
 * 从请求提取匿名限流 key：IP（x-forwarded-for / x-real-ip / req.ip）+ UA 截断指纹。
 * 仅作成本闸门，非安全鉴权（前端指纹不可信）。
 * /api/edit 与 /api/anon-quota 必须复用同一推导，否则前后端配额 key 不一致。
 */
export function extractAnonKey(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  const ip =
    (fwd ? fwd.split(",")[0].trim() : undefined) ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ua = (req.headers.get("user-agent") || "").slice(0, 64);
  return `anon:${ip}::${ua}`;
}
