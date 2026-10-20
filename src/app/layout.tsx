import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@/components/Analytics";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata, SITE_NAME, SITE_TAGLINE, softwareApplicationJsonLd } from "@/lib/seo";
import "./globals.css";

// 展示字：电影感、可紧收字距（Leonardo 的 ufficioDisplay 角色）
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage-grotesque",
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
});

// 正文：人文主义无衬线，开放字腔、长文可读（Leonardo 的 canvaSans 角色）
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// 元数据与标签：等宽（Midjourney 用等宽承载 tag / 参数的惯例）
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = buildMetadata({
  title: `${SITE_NAME} — One sentence. A few clicks. One finished image.`,
  description: SITE_TAGLINE,
  path: "/",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${bricolage.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} antialiased bg-canvas text-ink`}
      >
        {children}
        {/* R12：全站 JSON-LD；R11：可观测脚本（未配置环境变量时不注入） */}
        <JsonLd data={softwareApplicationJsonLd()} />
        <Analytics />
      </body>
    </html>
  );
}
