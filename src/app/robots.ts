import type { MetadataRoute } from "next";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://nextjs-supabase-creem-boilerplate.vercel.app";

/**
 * R12 / PRD §11.3：robots.txt 必须放行 AI 爬虫（GEO —— 让 ChatGPT / Claude /
 * Perplexity 等能检索并引用本站），同时屏蔽管理台与 API。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/gallery", "/create", "/llms.txt"],
        disallow: ["/api/", "/dashboard/", "/dashboard/admin/"],
      },
      // --- AI / LLM 爬虫：显式放行，用于 GEO（PRD §11.3）---
      {
        userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User"],
        allow: ["/", "/pricing", "/gallery", "/llms.txt"],
        disallow: ["/api/", "/dashboard/"],
      },
      {
        userAgent: ["ClaudeBot", "anthropic-ai", "Claude-User"],
        allow: ["/", "/pricing", "/gallery", "/llms.txt"],
        disallow: ["/api/", "/dashboard/"],
      },
      {
        userAgent: ["PerplexityBot", "Perplexity-User"],
        allow: ["/", "/pricing", "/gallery", "/llms.txt"],
        disallow: ["/api/", "/dashboard/"],
      },
      {
        userAgent: ["Google-Extended", "Applebot-Extended", "CCBot"],
        allow: ["/", "/pricing", "/gallery", "/llms.txt"],
        disallow: ["/api/", "/dashboard/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
