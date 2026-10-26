import Link from "next/link";
import { Reveal } from "./Reveal";
import { MobileNav } from "./MobileNav";
import { BeforeAfter } from "./BeforeAfter";
import { CapTabs } from "./CapTabs";

/* ============================================================
   落地页 v4 — 对标 Photoroom / Pixelcut / Claid 的去 AI 味重构：
   · 短标题、少解释；黑 pill 主 CTA；无 eyebrow / 渐变高亮 / 指标大字
   · 首屏即真实产品：可拖动的 before/after 对比滑块（真实管线输出）
   · 能力区为 tab 交互；对比区为单张表格；编号块与信任区保留（竞品同款）
   ============================================================ */

const HERO_NOTE = "6/6 elements PASS · MS-SSIM ≥ 0.989 · recipe warm_up";

const STEPS = [
  {
    n: "01",
    t: "Upload your SKUs",
    d: "Drop in product photos or connect your catalogue. Logos, labels and price tags are mapped into a protection manifest automatically.",
  },
  {
    n: "02",
    t: "Describe the edit",
    d: "“Warm it up, then resize to 800×800.” Deterministic edits run in ~40ms; only true semantic changes go to a generative model.",
  },
  {
    n: "03",
    t: "Get verified output",
    d: "Every image passes a per-element fidelity check before delivery. Anything that can't be verified is repaired or escalated — never silently shipped.",
  },
];

const SHOWCASE = [
  {
    id: "serum",
    title: "Amber serum bottles",
    desc: "Warm grade on glass and background — label regions re-measured after the edit, not repainted.",
    metrics: ["6/6 PASS", "SSIM ≥ 0.989", "edge recall ≥ 0.991"],
  },
  {
    id: "phones",
    title: "Wireless earbuds",
    desc: "Background knocked out to pure marketplace white — the product itself is untouched, pixel for pixel.",
    metrics: ["6/6 PASS", "pure white bg", "product fidelity 1.000"],
  },
  {
    id: "coffee",
    title: "Coffee beans",
    desc: "Resized to a marketplace preset with fit-and-pad — the full product stays in frame, nothing cropped away.",
    metrics: ["6/6 PASS", "fit + pad", "no content loss"],
  },
];

const VS_ROWS = [
  ["Speed", "~4,000ms per image", "~40ms per edit"],
  ["Brand assets", "~1 in 5 logos and text elements come back warped", "Verified element-by-element before delivery"],
  ["Repeatability", "Non-deterministic — same prompt, different result", "Deterministic — same recipe, same output"],
  ["Audit trail", "No record of what changed", "Every edit is an auditable, re-runnable command chain"],
];

const TRUST = [
  {
    t: "No training on your images",
    d: "Deterministic edits never leave the pipeline. Uploads are processed and discarded.",
  },
  {
    t: "GDPR-friendly by design",
    d: "No customer imagery is retained after processing unless you explicitly save it to your brand kit.",
  },
  {
    t: "Auditable by default",
    d: "Every edit ships with its command chain and quality report — reviewable by your team or your auditor.",
  },
  {
    t: "Open-source engine",
    d: "Editing engine is PhotoCraft (MIT OR Apache-2.0). Verification and routing layers are Surepix proprietary.",
  },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    per: "/month",
    features: ["50 edits / month", "Fidelity verification included", "PNG + JPG export", "Surepix watermark on exports", "Community support"],
    cta: "Start free",
    hot: false,
    href: "/signup",
  },
  {
    name: "Pro",
    price: "$9",
    per: "/month",
    features: ["5,000 edits / month", "No watermark", "Batch processing (full catalogue)", "Editable PSD master files", "Brand-kit manifests", "Priority support"],
    cta: "Start 14-day trial",
    hot: true,
    href: "/pricing",
  },
  {
    name: "Scale",
    price: "$24",
    per: "/month",
    features: ["Unlimited edits", "API access + webhooks", "Custom platform presets (Amazon, Zalando…)", "SSO & audit logs", "Dedicated support"],
    cta: "Start 14-day trial",
    hot: false,
    href: "/pricing",
  },
];

const FAQS = [
  {
    q: "How is this different from AI image generators?",
    a: "Generative models repaint your product from scratch — fast, but they reimagine your logo and pricing text. Surepix treats colour, crop, resize and watermark as deterministic recipes, and verifies your brand assets element-by-element before anything ships. Generative models are used only where genuinely needed, like background replacement.",
  },
  {
    q: "What does fidelity verification check?",
    a: "For every protected element — logo, packaging text, price tag — we compute four metrics against the original: pixel error (MAE), MS-SSIM, edge recall (±2px tolerance) and contrast retention. The verdict is three-level: PASS, REPAIR (gentler retry, free), or REGENERATE (escalate on the damaged region only).",
  },
  {
    q: "How fast is batch processing?",
    a: "Roughly 40ms per edit plus ~6ms verification — a 100-SKU catalogue re-edit typically finishes in under three seconds, each image with the same per-element quality report.",
  },
  {
    q: "Do you train models on our images?",
    a: "No. Uploads are processed and discarded, never used for training.",
  },
  {
    q: "Which formats are supported?",
    a: "PNG and JPG for input and delivery. Layered output is available as PSD, so text layers stay editable in Photoshop or Affinity.",
  },
];

export default function Landing() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <>
      {/* ---------- 导航 ---------- */}
      <header className="nav">
        <div className="wrap nav-inner">
          <Link href="/" className="logo" aria-label="Surepix home">
            <span className="logo-mark" aria-hidden="true">S</span>
            Surepix
          </Link>
          <nav className="nav-links nav-links-desktop" aria-label="Main navigation">
            <Link href="/#capabilities">Features</Link>
            <Link href="/#fidelity">Why verified</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#faq">FAQ</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/demo" className="btn btn-brand btn-sm">Try the demo</Link>
          </nav>
          <MobileNav />
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="hero">
          <div className="wrap hero-grid">
            <Reveal>
              <h1>Product photos that stay true.</h1>
              <p className="lead">
                White background, colour, resize, watermark — deterministic
                edits in ~40ms, with every logo, label and price tag verified
                against the original before delivery.
              </p>
              <div className="hero-cta">
                <Link href="/signup" className="btn btn-brand">Start editing free</Link>
                <Link href="/demo" className="btn btn-ghost">Try the live demo</Link>
              </div>
              <div className="hero-meta">
                <span><b>~40ms</b> per edit</span>
                <span><b>100 SKUs</b> in under 3s</span>
                <span><b>0</b> images used for training</span>
              </div>
            </Reveal>
            <Reveal delay={120} className="hero-visual">
              <div className="hero-shot">
                <div className="hero-shot-bar" aria-hidden="true">
                  <i /><i /><i />
                  <span>surepix · warm_up recipe</span>
                </div>
                <BeforeAfter
                  before="/samples/serum.png"
                  after="/showcase/serum-after.png"
                  altBefore="Amber serum bottles — original upload"
                  altAfter="Amber serum bottles — edited by Surepix, verified"
                  initial={52}
                />
                <div className="hero-note">
                  <span><b>PASS</b> fidelity report · serum</span>
                  <span>{HERO_NOTE}</span>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------- 平台条 ---------- */}
        <section className="platforms">
          <div className="wrap platforms-inner">
            <span className="platforms-label">Export presets for</span>
            <span className="platform-chip">Amazon</span>
            <span className="platform-chip">Shopify</span>
            <span className="platform-chip">eBay</span>
            <span className="platform-chip">Etsy</span>
            <span className="platform-chip">Zalando</span>
            <span className="platform-chip">TikTok Shop</span>
          </div>
        </section>

        {/* ---------- 能力 tab 切换 ---------- */}
        <section className="section" id="capabilities">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">What it does</div>
              <h2>One workspace for every product-photo edit</h2>
              <p>White background, colour, crop, resize, watermark — executed as deterministic recipes and verified before delivery.</p>
            </Reveal>
            <Reveal delay={90}>
              <CapTabs />
            </Reveal>
          </div>
        </section>

        {/* ---------- 保真展示（可拖动 before/after） ---------- */}
        <section className="section alt" id="fidelity">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">Why verified</div>
              <h2>Every texture, label and logo preserved</h2>
              <p>
                The category&apos;s shared weakness is packaging text and logos:
                generative tools repaint them and hope. Surepix measures them instead.
                Drag the sliders.
              </p>
            </Reveal>
            <div className="showcase">
              {SHOWCASE.map((s, i) => (
                <Reveal key={s.id} delay={i * 90}>
                  <article className="show-item">
                    <BeforeAfter
                      before={`/samples/${s.id}.png`}
                      after={`/showcase/${s.id}-after.png`}
                      altBefore={`${s.title} — original`}
                      altAfter={`${s.title} — verified edit`}
                      initial={50}
                    />
                    <div className="show-body">
                      <h3>{s.title}</h3>
                      <p>{s.desc}</p>
                      <div className="show-metrics">
                        {s.metrics.map((m) => <span key={m}>{m}</span>)}
                      </div>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 编号特性块 ---------- */}
        <section className="section">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">How it works</div>
              <h2>Three steps from upload to verified delivery</h2>
            </Reveal>
            <div className="feat-grid" id="how-it-works">
              {STEPS.map((f, i) => (
                <Reveal key={f.n} delay={i * 90}>
                  <article className="feat">
                    <div className="feat-num">{f.n}</div>
                    <h3>{f.t}</h3>
                    <p>{f.d}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 对比表 ---------- */}
        <section className="section alt" id="compare">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">Why deterministic</div>
              <h2>Generative tools vs. a verified pipeline</h2>
              <p>
                Generative models are powerful — but they repaint pixels you need
                preserved. Surepix reserves generation for genuinely semantic work.
              </p>
            </Reveal>
            <Reveal delay={90}>
              <div className="vsx">
                <div className="vsx-row vsx-head">
                  <div />
                  <div className="muted">Generative editing</div>
                  <div>Surepix</div>
                </div>
                {VS_ROWS.map(([crit, bad, good]) => (
                  <div className="vsx-row" key={crit}>
                    <div className="vsx-crit">{crit}</div>
                    <div className="vsx-bad">{bad}</div>
                    <div className="vsx-good">{good}</div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------- 保真承诺（深色块） ---------- */}
        <section className="section">
          <div className="wrap">
            <Reveal>
              <div className="guarantee">
                <div>
                  <div className="kicker">The Surepix guarantee</div>
                  <h2>Edits that stay true to the product — or they don&apos;t ship.</h2>
                  <p>
                    Every protected element passes four fidelity metrics before delivery.
                    If an edit can&apos;t be verified, it is repaired with gentler
                    parameters or escalated — never silently shipped with a warped logo.
                  </p>
                </div>
                <div className="guarantee-stats">
                  <div className="gstat">
                    <div className="v">PASS · REPAIR · REGENERATE</div>
                    <div className="k">three-level verdict on every element, every edit</div>
                  </div>
                  <div className="gstat">
                    <div className="v">±2px edge tolerance</div>
                    <div className="k">logos and text measured against the original</div>
                  </div>
                  <div className="gstat">
                    <div className="v">100% reversible</div>
                    <div className="k">deterministic recipes — every edit is re-runnable</div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------- 信任区 ---------- */}
        <section className="section alt">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">Trust &amp; data</div>
              <h2>Built for teams that answer to auditors</h2>
            </Reveal>
            <div className="trust-grid">
              {TRUST.map((t, i) => (
                <Reveal key={t.t} delay={i * 80}>
                  <div className="trust">
                    <h4>{t.t}</h4>
                    <p>{t.d}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 定价 ---------- */}
        <section className="section" id="pricing">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">Pricing</div>
              <h2>Start free. Scale when your catalogue does.</h2>
              <p>Every plan includes fidelity verification — quality control is not an upsell.</p>
            </Reveal>
            <div className="plans">
              {PLANS.map((p, i) => (
                <Reveal key={p.name} delay={i * 90}>
                  <div className={`plan${p.hot ? " hot" : ""}`}>
                    {p.hot && <span className="tag">Popular</span>}
                    <h3>{p.name}</h3>
                    <div className="price">{p.price}<span>{p.per}</span></div>
                    <ul>
                      {p.features.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                    <Link href={p.href} className={`btn ${p.hot ? "btn-brand" : "btn-ghost"}`}>{p.cta}</Link>
                  </div>
                </Reveal>
              ))}
            </div>
            <p className="pricing-note">
              Paid plans include a 14-day free trial — no credit card required.{" "}
              <Link href="/pricing">See full plan details →</Link>
            </p>
          </div>
        </section>

        {/* ---------- FAQ ---------- */}
        <section className="section alt" id="faq">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">FAQ</div>
              <h2>Frequently asked questions</h2>
            </Reveal>
            <Reveal className="faq">
              {FAQS.map((f) => (
                <details key={f.q}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </Reveal>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
          </div>
        </section>
      </main>

      {/* ---------- Footer ---------- */}
      <footer className="footer">
        <div className="wrap">
          <div className="footer-grid">
            <div>
              <Link href="/" className="logo" style={{ marginBottom: 14 }}>
                <span className="logo-mark" aria-hidden="true">S</span>
                Surepix
              </Link>
              <p style={{ maxWidth: "34em", margin: "0 0 10px" }}>
                Deterministic product-photo editing with built-in fidelity verification.
                Built for e-commerce teams who care about brand consistency.
              </p>
              <p style={{ margin: 0, fontSize: 12.5 }}>
                Editing engine: <a href="https://github.com/storytold/photocraft" rel="noopener noreferrer" target="_blank">PhotoCraft</a> (MIT OR Apache-2.0).
                Quality-control and routing algorithms are Surepix proprietary.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <ul>
                <li><Link href="/demo">Live demo</Link></li>
                <li><Link href="/#how-it-works">How it works</Link></li>
                <li><Link href="/#pricing">Pricing</Link></li>
              </ul>
            </div>
            <div>
              <h4>Legal</h4>
              <ul>
                <li><Link href="/#faq">Privacy &amp; data</Link></li>
                <li><Link href="/#faq">Terms</Link></li>
                <li><a href="https://github.com/storytold/photocraft" target="_blank" rel="noopener noreferrer">Engine license</a></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Surepix. All rights reserved.</span>
            <span>Made for the US &amp; EU e-commerce market · GDPR-friendly</span>
          </div>
        </div>
      </footer>
    </>
  );
}
