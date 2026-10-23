import { NextResponse } from "next/server";
import { getPlan } from "@/lib/credits";
import { isDemoMode } from "@/lib/demo/mode";
import { getDemoStore } from "@/lib/demo/store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function GET() {
  if (isDemoMode()) {
    const store = getDemoStore();
    const wallet = store.creditWallets.get("demo-user");
    // 一并回传套餐：前端按套餐决定每节点候选数（免费 4 / 付费 9）
    const plan = await getPlan("demo-user");
    return NextResponse.json({ balance: wallet?.balance ?? 0, plan });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await getSupabaseAdmin()
    .from("credits")
    .select("balance")
    .eq("user_id", user.id)
    .single();

  // 套餐以服务端为准（前端据此决定候选数，不自行声明）
  const plan = await getPlan(user.id);
  return NextResponse.json({ balance: data?.balance ?? 0, plan });
}
