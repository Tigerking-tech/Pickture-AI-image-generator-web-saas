import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * 数据飞轮看板（PRD §9.5）
 *
 * 目的：让"越用越聪明"这件事变得可见 ——
 *   现在攒了多少选择信号、各属性的最热候选是什么、够不够开学习点 B。
 *
 * 权限：ADMIN_EMAIL 为真实邮箱时，只有该邮箱登录者可看；
 *       未配置/仍是占位值时视为本地开发态开放（上线前请务必配置真实邮箱）。
 *
 * 注意：本页只"看"数据，不做任何自动改写候选的动作
 * （PRD §9.5.4 红线：飞轮只优化排序，绝不替用户做决定）。
 */

/** 开学习点 B（全局候选重排）所需的最小样本量（PRD §9.5.3：有量后再开） */
const B_THRESHOLD = 1000;
/** 单次读取上限：MVP 阶段在应用层聚合，量大后应改成 SQL 视图/RPC */
const READ_LIMIT = 5000;

interface AttrStat {
  attr: string;
  total: number;
  top: Array<{ value: string; count: number }>;
}

export default async function FlywheelPage() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "";
  const configured = adminEmail !== "" && !adminEmail.includes("example.com");

  if (configured) {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.email !== adminEmail) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
          <h1 className="text-xl font-semibold text-ink">Admin only</h1>
          <p className="mt-2 text-sm text-ink-muted">
            This page is restricted to the configured admin account. Sign in with the ADMIN_EMAIL
            account to view flywheel data.
          </p>
          <Link href="/" className="mt-6 text-sm text-accent hover:underline">
            ← Back home
          </Link>
        </main>
      );
    }
  }

  const db = getSupabaseAdmin();
  const [{ count: pickCount }, { count: decompCount }, { data: picks }, { data: outcomes }] =
    await Promise.all([
      db.from("selections").select("*", { count: "exact", head: true }).eq("event", "pick"),
      db.from("decompositions").select("*", { count: "exact", head: true }),
      db
        .from("selections")
        .select("node_attr, candidate_value, session_id")
        .eq("event", "pick")
        .limit(READ_LIMIT),
      db.from("selections").select("satisfaction").eq("event", "outcome").limit(READ_LIMIT),
    ]);

  const rows = (picks ?? []) as Array<{
    node_attr: string;
    candidate_value: string | null;
    session_id: string;
  }>;

  // 应用层聚合：属性 → 候选值 → 被选次数
  const byAttr = new Map<string, Map<string, number>>();
  const sessions = new Set<string>();
  for (const r of rows) {
    if (r.session_id) sessions.add(r.session_id);
    const value = r.candidate_value ?? "(unknown)";
    if (!byAttr.has(r.node_attr)) byAttr.set(r.node_attr, new Map());
    const m = byAttr.get(r.node_attr) as Map<string, number>;
    m.set(value, (m.get(value) ?? 0) + 1);
  }

  const stats: AttrStat[] = [...byAttr.entries()]
    .map(([attr, m]) => {
      const top = [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
      return { attr, total: [...m.values()].reduce((s, c) => s + c, 0), top };
    })
    .sort((a, b) => b.total - a.total);

  const outcomeRows = (outcomes ?? []) as Array<{ satisfaction: string | null }>;
  const positive = outcomeRows.filter((o) => o.satisfaction === "positive").length;
  const negative = outcomeRows.filter((o) => o.satisfaction === "negative").length;

  const total = pickCount ?? 0;
  const remaining = Math.max(0, B_THRESHOLD - total);
  const progress = Math.min(100, Math.round((total / B_THRESHOLD) * 100));

  const cards = [
    { label: "Candidate picks", value: total, hint: "学习点 A 的核心数据" },
    { label: "Sessions", value: sessions.size, hint: "独立创作会话数" },
    { label: "Decompositions", value: decompCount ?? 0, hint: "拆解留档（供 D 用）" },
    { label: "Positive signals", value: positive, hint: "走到终图" },
    { label: "Negative signals", value: negative, hint: "同节点重出 > 3 次" },
  ];

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 text-ink md:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Flywheel</h1>
            <p className="mt-1 text-sm text-ink-muted">
              选择信号沉淀情况（PRD §9.5 学习点 A）。本页只读，不会自动改写任何候选。
            </p>
          </div>
          <Link href="/create" className="text-sm text-accent hover:underline">
            Open studio →
          </Link>
        </header>

        {/* 冷启动进度：够不够开学习点 B */}
        <section className="mt-8 rounded-xl border border-hairline bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Progress to learning point B</h2>
            <span className="text-xs text-ink-dim">
              {total} / {B_THRESHOLD}
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            {remaining > 0
              ? `还差 ${remaining} 条点选即可开启“全局候选重排”（集体智慧）。样本太少时开启会把噪声学进去，PRD §9.5.3 明确要求先攒量。`
              : "样本量已达标，可以开启学习点 B：把最常被选的候选排到第一位。"}
          </p>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-hairline bg-surface p-4">
              <p className="text-xs text-ink-dim">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{c.value}</p>
              <p className="mt-1 text-[11px] text-ink-dim">{c.hint}</p>
            </div>
          ))}
        </section>

        <section className="mt-8">
          <h2 className="text-sm font-medium">Most picked candidates by element</h2>
          {stats.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-hairline-strong p-6 text-sm text-ink-muted">
              还没有数据。去 studio 创作几次（点选候选后）这里就会有记录。
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {stats.map((s) => (
                <div key={s.attr} className="rounded-xl border border-hairline bg-surface p-4">
                  <div className="flex items-baseline justify-between">
                    <code className="text-xs text-accent">{s.attr}</code>
                    <span className="text-xs text-ink-dim">{s.total} picks</span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {s.top.map((t) => {
                      const pct = Math.round((t.count / s.total) * 100);
                      return (
                        <li key={t.value} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-xs text-ink" title={t.value}>
                            {t.value}
                          </span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full bg-accent"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                            {t.count}·{pct}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {!configured && (
          <p className="mt-8 rounded-xl border border-hairline bg-surface p-4 text-xs text-ink-muted">
            当前 ADMIN_EMAIL
            未配置（或仍是占位值），本页处于开放状态。上线前请在环境变量里设置真实管理员邮箱，本页将自动只对该账号开放。
          </p>
        )}
      </div>
    </main>
  );
}
