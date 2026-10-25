"use client";

import { useState } from "react";
import Link from "next/link";

interface Plan {
  name: string;
  price: string;
  period: string;
  productId?: string;
  popular?: boolean;
  blurb: string;
  features: string[];
  cta: string;
}

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "$0",
    period: "month",
    blurb: "For trying the verified pipeline on real photos.",
    features: [
      "50 edits / month",
      "Fidelity verification included",
      "PNG + JPG export",
      "Surepix watermark on exports",
      "Community support",
    ],
    cta: "Start free",
  },
  {
    name: "Pro",
    price: "$12",
    period: "month",
    productId: process.env.NEXT_PUBLIC_CREEM_PRO_PRODUCT_ID ?? "prod_pro",
    popular: true,
    blurb: "For growing catalogues that need brand-consistent output.",
    features: [
      "5,000 edits / month",
      "No watermark",
      "Batch processing (full catalogue)",
      "Editable PSD master files",
      "Brand-kit manifests",
      "Priority support",
    ],
    cta: "Start 14-day trial",
  },
  {
    name: "Scale",
    price: "$29",
    period: "month",
    productId: process.env.NEXT_PUBLIC_CREEM_SCALE_PRODUCT_ID ?? "prod_scale",
    blurb: "For teams integrating verified editing into their own stack.",
    features: [
      "Unlimited edits",
      "API access + webhooks",
      "Custom platform presets (Amazon, Zalando…)",
      "SSO & audit logs",
      "Dedicated support",
    ],
    cta: "Start 14-day trial",
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
    return (
      <Link href="/signup" className={`btn ${plan.popular ? "btn-brand" : "btn-ghost"}`}>
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
  return (
    <div className="plans">
      {PLANS.map((p) => (
        <div className={`plan${p.popular ? " hot" : ""}`} key={p.name}>
          {p.popular && <span className="tag">Most popular</span>}
          <h3>{p.name}</h3>
          <div className="price">{p.price}<span>/{p.period}</span></div>
          <p className="plan-blurb">{p.blurb}</p>
          <ul>
            {p.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <CheckoutButton plan={p} />
        </div>
      ))}
    </div>
  );
}
