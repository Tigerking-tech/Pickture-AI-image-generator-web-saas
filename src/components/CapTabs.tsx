"use client";

import { useState } from "react";
import { BeforeAfter } from "./BeforeAfter";

/* ============================================================
   能力矩阵 tab 切换 — 对标 Photoroom（Scale&Automate/Create/Edit）
   与 Pixelcut（侧栏 Home/Generate/Upload/Batch）的分组交互：
   每个 tab 左文右图，图为本 tab 真实管线输出的 before/after。
   ============================================================ */

const TABS = [
  {
    id: "colour",
    tab: "Colour & light",
    h: "Colour that obeys the recipe",
    desc: "Warmth, brightness, contrast, saturation — compiled to curves and executed deterministically. Same input, same output, every time.",
    points: [
      ["Curves, not AI guesses", "~40ms"],
      ["Per-element contrast retention", "verified"],
      ["Brand colours survive the edit", "±2px edges"],
    ],
    before: "/samples/serum.png",
    after: "/showcase/serum-after.png",
  },
  {
    id: "resize",
    tab: "Crop & resize",
    h: "Every platform, one master image",
    desc: "Platform presets for Amazon, Shopify, Zalando and more. Fit-and-pad instead of crop, so nothing important ever falls out of frame.",
    points: [
      ["800×800 marketplace preset", "38ms"],
      ["No content loss — pad, don't crop", "fit + pad"],
      ["Same recipe across 100 SKUs", "< 3s"],
    ],
    before: "/samples/phones.png",
    after: "/showcase/phones-after.png",
  },
  {
    id: "brand",
    tab: "Brand & text",
    h: "Your logo stays your logo",
    desc: "Watermarks and promo tags land as real editable PSD text layers. Brand assets are measured after every edit — never repainted.",
    points: [
      ["Editable PSD text layers", "not flattened"],
      ["Logo & label fidelity check", "MS-SSIM ≥ 0.95"],
      ["Three-level verdict per element", "PASS / REPAIR / REGENERATE"],
    ],
    before: "/samples/coffee.png",
    after: "/showcase/coffee-after.png",
  },
];

export function CapTabs() {
  const [active, setActive] = useState(TABS[0].id);
  const t = TABS.find((x) => x.id === active) ?? TABS[0];

  return (
    <div>
      <div className="cap-tabs" role="tablist" aria-label="Capabilities">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={x.id === active}
            className={`cap-tab${x.id === active ? " on" : ""}`}
            onClick={() => setActive(x.id)}
          >
            {x.tab}
          </button>
        ))}
      </div>
      <div className="cap-panel cap-fade" key={t.id}>
        <div className="cap-panel-media">
          <BeforeAfter before={t.before} after={t.after} initial={58} />
        </div>
        <div>
          <h3>{t.h}</h3>
          <p className="cap-desc">{t.desc}</p>
          <ul className="cap-points">
            {t.points.map(([label, tag]) => (
              <li key={label}>
                <span>{label}</span>
                <span className="pt-tag">{tag}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
