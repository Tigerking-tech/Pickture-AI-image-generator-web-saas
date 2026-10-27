"use client";

// 站点头部（从 Landing 抽出为客户端组件）：导航文案走 useT()，证明 i18n 端到端可用。
import Link from "next/link";
import { useT } from "@/i18n/I18nProvider";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { MobileNav } from "./MobileNav";

export function SiteHeader() {
  const { t } = useT();
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link href="/" className="logo" aria-label="Surepix home">
          <span className="logo-mark" aria-hidden="true">
            S
          </span>
          Surepix
        </Link>
        <nav className="nav-links nav-links-desktop" aria-label="Main navigation">
          <Link href="/#capabilities">{t("nav.features")}</Link>
          <Link href="/#fidelity">{t("nav.whyVerified")}</Link>
          <Link href="/#pricing">{t("nav.pricing")}</Link>
          <Link href="/#faq">{t("nav.faq")}</Link>
          <Link href="/login">{t("nav.signIn")}</Link>
          <Link href="/demo" className="btn btn-brand btn-sm">
            {t("nav.tryDemo")}
          </Link>
        </nav>
        <LocaleSwitcher />
        <MobileNav />
      </div>
    </header>
  );
}
