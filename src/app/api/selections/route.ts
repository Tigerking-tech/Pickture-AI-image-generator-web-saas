import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * R9 数据飞轮埋点：用户在任一节点点选候选 → 写入 selections
 *
 * PRD §9.5.1 学习点 A（选择信号沉淀）—— MVP 阶段全量埋点，
 * 有量后再做全局重排（学习点 B）与个性化（C）。
 */

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { success } = await checkRateLimit(user?.id ?? "anonymous");
  if (!success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: {
    sessionId?: string;
    nodeAttr?: string;
    candidateIndex?: number;
    wasPicked?: boolean;
    satisfaction?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.sessionId || !body.nodeAttr || typeof body.candidateIndex !== "number") {
    return NextResponse.json(
      { error: "missing_fields", requires: ["sessionId", "nodeAttr", "candidateIndex"] },
      { status: 400 },
    );
  }

  const satisfaction =
    body.satisfaction === "positive" ||
    body.satisfaction === "neutral" ||
    body.satisfaction === "negative"
      ? body.satisfaction
      : null;

  const db = getSupabaseAdmin();
  const { error } = await db.from("selections").insert({
    user_id: user?.id ?? null,
    session_id: body.sessionId,
    node_attr: body.nodeAttr,
    candidate_index: body.candidateIndex,
    was_picked: body.wasPicked ?? false,
    satisfaction,
  });

  if (error) {
    return NextResponse.json({ error: "db_error", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
