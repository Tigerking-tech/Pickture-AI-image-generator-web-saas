import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/seo";

/** R12：sitemap.xml 覆盖全部公开页面（PRD §8 信息架构） */
export default function sitemap(): MetadataRoute.Sitemap {
  const BASE_URL = getSiteUrl();
  const now = new Date();

  return [
    { url: BASE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE_URL}/create`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE_URL}/gallery`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE_URL}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/signup`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
  ];
}
