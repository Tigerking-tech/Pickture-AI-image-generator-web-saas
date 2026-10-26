"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * 定价卡片 — 版式对标 Photoroom /pricing：
 *   月付↔年付切换 → 卡片(名称/卖点/删除线原价+年付价/credits·exports 行/✅✕特性列表/CTA)
 *   计量口径：确定性编辑与导出不计量（对标 Photoroom 的 "Unlimited core tools"），
 *   只对生成式编辑收 credits。
 */

interface Plan {
  name: string;
  monthly: string;
  yearly: string;
  credits: string;
  blurb: string;
  feats: { t: string; on: boolean }[];
  cta: string;
  productId?: string;
  popular?: boolean;
}

const PLANS: Plan[] = [
  {
    name: "Free",
    monthly: "$0",
    yearly: "$0",
    credits: "5 AI credits • 50 exports",
    blurb: "Try the verified pipeline on your own photos.",
    feats: [
      { t: "Unlimited core tools", on: true },
      { t: "Fidelity verification included", on: true },
      { t: "PNG + JPG export", on: true },
      { t: "Batch processing", on: false },
      { t: "Editable PSD masters", on: false },
      { t: "Surepix watermark on exports", on: true },
    ],
    cta: "Start free",
  },
  {
    name: "Pro",
    monthly: "$9",
    yearly: "$7.50",
    credits: "200 AI credits • unlimited exports",
    blurb: "For growing catalogues that need brand-consistent output.",
    feats: [
      { t: "Unlimited deterministic edits", on: true },
      { t: "Batch processing (full catalogue)", on: true },
      { t: "Editable PSD master files", on: true },
      { t: "Brand-kit manifests", on: true },
      { t: "API access + webhooks", on: false },
      { t: "Priority support", on: true },
    ],
    productId: process.env.NEXT_PUBLIC_CREEM_PRO_PRODUCT_ID ?? "prod_pro",
    cta: "Start 14-day trial",
  },
  {
    name: "Max",
    monthly: "$24",
    yearly: "$19",
    credits: "2,000 AI credits • unlimited exports",
    blurb: "For teams integrating verified editing into their own stack.",
    feats: [
      { t: "Unlimited deterministic edits", on: true },
      { t: "Batch processing (full catalogue)", on: true },
      { t: "Editable PSD master files", on: true },
      { t: "API access + webhooks", on: true },
      { t: "Custom platform presets (Amazon, Zalando…)", on: true },
      { t: "SSO & audit logs", on: false },
    ],
    productId: process.env.NEXT_PUBLIC_CREEM_SCALE_PRODUCT_ID ?? "prod_scale",
    popular: true,
    cta: "Start 14-day trial",
  },
  {
    name: "Enterprise",
    monthly: "Custom",
    yearly: "Custom",
    credits: "Unlimited volume • dedicated capacity",
    blurb: "Enterprise-grade security, SLA and onboarding.",
    feats: [
      { t: "Everything in Max", on: true },
      { t: "SSO / SAML + audit logs", on: true },
      { t: "Enterprise SLA & dedicated onboarding", on: true },
      { t: "Custom recipes for your catalogue", on: true },
      { t: "Invoice & procurement support", on: true },
      { t: "Dedicated support channel", on: true },
    ],
    cta: "Contact sales",
  },
];

function CheckoutButton({ plan }: { plan: Plan }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    if (!plan.productId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: plan.productId }),
        redirect: "manual",
      });
      // demo mode：服务端 307 重定向到 /dashboard?checkout=success
      if (res.type === "opaqueredirect" || res.status === 0) {
        window.location.href = "/dashboard?checkout=success";
        return;
      }
      const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.error === "Unauthorized") {
        window.location.href = "/login";
      } else {
        setError(data?.error ?? "checkout unavailable — please try again");
      }
    } catch {
      setError("network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (!plan.productId) {
    const href = plan.name === "Enterprise" ? "/signup?plan=enterprise" : "/signup";
    return (
      <Link href={href} className={`btn ${plan.popular ? "btn-brand" : "btn-ghost"}`}>
        {plan.cta}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`btn ${plan.popular ? "btn-brand" : "btn-ghost"}`}
        onClick={handleCheckout}
        disabled={loading}
      >
        {loading ? "Redirecting…" : plan.cta}
      </button>
      {error && (
        <p style={{ color: "var(--bad)", fontSize: 12.5, margin: "10px 0 0" }}>{error}</p>
      )}
    </>
  );
}

export function PricingPlans() {
  const [yearly, setYearly] = useState(true);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div className="plan-toggle" role="group" aria-label="Billing period">
          <button className={yearly ? "" : "on"} onClick={() => setYearly(false)}>
            Monthly
          </button>
          <button className={yearly ? "on" : ""} onClick={() => setYearly(true)}>
            Yearly
          </button>
          <span className="save">Save up to 21%</span>
        </div>
      </div>

      <div className="plans">
        {PLANS.map((p) => (
          <div className={`plan${p.popular ? " hot" : ""}`} key={p.name}>
            {p.popular && <span className="tag">Most popular</span>}
            <h3>{p.name}</h3>
            <p className="plan-blurb">{p.blurb}</p>
            {p.monthly === "Custom" ? (
              <div className="price" style={{ fontSize: 34 }}>
                Custom
              </div>
            ) : (
              <>
                <div className="price">
                  {yearly && p.monthly !== p.yearly && (
                    <span className="plan-strike">{p.monthly}</span>
                  )}
                  {yearly ? p.yearly : p.monthly}
                  <span>/month</span>
                </div>
                <div className="plan-billed">
                  {yearly ? "Per month, billed yearly" : "Per month, billed monthly"}
                </div>
              </>
            )}
            <div className="plan-credits">{p.credits}</div>
            <ul className="plan-feats">
              {p.feats.map((f) => (
                <li key={f.t} className={f.on ? "" : "no"}>
                  <span className="mk" aria-hidden="true">
                    {f.on ? "✓" : "✕"}
                  </span>
                  <span>{f.t}</span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: "auto" }}>
              <CheckoutButton plan={p} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
