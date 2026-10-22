import type { NextConfig } from "next";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
/**
 * 本地 Supabase（supabase start）时，图片公网地址是 http://127.0.0.1:54321/...，
 * 手机/外部设备访问该地址会指向设备自身，导致图裂。
 * 因此把 /sb/* 反向代理到本地 Supabase，图片走网站同域加载。
 * 使用云端 Supabase 时（公网域名）不需要代理，此规则自动关闭。
 */
const isLocalSupabase = /127\.0\.0\.1|localhost/.test(SUPABASE_URL);

const nextConfig: NextConfig = {
  async rewrites() {
    if (!isLocalSupabase) return [];
    return [{ source: "/sb/:path*", destination: `${SUPABASE_URL}/:path*` }];
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
