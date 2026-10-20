import Link from "next/link";
import { GalleryGrid, type GalleryItem } from "@/components/GalleryGrid";
import { JsonLd } from "@/components/JsonLd";
import { buildMetadata, getSiteUrl } from "@/lib/seo";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * 公开画廊（T14 / 增长飞轮 F15 / R12 可分享）
 *
 * 布局：Midjourney 的 Explore —— 全屏接触式印样网格，点击弹出 lightbox 详情。
 * 网格隐形（无边框、无卡片底色），图片之间的负空间就是纯黑画布本身。
 */
export const metadata = buildMetadata({
  title: "Gallery — Pictory",
  description: "Works created with Pictory's visual decision tree. Reuse any element tree.",
  path: "/gallery",
});

interface WorkRow {
  id: string;
  title: string | null;
  sentence: string | null;
  final_image_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export default async function GalleryPage() {
  let works: WorkRow[] = [];

  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from("works")
      .select("id, title, sentence, final_image_url, thumbnail_url, created_at")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(48);
    works = (data ?? []) as WorkRow[];
  } catch {
    // 数据库不可用时显示空态，不伪造内容
    works = [];
  }

  const items: GalleryItem[] = works
    .filter((w) => w.final_image_url)
    .map((w) => ({
      id: w.id,
      // 列表优先走缩略图；无缩略图时回退大图（演示数据即如此）
      url: (w.thumbnail_url ?? w.final_image_url) as string,
      full: w.final_image_url as string,
      caption: w.sentence ?? w.title,
      createdAt: w.created_at,
    }));

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Pictory Gallery",
          url: `${getSiteUrl()}/gallery`,
        }}
      />

      <header className="sticky top-0 z-20 border-b border-hairline bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="font-display text-lg font-extrabold tracking-tight">
            Pictory
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/pricing"
              className="rounded-full px-3 py-2 text-ink-secondary transition hover:text-ink"
            >
              Pricing
            </Link>
            <Link href="/create" className="btn-primary px-4 py-2 text-sm">
              Generate
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-10 md:px-6 md:py-14">
        <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">Gallery</h1>
        <p className="mt-2 text-sm text-ink-secondary">
          Works made by saying one sentence and clicking a few choices.
        </p>

        {items.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="font-display text-lg font-bold tracking-tight">No images yet</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
              Nothing public here yet. Generate one and share it.
            </p>
            <Link href="/create" className="btn-primary mt-6 inline-flex px-6 py-3">
              Generate
            </Link>
          </div>
        ) : (
          <GalleryGrid items={items} />
        )}
      </div>
    </div>
  );
}
