import { type NextRequest, NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";
import { getDemoStore } from "@/lib/demo/store";
import { checkRateLimit } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import {
  creditsForIntent,
  isUnlimited,
  spendForIntents,
} from "@/lib/credits";
import { validateSpendRequest } from "../helpers";

export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    const body = await request.json();
    const store = getDemoStore();
    const wallet = store.creditWallets.get("demo-user") ?? { user_id: "demo-user", balance: 0 };
    store.creditWallets.set("demo-user", wallet);
    if (!isUnlimited(wallet.balance)) {
      const cost = creditsForIntent(body.intent ?? "");
      if (wallet.balance < cost) {
        return NextResponse.json({ error: "Insufficient credits", code: "INSUFFICIENT" }, { status: 402 });
      }
      wallet.balance = Math.max(0, wallet.balance - cost);
    }
    return NextResponse.json({ balance: wallet.balance });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { success } = await checkRateLimit(user.id);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const body = await request.json();
  const validation = validateSpendRequest(body);
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const cost = creditsForIntent(validation.data.intent);

  // 余额预校验（无限计划 -1 永远通过）
  const { data: wallet } = await getSupabaseAdmin()
    .from("credits")
    .select("balance")
    .eq("user_id", user.id)
    .single();
  if (wallet && !isUnlimited(wallet.balance) && wallet.balance < cost) {
    return NextResponse.json(
      { error: "Insufficient credits", code: "INSUFFICIENT", need: cost, have: wallet.balance },
      { status: 402 },
    );
  }

  // 原子扣减（spend_credits RPC 防并发超扣）
  const res = await spendForIntents(user.id, [validation.data.intent], validation.data.description!);
  if (!res.ok) {
    const status = res.code === "INSUFFICIENT" ? 402 : res.code === "NO_WALLET" ? 404 : 500;
    return NextResponse.json({ error: res.error, code: res.code }, { status });
  }

  return NextResponse.json({ balance: res.balance, spent: res.delta });
}
