import { type NextRequest, NextResponse } from "next/server";
import { extractAnonKey } from "@/lib/anon-key";
import { getAnonQuotaStatus } from "@/lib/anon-quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/anon-quota — 返回当前匿名访客的生成式试用配额状态（前端展示用）。
 * 登录用户不在此限流，故匿名（无登录态）才返回真实剩余；demo 模式短路放行。
 */
export async function GET(req: NextRequest) {
  const status = await getAnonQuotaStatus(extractAnonKey(req));
  return NextResponse.json(status);
}
