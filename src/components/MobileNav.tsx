"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { href: "/#capabilities", label: "Features" },
  { href: "/#fidelity", label: "Why verified" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/login", label: "Sign in" },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="nav-mobile">
      <button
        type="button"
        className="nav-burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`burger-box${open ? " open" : ""}`} aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      {open && (
        <nav className="nav-drawer" aria-label="Mobile navigation">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          <Link href="/demo" className="btn btn-brand btn-sm" onClick={() => setOpen(false)}>
            Try the demo
          </Link>
        </nav>
      )}
    </div>
  );
}
