import Link from "next/link";
import { Reveal } from "./Reveal";
import { MobileNav } from "./MobileNav";

/* ============================================================
   Hero 右侧：真实管线输出图 + 保真报告浮层
   图片为 public/showcase/serum-after.png（本地确定性管线 warm_up 真实输出）
   指标为 verify() 对该图的真实逐元素校验结果
   ============================================================ */
const HERO_ELEMENTS = [
  { name: "brand_logo", ssim: "0.989" },
  { name: "product_label", ssim: "0.992" },
  { name: "product_logo", ssim: "0.996" },
  { name: "price_tag", ssim: "0.997" },
  { name: "text_small", ssim: "0.994" },
  { name: "product_body", ssim: "0.993" },
];

const SHOWCASE = [
  {
    id: "serum",
    title: "Vitamin C serum",
    desc: "Warm grade on the bottle and background — label, brand logo and price tag verified untouched.",
    metrics: ["6/6 elements PASS", "MS-SSIM ≥ 0.989", "edge recall ≥ 0.991"],
  },
  {
    id: "phones",
    title: "Wireless earbuds",
    desc: "Warm grade plus crop to platform preset — every glyph region re-measured, not repainted.",
    metrics: ["6/6 elements PASS", "MS-SSIM ≥ 0.989", "edge recall ≥ 0.987"],
  },
  {
    id: "coffee",
    title: "Coffee beans",
    desc: "Warm grade on packaging — brand colours survive the edit, edges stay inside ±2px tolerance.",
    metrics: ["6/6 elements PASS", "MS-SSIM ≥ 0.989", "edge recall 1.000"],
  },
];

const STEPS = [
  {
    n: 1,
    t: "Upload your SKUs",
    d: "Drop in product photos — or connect your catalogue. We map your brand assets (logos, labels, price tags) into a protection manifest automatically.",
  },
  {
    n: 2,
    t: "Describe the edit",
    d: "\u201CWarm it up, then resize to 800×800.\u201D Surepix routes each request: deterministic edits run locally in ~40ms; only true semantic changes go to a generative model.",
  },
  {
    n: 3,
    t: "Get verified output",
    d: "Every image passes a per-element fidelity check before delivery. Logos and text that would warp are flagged and repaired — or the edit is escalated, never silently shipped.",
  },
];

const CAPS = [
  {
    t: "Colour & light",
    d: "Warmth, brightness, contrast and saturation as deterministic curve recipes — the same input always gives the same output, down to the pixel.",
    tag: "verified per element",
  },
  {
    t: "Crop & resize",
    d: "Platform presets for Amazon, Shopify, Zalando and more. Fit-and-pad with no crop, so nothing important ever falls out of frame.",
    tag: "800×800 in 38ms",
  },
  {
    t: "Brand & text",
    d: "Watermarks and promo tags as real editable PSD text layers — adjustable after export in Photoshop or Affinity, never flattened into pixels.",
    tag: "editable PSD masters",
  },
];

const FEATURES = [
  {
    n: "01",
    t: "Deterministic recipes",
    d: "Every edit compiles to an auditable command chain — re-runnable, reversible, versionable. Same photo plus same recipe always equals same result, on every run and every machine.",
  },
  {
    n: "02",
    t: "Per-element verification",
    d: "Four metrics — pixel error, MS-SSIM, edge recall, contrast retention — computed per protected element against the original, with a three-level verdict: PASS, REPAIR, REGENERATE.",
  },
  {
    n: "03",
    t: "Batch at catalogue scale",
    d: "~40ms per edit plus ~6ms verification. A 100-SKU re-edit finishes in under three seconds — with the same per-element quality report for every single image.",
  },
];

const VS_AI = [
  { bad: true, t: "~4,000ms per image (and waiting)" },
  { bad: true, t: "~1 in 5 logos and text elements come back warped" },
  { bad: true, t: "Non-deterministic: same prompt, different result" },
  { bad: true, t: "No audit trail of what changed" },
];

const VS_SUREPIX = [
  { good: true, t: "~40ms per image — 100× faster" },
  { good: true, t: "Logos, labels and text verified element-by-element before delivery" },
  { good: true, t: "Deterministic and reversible — the same recipe always gives the same result" },
  { good: true, t: "Every edit is an auditable, re-runnable command chain" },
];

const TRUST = [
  {
    t: "No training on your images",
    d: "Deterministic edits never leave the pipeline. Uploads are processed and discarded — never used for training.",
  },
  {
    t: "GDPR-friendly by design",
    d: "No customer imagery is retained after processing unless you explicitly save it to your brand kit.",
  },
  {
    t: "Auditable by default",
    d: "Every edit ships with its command chain and quality report — reviewable by your team, or your auditor.",
  },
  {
    t: "Open-source engine",
    d: "The editing engine is PhotoCraft (MIT OR Apache-2.0). Verification and routing layers are Surepix proprietary.",
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
    price: "$12",
    per: "/month",
    features: ["5,000 edits / month", "No watermark", "Batch processing (full catalogue)", "Editable PSD master files", "Brand-kit manifests", "Priority support"],
    cta: "Start 14-day trial",
    hot: true,
    href: "/pricing",
  },
  {
    name: "Scale",
    price: "$29",
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
    a: "Generative models repaint your product from scratch — fast, but they reimagine your logo and pricing text, and you cannot predict the result. Surepix treats colour, crop, resize and watermark as deterministic recipes: the same input always yields the same output, edits are reversible, and a fidelity check verifies your brand assets element-by-element before anything ships. We use generative models only where they are genuinely needed — semantic changes like background replacement.",
  },
  {
    q: "What does \u201Cfidelity verification\u201D actually check?",
    a: "For every protected element — your logo, packaging text, price tag — we compute four metrics against the original: pixel error (MAE), multi-scale structural similarity (MS-SSIM), edge recall (Sobel edges with a ±2px tolerance) and contrast retention, with thresholds tuned per element type. The result is a three-level verdict: PASS (ship it), REPAIR (retry with gentler parameters, still free), or REGENERATE (structural damage — escalate to a generative model on that region only).",
  },
  {
    q: "How fast is batch processing?",
    a: "Deterministic edits run at roughly 40ms per image, plus ~6ms for the fidelity check — about 26ms per image amortised in batch mode. A 100-SKU catalogue re-edit typically completes in under three seconds. The same operation on a generative pipeline would take minutes and still require manual review.",
  },
  {
    q: "Do you train models on our images?",
    a: "No. Deterministic edits never leave the editing pipeline, and uploaded images are processed and discarded — they are not used for training. Surepix is GDPR-friendly by design: no customer imagery is retained after processing unless you explicitly save it to your brand kit.",
  },
  {
    q: "Which formats are supported?",
    a: "PNG and JPG for input and delivery. Editable layered output is available as PSD, so your team can keep adjusting text layers (watermarks, promo tags) in Photoshop or Affinity after the fact.",
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
              <span className="eyebrow">Deterministic editing · verified fidelity</span>
              <h1>
                Product photos that <span className="grad">stay true</span> — every pixel, verified.
              </h1>
              <p className="lead">
                AI repaints your logo and warps your price tags. Surepix edits product photos
                deterministically in ~40ms — colour, crop, resize, watermark — and verifies every
                element against your brand assets before delivery.
              </p>
              <div className="hero-cta">
                <Link href="/demo" className="btn btn-brand">Try the live demo →</Link>
                <Link href="/#how-it-works" className="btn btn-ghost">See how it works</Link>
              </div>
              <div className="hero-meta">
                <span><b>~40ms</b> per edit</span>
                <span><b>100×</b> faster than regeneration</span>
                <span><b>100 SKUs</b> in under 3 seconds</span>
                <span><b>0</b> images used for training</span>
              </div>
            </Reveal>
            <Reveal delay={120} className="hero-visual">
              <div className="hero-img">
                <img
                  src="/showcase/serum-after.png"
                  alt="Vitamin C serum product photo edited by Surepix with verified brand assets"
                  width={1200}
                  height={900}
                />
                <span className="img-tag">Verified output</span>
              </div>
              <div className="hero-report">
                <div className="hero-report-head">
                  <span>fidelity report · serum</span>
                  <span className="verdict">PASS</span>
                </div>
                {HERO_ELEMENTS.map((el) => (
                  <div className="pill ok" key={el.name}>
                    <span>{el.name}</span>
                    <span className="mono">SSIM {el.ssim}</span>
                  </div>
                ))}
                <div className="hero-report-foot">
                  <span>recipe: warm_up</span>
                  <span>MAE ≤ 16.9</span>
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

        {/* ---------- 能力矩阵 ---------- */}
        <section className="section" id="capabilities">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">What it does</div>
              <h2>One workspace for every product-photo edit</h2>
              <p>
                Colour, crop, resize, watermark — the operations your catalogue actually needs,
                executed as deterministic recipes and verified before delivery.
              </p>
            </Reveal>
            <div className="cap-grid">
              {CAPS.map((c, i) => (
                <Reveal key={c.t} delay={i * 90}>
                  <article className="cap">
                    <div className="cap-icon" aria-hidden="true">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h3>{c.t}</h3>
                    <p>{c.d}</p>
                    <span className="cap-tag">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      {c.tag}
                    </span>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 保真展示（真实 before/after 产品图） ---------- */}
        <section className="section alt" id="fidelity">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">Why verified</div>
              <h2>Every texture, label and logo preserved — and verified</h2>
              <p>
                The category&apos;s shared weakness is packaging text and logos: generative tools
                repaint them and hope. Surepix measures them instead.
              </p>
            </Reveal>
            <div className="showcase">
              {SHOWCASE.map((s, i) => (
                <Reveal key={s.id} delay={i * 90}>
                  <article className="show-item">
                    <div className="show-imgs">
                      <figure>
                        <img
                          src={`/samples/${s.id}.png`}
                          alt={`${s.title} — original upload`}
                          width={1200}
                          height={900}
                          loading="lazy"
                        />
                        <figcaption>Before</figcaption>
                      </figure>
                      <figure className="after">
                        <img
                          src={`/showcase/${s.id}-after.png`}
                          alt={`${s.title} — edited by Surepix, all elements verified`}
                          width={1200}
                          height={900}
                          loading="lazy"
                        />
                        <figcaption>After · verified</figcaption>
                      </figure>
                    </div>
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
            <Reveal delay={120}>
              <div className="callout">
                <div className="c-icon" aria-hidden="true">!</div>
                <p>
                  <b>The industry knows this.</b> Independent reviews of AI product-photo tools consistently
                  report warped packaging text and mangled logos — because the pipeline regenerates pixels
                  you needed preserved. The reliable fix is not a better prompt; it is verifying the elements
                  that matter, one by one, before anything ships.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------- 编号特性块 ---------- */}
        <section className="section">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">How it works</div>
              <h2>Three steps from upload to verified delivery</h2>
              <p>
                Surepix separates what machines can guarantee from what they can only guess —
                and routes each request accordingly.
              </p>
            </Reveal>
            <div className="feat-grid" id="how-it-works">
              {FEATURES.map((f, i) => (
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

        {/* ---------- 对比 ---------- */}
        <section className="section alt" id="compare">
          <div className="wrap">
            <Reveal className="section-head">
              <div className="kicker">Why deterministic</div>
              <h2>Recipes you can trust. Regeneration you can&apos;t predict.</h2>
              <p>
                Generative models are powerful — but they repaint pixels you need preserved.
                Surepix reserves generation for genuinely semantic work.
              </p>
            </Reveal>
            <div className="vs">
              <Reveal>
                <div className="vs-card ai">
                  <h3>Pure AI regeneration</h3>
                  <div className="sub">&ldquo;Repaint the whole image and hope&rdquo;</div>
                  <ul>
                    {VS_AI.map((x) => (
                      <li key={x.t}><span className="tick n" aria-hidden="true">✕</span><span>{x.t}</span></li>
                    ))}
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={120}>
                <div className="vs-card">
                  <h3>Surepix verified pipeline</h3>
                  <div className="sub">&ldquo;Edit as a recipe, verify before shipping&rdquo;</div>
                  <ul>
                    {VS_SUREPIX.map((x) => (
                      <li key={x.t}><span className="tick y" aria-hidden="true">✓</span><span>{x.t}</span></li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ---------- 保真承诺 ---------- */}
        <section className="section">
          <div className="wrap">
            <Reveal>
              <div className="guarantee">
                <div>
                  <div className="kicker">The Surepix guarantee</div>
                  <h2>Edits that stay true to the product — or they don&apos;t ship.</h2>
                  <p>
                    Every protected element passes four fidelity metrics before delivery: pixel error,
                    MS-SSIM, edge recall and contrast retention. If an edit can&apos;t be verified,
                    it is repaired with gentler parameters or escalated — never silently shipped
                    with a warped logo.
                  </p>
                </div>
                <div className="guarantee-stats">
                  <div className="gstat">
                    <div className="v">PASS · REPAIR · REGENERATE</div>
                    <div className="k">three-level verdict on every element, every edit</div>
                  </div>
                  <div className="gstat">
                    <div className="v">±2px edge tolerance</div>
                    <div className="k">logos and text measured against the original, not vibes</div>
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
                    {p.hot && <span className="tag">Most popular</span>}
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
