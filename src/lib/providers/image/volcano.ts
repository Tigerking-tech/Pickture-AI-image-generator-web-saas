/**
 * 火山引擎（Volcengine Ark）图像 provider
 *
 * 接入说明（已按官方 API 对齐，2026-10 核实）：
 *   - 端点：POST https://ark.cn-beijing.volces.com/api/v3/images/generations
 *   - 鉴权：Authorization: Bearer $ARK_API_KEY（OpenAI 兼容，和 fal/腾讯不同）
 *   - 模型：doubao-seedream 系列，需在方舟控制台开通并拿到 model ID，
 *           用 VOLCANO_IMAGE_MODEL 覆盖 fal 的模型名（命名体系不同）
 *   - 响应：{ data: [{ url }] } —— OpenAI 兼容结构，data[0].url 即为图片 URL
 * 接口签名与 ImageProvider 完全一致，因此切换对业务路由零侵入。
 */
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const VOLCANO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

interface VolcanoImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string; code?: string };
}

export const volcanoImageProvider: ImageProvider = {
  name: "volcano",

  isConfigured() {
    return Boolean(process.env.VOLCANO_API_KEY);
  },

  missingKeyMessage() {
    return "VOLCANO_API_KEY is not configured. Set it to use Volcengine Ark as the image provider.";
  },

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const apiKey = process.env.VOLCANO_API_KEY;
    if (!apiKey) {
      return { ok: false, status: 503, detail: this.missingKeyMessage() };
    }

    // fal 与火山的模型命名不同，用 env 显式覆盖传入的 model
    const model = process.env.VOLCANO_IMAGE_MODEL ?? req.model;

    const res = await fetch(VOLCANO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: req.prompt,
        size: volcanoSize(req.size ?? "square_hd"),
        response_format: "url",
        watermark: false,
        output_format: "png",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, detail: text.slice(0, 500) };
    }

    const json = (await res.json()) as VolcanoImageResponse;
    if (json.error) {
      return { ok: false, status: 502, detail: json.error.message ?? "Volcengine Ark error" };
    }

    const urls = (json.data ?? [])
      .map((d) => d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined))
      .filter((u): u is string => Boolean(u));

    if (urls.length === 0) {
      return { ok: false, status: 502, detail: "Volcengine Ark returned no image URLs" };
    }
    return { ok: true, urls };
  },
};

/**
 * 把 fal 风格的 "square_hd" 等尺寸提示转成火山的尺寸格式
 * （火山支持 "2048x2048" / "1024x1024" / "2K" 等写法）
 */
function volcanoSize(hint: string): string {
  if (/portrait|vertical|tall/i.test(hint)) return "768x1024";
  if (/landscape|horizontal|wide/i.test(hint)) return "1024x768";
  return "1024x1024";
}
