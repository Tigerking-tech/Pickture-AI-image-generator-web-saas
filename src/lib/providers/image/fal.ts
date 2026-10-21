/**
 * fal.ai 图像 provider（当前默认实现）
 *
 * fal 返回的图在 CDN 上约 7 天后过期，调用方拿到 urls 后必须转存到自有存储
 * （见 lib/storage.ts 的 persistImage）。本 provider 只负责"生图"，不负责"存图"。
 */
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const FAL_RUN = "https://fal.run";

interface FalImageResponse {
  images?: Array<{ url: string }>;
}

export const falImageProvider: ImageProvider = {
  name: "fal",

  isConfigured() {
    return Boolean(process.env.FAL_KEY);
  },

  missingKeyMessage() {
    return "FAL_KEY is not configured, so no image can be generated. Add your fal.ai key to .env.local and retry. This endpoint will not return fake images.";
  },

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const apiKey = process.env.FAL_KEY;
    if (!apiKey) {
      return { ok: false, status: 503, detail: this.missingKeyMessage() };
    }

    const res = await fetch(`${FAL_RUN}/${req.model}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        prompt: req.prompt,
        image_size: req.size ?? "square_hd",
        num_images: req.numImages ?? 1,
      }),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
    }

    const json = (await res.json()) as FalImageResponse;
    const urls = (json.images ?? []).map((i) => i.url).filter(Boolean);
    if (urls.length === 0) {
      return { ok: false, status: 502, detail: "fal.ai returned no image URLs" };
    }
    return { ok: true, urls };
  },
};
