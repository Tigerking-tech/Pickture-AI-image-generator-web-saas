import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/export — 当前用户本人的全部数据打包下载（GDPR 数据可携权）
 *
 * 此前系统里没有任何导出能力：用户问「我的数据怎么拿走」没有答案，
 * 而 GDPR 的可携权要求就是一条 Carlos 式的硬约束（不看公司大小）。
 * 一律按 auth.uid() 取数据，不接收任何外部 id —— 这里不存在越权空间。
 */
export async function GET() {
  if (isDemoMode()) {
    return NextResponse.json({ error: "Export is not available in demo mode" }, { status: 400 });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const userId = user.id;

  const [profile, credits, creditTx, subscription, licenses, billingEvents, audit] =
    await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      db.from("credits").select("*").eq("user_id", userId).maybeSingle(),
      db
        .from("credit_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5000),
      db.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
      db.from("licenses").select("*").eq("user_id", userId),
      db.from("billing_events").select("*").eq("user_id", userId),
      db
        .from("audit_log")
        .select("*")
        .eq("actor_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);

  const payload = {
    exported_at: new Date().toISOString(),
    account: {
      id: userId,
      email: user.email ?? null,
      created_at: user.created_at ?? null,
    },
    profile: profile.data ?? null,
    subscription: subscription.data ?? null,
    credits: credits.data ?? null,
    credit_transactions: creditTx.data ?? [],
    licenses: licenses.data ?? [],
    billing_events: billingEvents.data ?? [],
    audit_log: audit.data ?? [],
    note: "This export covers all personal data stored in Surepix's own database. Usage counters in Redis (fair-use limits) expire automatically and are not part of this export. Payment card data is never stored by us — Creem is the Merchant of Record.",
  };

  const filename = `surepix-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
