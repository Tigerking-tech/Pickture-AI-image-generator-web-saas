import type { Metadata } from "next";
import Link from "next/link";
import { PricingPlans } from "@/components/pricing-plans";
import { MobileNav } from "@/components/MobileNav";

export const metadata: Metadata = {
  title: "Pricing — Verified Product-Photo Editing",
  description:
    "Surepix pricing: start free with 50 verified edits per month. Pro is $9/month for 5,000 edits with PSD masters; Scale is $24/month with API access. Every plan includes per-element fidelity verification.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Surepix pricing — verified editing from $0",
    description:
      "Free tier with fidelity verification included. Pro $9/month, Scale $24/month. 14-day trial, cancel anytime.",
    type: "website",
  },
};

const COMPARISON = [
  { feature: "Deterministic edits (~40ms)", free: true, pro: true, scale: true },
  { feature: "Per-element fidelity verification", free: true, pro: true, scale: true },
  { feature: "Edits per month", free: "50", pro: "5,000", scale: "Unlimited" },
  { feature: "Watermark on exports", free: "Surepix mark", pro: "None", scale: "None" },
  { feature: "Batch processing", free: false, pro: true, scale: true },
  { feature: "Editable PSD masters", free: false, pro: true, scale: true },
  { feature: "Brand-kit manifests", free: false, pro: true, scale: true },
  { feature: "API access + webhooks", free: false, pro: false, scale: true },
  { feature: "Custom platform presets", free: false, pro: false, scale: true },
  { feature: "SSO & audit logs", free: false, pro: false, scale: true },
  { feature: "Support", free: "Community", pro: "Priority", scale: "Dedicated" },
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true) {
    return (
      <span className="cmp-yes" aria-label="included">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (v === false) {
    return (
      <span className="cmp-no" aria-label="not included">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
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
            <span className="logo-mark" aria-hidden="true">S</span>
            Surepix
          </Link>
          <nav className="nav-links nav-links-desktop" aria-label="Main navigation">
            <Link href="/#capabilities">Features</Link>
            <Link href="/#fidelity">Why verified</Link>
            <Link href="/#faq">FAQ</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/demo" className="btn btn-brand btn-sm">Try the demo</Link>
          </nav>
          <MobileNav />
        </div>
      </header>

      <section className="price-hero">
        <div className="wrap">
          <h1>Verified editing, priced per catalogue</h1>
          <p>
            Start free with 50 verified edits a month. Upgrade when your catalogue grows —
            every plan includes per-element fidelity verification, because quality control
            is not an upsell.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <PricingPlans />
          <p className="pricing-note">
            All paid plans include a 14-day free trial — no credit card required. Cancel anytime.
            Payments processed securely by{" "}
            <a href="https://creem.io" target="_blank" rel="noopener noreferrer">Creem</a>,
            with tax compliance handled automatically.
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <div className="kicker">How we compare</div>
            <h2>Same shelf as the big names, priced to actually scale</h2>
            <p>
              List prices from public pricing pages (October 2026). Competitor plans are
              credit- or export-capped; Surepix counts verified edits and includes fidelity
              checks on every one of them.
            </p>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="fid-table" style={{ fontSize: 14, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ width: "24%" }}>Tool</th>
                  <th>Monthly price</th>
                  <th>Included volume</th>
                  <th>≈ per image</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 700, color: "var(--ink)" }}>
                    Surepix Pro
                  </td>
                  <td><b>$9</b></td>
                  <td>5,000 verified edits + PSD masters</td>
                  <td><b style={{ color: "var(--brand, #16a34a)" }}>~$0.002</b></td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>Photoroom Pro</td>
                  <td>$12.99</td>
                  <td>~1,000 exports / month (credit-capped)</td>
                  <td>~$0.013</td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>remove.bg (Canva)</td>
                  <td>$9</td>
                  <td>40 credits / month</td>
                  <td>~$0.23</td>
                </tr>
                <tr>
                  <td style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>Canva Pro</td>
                  <td>$15</td>
                  <td>Design suite, background remover credit-capped</td>
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
            <div className="kicker">Compare plans</div>
            <h2>What&apos;s in each plan</h2>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="fid-table" style={{ fontSize: 14, minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ width: "44%" }}>Feature</th>
                  <th>Free</th>
                  <th>Pro</th>
                  <th>Scale</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.feature}>
                    <td style={{ fontFamily: "var(--sans)", fontWeight: 600, color: "var(--ink)" }}>{row.feature}</td>
                    <td><Cell v={row.free} /></td>
                    <td><Cell v={row.pro} /></td>
                    <td><Cell v={row.scale} /></td>
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
              Editing engine: <a href="https://github.com/storytold/photocraft" target="_blank" rel="noopener noreferrer">PhotoCraft</a> (MIT OR Apache-2.0)
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
