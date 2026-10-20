/**
 * SEO / GEO 基建（T15 / R12 / PRD §11.3）
 *
 * 提供：站点常量、每页 Metadata 工厂、JSON-LD 生成器。
 * 验收：构建输出 robots.txt（放行 AI 爬虫）、llms.txt、sitemap.xml、每页 Metadata + JSON-LD。
 */

import type { Metadata } from "next";

export const SITE_NAME = "Pictory";
export const SITE_TAGLINE =
  "Turn one sentence into a finished image — by answering a few visual choices, not by writing prompts.";
/** PRD §10.4：落地页钩子（英文版，面向海外） */
export const VALUE_HOOK =
  "Others write a 200-word prompt, roll the dice 8 times, and wait 20 minutes for one usable image. You just say one sentence, click a few times, and get it in 2 minutes — at 1/3 the cost.";

export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export interface PageMetaInput {
  title: string;
  description: string;
  path: string;
  /** 需要登录的页面设为 true，避免收录私隐内容 */
  noIndex?: boolean;
}

export function buildMetadata({
  title,
  description,
  path,
  noIndex = false,
}: PageMetaInput): Metadata {
  const url = `${getSiteUrl()}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
  };
}

/** SoftwareApplication JSON-LD：让 AI 搜索与 Google 理解产品形态与价格 */
export function softwareApplicationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: SITE_TAGLINE,
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    url: getSiteUrl(),
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "USD",
        description:
          "60 credits/month, watermarked, FLUX schnell previews, 2 Pro final-image trials",
      },
      {
        "@type": "Offer",
        name: "Starter",
        price: "9.9",
        priceCurrency: "USD",
        description:
          "600 credits/month, Pro final image, no watermark, personal commercial license",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "29",
        priceCurrency: "USD",
        description: "2400 credits/month, priority queue, commercial license, private generation",
      },
    ],
  };
}

export function webSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: getSiteUrl(),
    description: SITE_TAGLINE,
    potentialAction: {
      "@type": "SearchAction",
      target: `${getSiteUrl()}/gallery?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function faqJsonLd(items: Array<{ question: string; answer: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}
