import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
          // CSP：此前缺的一条安全头。
          //   · default-src 'self' 兜底所有未声明的资源类型
          //   · img-src 允许 data:/blob: —— 编辑管线全程以 base64/dataURL 传递图片
          //   · connect-src 列出需要 XHR/fetch 的第三方：Supabase（含 Realtime 的 wss）、
          //     Upstash REST（限流）、fal.run（生成模型）
          //   · frame-ancestors 'none' + form-action 'self' 补 X-Frame-Options 之外的兜底
          // script-src 仍带 'unsafe-inline'：layout.tsx 内联了 JSON-LD，
          // Next 自身也会注入内联脚本。迁移到 nonce 后请收紧此项。
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io https://fal.run https://queue.fal.run https://api.resend.com",
              "frame-ancestors 'none'",
              "form-action 'self'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
