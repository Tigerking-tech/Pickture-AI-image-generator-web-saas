/**
 * 腾讯混元生图（Hunyuan Image）图像 provider —— 走 TokenHub OpenAI 兼容接口。
 *
 * 最新路径（2026-10 起）：腾讯把混元生图并入 TokenHub，提供
 *   POST https://tokenhub.tencentmaas.com/v1/images/generations
 * 与 OpenAI images API 同构（Bearer 鉴权、同步返回 data[].url），无需 CAM 签名/轮询。
 * 凭证：与文本共用的 TokenHub API Key（一个 key 同时覆盖文本和图像）。
 * 免费档：新用户送图像免费额度（旧平台 50 次），之后按量计费。
 */
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const TOKENHUB_IMAGES = "https://tokenhub.tencentmaas.com/v1/images/generations";

interface TencentImageConfig {
  apiKey: string | undefined;
  /** 覆盖传入的模型标识，如 hy-image-v3.0 / hy-image-v3.5-preview */
  model?: string;
}

/** 把 fal 风格的 size 提示映射到 TokenHub 的 "宽:高" 格式 */
function toSize(hint: string | undefined): string {
  const h = (hint ?? "").toLowerCase();
  if (/(portrait|vertical|3:4|9:16|3:5)/.test(h)) return "768:1024";
  if (/(landscape|horizontal|4:3|16:9|5:3)/.test(h)) return "1024:768";
  return "1024:1024";
}

interface TokenHubImageResponse {
  data?: Array<{ url?: string }>;
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
          model: cfg.model ?? req.model ?? "hy-image-v3.0",
          prompt: req.prompt,
          size: toSize(req.size),
          n: Math.min(Math.max(req.numImages ?? 1, 1), 4),
          revise: 0, // 我们已自带英文 prompt，关闭平台扩写
          logo_add: 0, // 不加水印，成品图交给我们自己的存储
        }),
      });

      if (!res.ok) {
        return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
      }

      const json = (await res.json()) as TokenHubImageResponse;
      const urls = (json.data ?? []).map((d) => d.url).filter((u): u is string => Boolean(u));
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
