import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import {
  buildMetadata,
  SITE_NAME,
  softwareApplicationJsonLd,
  VALUE_HOOK,
  webSiteJsonLd,
} from "@/lib/seo";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Landing（T14 / PRD §10.4）
 *
 * 设计语言：Midjourney 的近黑画布与排版叙事 + Leonardo 的纯黑与白胶囊 CTA
 *          + Ideogram 的克制微文案（不用感叹号、不用“免费开始”式叫卖）。
 * 记忆点：18 张 $0.003 决策辅助 vs 8 张 $0.04 赌注 的几何对比构图。
 */
export const metadata = buildMetadata({
  title: `${SITE_NAME} — One sentence. A few clicks. One finished image.`,
  description: VALUE_HOOK,
  path: "/",
});

const COMPARISON = [
  {
    dim: "Prompt",
    old: "Write 100–200 words, often rewritten with ChatGPT",
    now: "Say 1 sentence — the LLM decomposes it for you",
  },
  {
    dim: "Attempts",
    old: "6–10 generations before one is usable",
    now: "The final image is generated exactly once",
  },
  {
    dim: "Cost per usable image",
    old: "$0.15–0.40 (measured on Midjourney)",
    now: "~$0.10 (18 previews + 1 final)",
  },
  { dim: "Time", old: "15–30 minutes", now: "2–5 minutes" },
];

// 装饰性对比方块：用稳定 id 常量作 key，而非数组下标
const BET_BLOCKS = Array.from({ length: 8 }, (_, i) => `bet-${i}`);
const AID_BLOCKS = Array.from({ length: 18 }, (_, i) => `aid-${i}`);

const STEPS = [
  {
    step: "01",
    title: "Say one sentence",
    body: "“A girl and a dog running at sunset.” We turn it into a structured set of visual elements.",
  },
  {
    step: "02",
    title: "Click to choose",
    body: "Each element shows 2–4 real candidate images. You pick. You never write a 200-word prompt.",
  },
  {
    step: "03",
    title: "Get one finished image",
    body: "Once every decision is made, we compose one high-quality final image — C2PA provenance kept.",
  },
];

export default async function LandingPage() {
  // 首页作品预览条：真实产出，不是装饰（Ideogram / Leonardo 首页范式）
  let showcase: Array<{ id: string; url: string; caption: string | null }> = [];
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("works")
      .select("id, sentence, final_image_url")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(6);
    showcase = (
      (data ?? []) as Array<{ id: string; sentence: string | null; final_image_url: string | null }>
    )
      .filter((w) => w.final_image_url)
      .map((w) => ({ id: w.id, url: w.final_image_url as string, caption: w.sentence }));
  } catch {
    // 数据库不可用时静默降级为不展示，不伪造内容
    showcase = [];
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <JsonLd data={[webSiteJsonLd(), softwareApplicationJsonLd()]} />

      {/* ── Header：极简铬色，绝不喧宾夺主 ── */}
      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <span className="font-display text-lg font-extrabold tracking-tight">{SITE_NAME}</span>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/gallery"
              className="rounded-full px-3 py-2 text-ink-secondary transition hover:text-ink"
            >
              Gallery
            </Link>
            <Link
              href="/pricing"
              className="rounded-full px-3 py-2 text-ink-secondary transition hover:text-ink"
            >
              Pricing
            </Link>
            <Link href="/login" className="btn-primary ml-1 px-4 py-2 text-sm">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero：黑屏开场 + 一行白字（Leonardo 的 cold open）── */}
      <section className="relative overflow-hidden">
        {/* 纵深：极淡紫罗兰光晕，不装饰、只营造空间 */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(139,92,246,0.14),transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl px-4 py-16 text-center md:px-6 md:py-24">
          <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight md:text-6xl">
            Stop gambling on prompts.
            <br />
            <span className="text-ink-secondary">Start choosing.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-secondary md:text-lg">
            {VALUE_HOOK}
          </p>
          {/* Ideogram / Leonardo 首页范式：落地页本身就是产品入口，输入框置顶 */}
          <form
            action="/create"
            method="get"
            className="mx-auto mt-8 flex max-w-xl flex-col gap-2 sm:flex-row"
          >
            <input
              name="q"
              placeholder="a girl and a dog running at sunset"
              aria-label="Describe the image you want"
              className="h-12 flex-1 rounded-full border border-hairline-strong bg-surface-elevated px-5 text-sm text-ink outline-none transition placeholder:text-ink-dim focus:border-accent"
            />
            <button type="submit" className="btn-primary h-12 px-7 text-sm">
              Generate
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link
              href="/pricing"
              className="font-mono text-xs text-ink-muted transition hover:text-ink"
            >
              See pricing
            </Link>
            <span className="font-mono text-xs text-ink-muted">
              60 credits / month · no card required
            </span>
          </div>
          {/* 作品预览条：让用户一眼看到真实产出 */}
          {showcase.length > 0 && (
            <div className="mx-auto mt-12 max-w-4xl px-4 md:px-6">
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {showcase.map((w) => (
                  <Link
                    key={w.id}
                    href="/gallery"
                    className="overflow-hidden rounded-sm"
                    aria-label={w.caption ?? "Work"}
                  >
                    {/* biome-ignore lint/performance/noImgElement: 作品图由本平台生成并自行托管为 WebP */}
                    <img
                      src={w.url}
                      alt={w.caption ?? "Generated work"}
                      loading="lazy"
                      className="aspect-square w-full object-cover transition hover:opacity-85"
                    />
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-center font-mono text-[11px] text-ink-dim">
                made with one sentence each
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── 记忆点：18 张决策辅助 vs 8 张赌注 ── */}
      <section className="border-y border-hairline bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-12 md:px-6 md:py-16">
          <div className="grid gap-6 md:grid-cols-2">
            {/* 抽卡：8 张贵价赌注 */}
            <div className="panel p-5">
              <div className="grid grid-cols-4 gap-1.5">
                {BET_BLOCKS.map((id) => (
                  <div
                    key={id}
                    className="aspect-square rounded-[3px] border border-accent/50 bg-accent-soft"
                  />
                ))}
              </div>
              <p className="mt-4 font-mono text-xs text-ink-muted">
                <span className="text-accent">8 × $0.04</span> — every one a bet
              </p>
              <p className="mt-1 text-sm text-ink-secondary">
                Prompt gambling: you pay full price before you know what you get.
              </p>
            </div>

            {/* 决策树：18 张便宜辅助 */}
            <div className="panel p-5">
              <div className="grid grid-cols-6 gap-1">
                {AID_BLOCKS.map((id) => (
                  <div
                    key={id}
                    className="aspect-square rounded-[2px] bg-surface-hover ring-1 ring-hairline"
                  />
                ))}
              </div>
              <p className="mt-4 font-mono text-xs text-ink-muted">
                <span className="text-ink">18 × $0.003</span> — every one a decision aid
              </p>
              <p className="mt-1 text-sm text-ink-secondary">
                {SITE_NAME}: the expensive generation happens once, after you decide.
              </p>
            </div>
          </div>

          <blockquote className="mt-8 border-l-2 border-accent pl-4 text-sm leading-relaxed text-ink-secondary md:text-base">
            <strong className="text-ink">
              Their 8 images are all $0.04 bets. Our 18 previews are all $0.003 decision aids.
            </strong>{" "}
            The difference isn’t how many images you get — it’s whether the expensive generation is
            a gamble.
          </blockquote>
        </div>
      </section>

      {/* ── 对比表：发丝线分隔 ── */}
      <section className="mx-auto max-w-4xl px-4 py-14 md:px-6 md:py-20">
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
          Prompt gambling vs. choosing
        </h2>
        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[540px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline-strong text-left">
                <th className="py-3 pr-4 font-medium text-ink-muted">Dimension</th>
                <th className="py-3 pr-4 font-medium text-ink-muted">
                  Traditional “roll the dice”
                </th>
                <th className="py-3 font-medium text-ink">{SITE_NAME} decision tree</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.dim} className="border-b border-hairline align-top">
                  <td className="py-4 pr-4 font-mono text-xs text-ink-muted">{row.dim}</td>
                  <td className="py-4 pr-4 text-ink-muted">{row.old}</td>
                  <td className="py-4 text-ink">{row.now}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 三步流程 ── */}
      <section className="border-t border-hairline bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-14 md:px-6 md:py-20">
          <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
            How it works
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.step} className="panel p-6">
                <div className="font-mono text-xs text-accent">{s.step}</div>
                <h3 className="mt-3 font-display text-lg font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-secondary">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="relative overflow-hidden border-t border-hairline py-16 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_120%,rgba(139,92,246,0.12),transparent_60%)]" />
        <div className="relative mx-auto max-w-2xl px-4">
          <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
            One sentence is all it takes
          </h2>
          <Link
            href="/create"
            className="btn-primary mt-7 inline-flex items-center gap-2 px-7 py-3.5"
          >
            Generate
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-hairline py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-ink-muted md:flex-row md:px-6">
          <span>{SITE_NAME}</span>
          <div className="flex gap-4">
            <Link href="/gallery" className="hover:text-ink">
              Gallery
            </Link>
            <Link href="/pricing" className="hover:text-ink">
              Pricing
            </Link>
            <Link href="/llms.txt" className="hover:text-ink">
              llms.txt
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
