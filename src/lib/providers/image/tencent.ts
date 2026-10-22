/**
 * 腾讯混元生图（Hunyuan Image）图像 provider —— 走 TokenHub 同步接口。
 *
 * 官方文档（2026-10）：https://cloud.tencent.com/document/product/1823/135745
 * 调用点：POST https://tokenhub.tencentmaas.com/v1/images/generations
 *   （与 OpenAI images API 同构：Bearer 鉴权、同步返回 data[].url）
 * 凭证：与文本共用的 TokenHub API Key（一个 key 同时覆盖文本和图像）。
 * 模型 ID：hy-image-v3（Hy-Image-3.0）/ hy-image-v3.5-preview（多轮编辑）。
 * 尺寸：腾讯格式为 "宽x高"（如 1024x1024），范围宽高 ∈ [512,2048] 且面积 ≤ 1024*1024。
 * 免费档：新用户送图像免费额度，之后按量计费。
 */
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const TOKENHUB_IMAGES = "https://tokenhub.tencentmaas.com/v1/images/generations";

interface TencentImageConfig {
  apiKey: string | undefined;
  /** 覆盖传入的模型标识，如 hy-image-v3 / hy-image-v3.5-preview */
  model?: string;
}

/** 把 fal 风格的 size 提示映射到腾讯的 "宽x高" 格式（面积不超过 1024*1024） */
function toSize(hint: string | undefined): string {
  const h = (hint ?? "").toLowerCase();
  if (/(portrait|vertical|3:4|9:16|3:5)/.test(h)) return "768x1024";
  if (/(landscape|horizontal|4:3|16:9|5:3)/.test(h)) return "1024x768";
  return "1024x1024";
}

interface TokenHubImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
}

export function createTencentImageProvider(cfg: TencentImageConfig): ImageProvider {
  return {
    name: "tencent",

    isConfigured() {
      return Boolean(cfg.apiKey);
    },

    missingKeyMessage() {
      return "TENCENT_HUNYUAN_KEY is not configured, so no image can be generated via Tencent Hunyuan. Add the TokenHub API key to .env.local and retry. This endpoint will not return fake images.";
    },

    async generate(req: ImageGenRequest): Promise<ImageGenResult> {
      if (!cfg.apiKey) {
        return { ok: false, status: 503, detail: this.missingKeyMessage() };
      }

      const res = await fetch(TOKENHUB_IMAGES, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model ?? req.model ?? "hy-image-v3",
          prompt: req.prompt,
          size: toSize(req.size),
          // 我们已自带英文 prompt，关闭平台自动扩写，保证可控
          revise: false,
        }),
      });

      if (!res.ok) {
        return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
      }

      const json = (await res.json()) as TokenHubImageResponse;
      const items = json.data ?? [];
      const urls = items.map((d) => d.url).filter((u): u is string => Boolean(u));
      if (urls.length === 0) {
        return { ok: false, status: 502, detail: "Tencent returned no image URLs" };
      }
      return { ok: true, urls };
    },
  };
}

export const tencentImageProvider = createTencentImageProvider({
  apiKey: process.env.TENCENT_HUNYUAN_KEY,
  model: process.env.TENCENT_HUNYUAN_IMAGE_MODEL,
});
