import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://surepix.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard/",
          "/login",
          "/signup",
          "/forgot-password",
          "/reset-password",
          "/callback",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
