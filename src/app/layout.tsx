import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getLocale } from "@/i18n/get-locale";
import { messages } from "@/i18n/messages";
import { defaultLocale } from "@/i18n/config";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://surepix.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Surepix — Product Photos That Stay True, Verified Element by Element",
    template: "%s | Surepix",
  },
  description:
    "Surepix edits e-commerce product photos deterministically in ~40ms — colour, crop, resize, watermark — and verifies every logo, label and price tag against your brand assets before delivery. No more warped text. Batch 100 SKUs in seconds.",
  keywords: [
    "product photo editing",
    "e-commerce image editing",
    "AI product photos",
    "batch image editing",
    "logo fidelity check",
    "deterministic image editing",
    "SKU image pipeline",
  ],
  authors: [{ name: "Surepix" }],
  creator: "Surepix",
  publisher: "Surepix",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "en_US",
    alternateLocale: ["zh_CN"],
    url: SITE_URL,
    siteName: "Surepix",
    title: "Surepix — Product Photos That Stay True, Verified Element by Element",
    description:
      "Deterministic product-photo editing with built-in fidelity verification. Your logos stay crisp, your text stays readable, 100 SKUs processed in seconds.",
    images: [{ url: "/og-cover.svg", width: 1200, height: 630, alt: "Surepix — verified product photo editing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Surepix — Product Photos That Stay True, Verified Element by Element",
    description:
      "Deterministic product-photo editing with built-in fidelity verification. Logos stay crisp. 100 SKUs in seconds.",
    images: ["/og-cover.svg"],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  category: "technology",
};

export const viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: "Surepix",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description:
          "Deterministic e-commerce product photo editing with built-in brand-asset fidelity verification. Colour, crop, resize and watermark at ~40ms per image, with batch processing, per-element quality reports and editable PSD masters.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free tier — 50 edits/month" },
        featureList: [
          "Deterministic (recipe-based) photo edits",
          "Per-element fidelity verification for logos, labels and text",
          "Batch processing for entire SKU catalogues",
          "Editable PSD master files",
        ],
      },
      {
        "@type": "Organization",
        name: "Surepix",
        url: SITE_URL,
        logo: `${SITE_URL}/icon.svg`,
        sameAs: [],
      },
    ],
  };

  const locale = await getLocale();

  return (
    <html lang={locale}>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="sitemap" href="/sitemap.xml" />
        <noscript>
          <style>{`.reveal{opacity:1!important;transform:none!important}`}</style>
        </noscript>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      </head>
      <body>
        <I18nProvider locale={locale} messages={messages[locale]}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
