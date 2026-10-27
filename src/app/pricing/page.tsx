import type { Metadata } from "next";
import Link from "next/link";
import { MobileNav } from "@/components/MobileNav";
import { PricingPlans } from "@/components/pricing-plans";

export const metadata: Metadata = {
  title: "Pricing — Verified Product-Photo Editing",
  description:
    "Surepix pricing: free tier, Pro $9/month ($7.50 billed yearly) with 5,000 deterministic edits & exports per month, Max $24/month ($19 billed yearly) with API access, plus Enterprise. Every plan includes per-element fidelity verification.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Surepix pricing — verified editing from $0",
    description:
      "Free tier with fidelity verification included. Pro from $7.50/month billed yearly, Max from $19/month. 14-day trial, cancel anytime.",
    type: "website",
  },
};

type Cell = boolean | string;

const COMPARISON: { feature: string; free: Cell; pro: Cell; max: Cell; ent: Cell }[] = [
  // ---- credits & limits ----
  {
    feature: "Deterministic edits (white bg, colour, resize, watermark)",
    free: "50 / month",
    pro: "5,000 / month",
    max: "15,000 / month",
    ent: "Custom",
  },
  {
    feature: "Generative AI credits",
    free: "5 / month",
    pro: "200 / month",
    max: "2,000 / month",
    ent: "Custom",
  },
  {
    feature: "Exports",
    free: "50 / month",
    pro: "5,000 / month",
    max: "15,000 / month",
    ent: "Custom",
  },
  { feature: "Watermark on exports", free: "Surepix mark", pro: "None", max: "None", ent: "None" },
  // Seats：目前订阅表里有 seats 字段并已接 Creem 席位计费，但没有 org / 成员 / 邀请模型，
  // 实际可用的仍然只有购买者本人。因此在团队模型落地前不对外宣传席位数量。
  {
    feature: "Seats",
    free: "1 (team model coming)",
    pro: "1 (team model coming)",
    max: "1 (team model coming)",
    ent: "Negotiable",
  },
  // ---- core tools (deterministic, not metered) ----
  { feature: "Background → pure white", free: true, pro: true, max: true, ent: true },
  { feature: "Colour & light (curves)", free: true, pro: true, max: true, ent: true },
  { feature: "Resize / fit-and-pad presets", free: true, pro: true, max: true, ent: true },
  { feature: "Sharpen & image enhancer", free: true, pro: true, max: true, ent: true },
  { feature: "Batch processing", free: false, pro: true, max: true, ent: true },
  { feature: "Editable PSD masters", free: false, pro: true, max: true, ent: true },
  { feature: "Brand-kit manifests", free: false, pro: true, max: true, ent: true },
  // ---- credit-intensive (generative) ----
  {
    feature: "Scene / lifestyle background",
    free: "5 / month",
    pro: "Up to 200",
    max: "Up to 2,000",
    ent: "Custom",
  },
  {
    feature: "Generative object removal",
    free: "5 / month",
    pro: "Up to 200",
    max: "Up to 2,000",
    ent: "Custom",
  },
  { feature: "Platform size presets (fit-and-pad)", free: true, pro: true, max: true, ent: true },
  // ---- roadmap：尚在实现中，不对外承诺 ----
  // 以下三项此前写在对比表里，但代码里没有任何实现（无 API key 体系 / 无 SSO / 无 Shopify 对接）。
  // 卖出去了却交付不了 = 合同风险，所以从承诺里移出，实现后再加回本表 + entitlements.ts。
  // { feature: "API access + outbound webhooks", max: true, ent: true },
  // { feature: "SSO / SAML & audit logs", ent: true },
  // { feature: "Shopify / marketplace integration", max: true, ent: true },
  // ---- performance & support ----
  { feature: "Enterprise SLA", free: false, pro: false, max: false, ent: true },
  { feature: "Support", free: "Community", pro: "Priority", max: "Priority", ent: "Dedicated" },
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true) {
    return (
      <span className="cmp-yes">
        <svg
          role="img"
          aria-label="included"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="cmp-no">
        <svg
          role="img"
          aria-label="not included"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    );
  }
  return <span className="cmp-txt">{v}</span>;
}

export default function PricingPage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link href="/" className="logo" aria-label="Surepix home">
            <span className="logo-mark" aria-hidden="true">
              S
            </span>
            Surepix
          </Link>
          <nav className="nav-links nav-links-desktop" aria-label="Main navigation">
            <Link href="/#capabilities">Features</Link>
            <Link href="/#fidelity">Why verified</Link>
            <Link href="/#faq">FAQ</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/demo" className="btn btn-brand btn-sm">
              Try the demo
            </Link>
          </nav>
          <MobileNav />
        </div>
      </header>

      <section className="price-hero">
        <div className="wrap">
          <h1>Verified editing, priced per catalogue</h1>
          <p>
            Deterministic edits — white background, colour, resize, watermark — are never metered,
            on any plan. Only generative edits use AI credits. Switch to yearly and save up to 21%.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <PricingPlans />
          <p className="pricing-note">
            All paid plans include a 14-day free trial — no credit card required. Cancel anytime.
            Payments processed securely by{" "}
            <a href="https://creem.io" target="_blank" rel="noopener noreferrer">
              Creem
            </a>
            , with tax compliance handled automatically.
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">How we compare</div>
            <h2>How we compare</h2>
            <p>
              List prices from public pricing pages (October 2026, USD), all shown as
              <b> per-month billed yearly</b> so the numbers are apples to apples. Photoroom caps
              exports hard at 1,000–3,000/month; Surepix publishes generous limits (5,000 / 15,000
              edits &amp; exports) and verifies fidelity on every image.
            </p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="fid-table" style={{ fontSize: 14, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: "22%" }}>Tool</th>
                  <th>Monthly</th>
                  <th>Billed yearly</th>
                  <th>What&apos;s capped</th>
                  <th>≈ per image</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "var(--ink)" }}>
                    Surepix Pro
                  </td>
                  <td>$9</td>
                  <td>
                    <b>$7.50</b>
                  </td>
                  <td>5,000 edits &amp; 5,000 exports / month (5× Photoroom)</td>
                  <td>
                    <b>~$0</b> core
                  </td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>Photoroom Pro</td>
                  <td>$12.99</td>
                  <td>
                    <b>$7.50</b>
                  </td>
                  <td>8,000 AI credits + 1,000 exports / month</td>
                  <td>~$0.008</td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>Photoroom Max</td>
                  <td>$34.99</td>
                  <td>
                    <b>$20.99</b>
                  </td>
                  <td>25,000 AI credits + 3,000 exports / month</td>
                  <td>~$0.007</td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>remove.bg (Canva)</td>
                  <td>$9</td>
                  <td>—</td>
                  <td>40 credits / month (closing Dec 2026)</td>
                  <td>~$0.23</td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>Canva Pro</td>
                  <td>$15</td>
                  <td>—</td>
                  <td>Credit-capped background remover</td>
                  <td>varies</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">Compare our plans</div>
            <h2>What&apos;s in each plan</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="fid-table" style={{ fontSize: 14, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>Feature</th>
                  <th>Free</th>
                  <th>Pro</th>
                  <th>Max</th>
                  <th>Enterprise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.feature}>
                    <td style={{ fontFamily: "var(--sans)", fontWeight: 600, color: "var(--ink)" }}>
                      {row.feature}
                    </td>
                    <td>
                      <Cell v={row.free} />
                    </td>
                    <td>
                      <Cell v={row.pro} />
                    </td>
                    <td>
                      <Cell v={row.max} />
                    </td>
                    <td>
                      <Cell v={row.ent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap">
          <div className="footer-bottom" style={{ borderTop: "none", paddingTop: 0 }}>
            <span>© {new Date().getFullYear()} Surepix. All rights reserved.</span>
            <span>
              Editing engine:{" "}
              <a
                href="https://github.com/storytold/photocraft"
                target="_blank"
                rel="noopener noreferrer"
              >
                PhotoCraft
              </a>{" "}
              (MIT OR Apache-2.0)
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
