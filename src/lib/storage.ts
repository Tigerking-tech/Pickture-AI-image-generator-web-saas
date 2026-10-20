/**
 * 作品图持久化（分级存储）
 *
 * 两件事必须做，否则会出事：
 *
 * 1) fal.ai 返回的图是临时的（CDN 默认约 7 天，过期不可恢复），必须把字节
 *    取回来存进自己的存储。
 * 2) fal 返回的通常是 PNG，单张 1–3 MB。直接存原图的话，1GB 只放得下约 500 张。
 *    这里统一转 WebP 并生成两级尺寸：
 *      · 大图  ≤1536px q85 —— lightbox 与下载用，约 150–400 KB
 *      · 缩略图 ≤640px  q70 —— 瀑布流列表用，约 10–60 KB
 *    合计约 200–450 KB/张，1GB 可放约 2,500–4,000 个作品。
 *
 * 失败一律返回 null —— 调用方决定回退还是报错，绝不静默假装成功。
 */

import sharp from "sharp";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const WORKS_BUCKET = "works";

/** 大图：lightbox / 下载 */
const FULL_MAX = 1536;
const FULL_QUALITY = 85;
/** 缩略图：瀑布流列表 */
const THUMB_MAX = 640;
const THUMB_QUALITY = 70;

export interface PersistResult {
  /** 大图永久地址 */
  url: string;
  /** 缩略图永久地址 */
  thumbUrl: string;
  path: string;
  thumbPath: string;
  /** 两档文件合计字节 */
  bytes: number;
}

async function transcode(input: Buffer, max: number, quality: number): Promise<Buffer> {
  return sharp(input)
    .rotate() // 依据 EXIF 摆正，避免手机竖拍图躺倒
    .resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

/**
 * 把一张远端图片转存为自有存储的两级 WebP。
 * @param sourceUrl fal.ai / 任意 CDN 上的临时地址
 * @param basePath  桶内路径（不含扩展名），建议 `${userId}/${stamp}-${index}`
 */
export async function persistImage(
  sourceUrl: string,
  basePath: string,
): Promise<PersistResult | null> {
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) return null;

    const input = Buffer.from(await res.arrayBuffer());
    if (input.byteLength === 0) return null;

    const [full, thumb] = await Promise.all([
      transcode(input, FULL_MAX, FULL_QUALITY),
      transcode(input, THUMB_MAX, THUMB_QUALITY),
    ]);

    const path = `${basePath}.webp`;
    const thumbPath = `${basePath}__thumb.webp`;

    const db = getSupabaseAdmin();
    const [fullUp, thumbUp] = await Promise.all([
      db.storage.from(WORKS_BUCKET).upload(path, full, {
        contentType: "image/webp",
        upsert: true,
      }),
      db.storage.from(WORKS_BUCKET).upload(thumbPath, thumb, {
        contentType: "image/webp",
        upsert: true,
      }),
    ]);

    if (fullUp.error || thumbUp.error) return null;

    const { data: dFull } = db.storage.from(WORKS_BUCKET).getPublicUrl(path);
    const { data: dThumb } = db.storage.from(WORKS_BUCKET).getPublicUrl(thumbPath);

    return {
      url: dFull.publicUrl,
      thumbUrl: dThumb.publicUrl,
      path,
      thumbPath,
      bytes: full.byteLength + thumb.byteLength,
    };
  } catch {
    return null;
  }
}

/** 删除一张已存图片的两级文件（GDPR / 用户删作品） */
export async function removeImage(basePath: string): Promise<boolean> {
  try {
    const db = getSupabaseAdmin();
    const { error } = await db.storage
      .from(WORKS_BUCKET)
      .remove([`${basePath}.webp`, `${basePath}__thumb.webp`]);
    return !error;
  } catch {
    return false;
  }
}
