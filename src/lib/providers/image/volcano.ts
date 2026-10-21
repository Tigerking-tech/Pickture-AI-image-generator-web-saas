/**
 * 火山引擎（Volcengine Ark）图像 provider
 *
 * ⚠️ 待验证：本适配器按火山方舟"图像生成"OpenAPI 结构编写（POST /api/v3/images/generations，
 * 返回 { data: [{ url }] }），但尚未用真实 key 联调。上线火山前需：
 *   1) 在方舟控制台开通图像生成模型并拿到 endpoint/model 名（如 doubao-seedream-3-0-t2i）；
 *   2) 用 VOLCANO_IMAGE_MODEL 覆盖传入的 fal 模型名（两者命名体系不同）；
 *   3) 实测响应字段（url / b64_json）后微调本文件。
 * 接口签名与 ImageProvider 完全一致，因此切换对业务路由零侵入。
 */
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const VOLCANO_ENDPOINT = "https://ark.cn-beijing.volces.com/api/v3/images/generations";

interface VolcanoImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
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
        n: req.numImages ?? 1,
      }),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
    }

    const json = (await res.json()) as VolcanoImageResponse;
    const urls = (json.data ?? []).map((d) => d.url).filter((u): u is string => Boolean(u));
    if (urls.length === 0) {
      return { ok: false, status: 502, detail: "Volcengine Ark returned no image URLs" };
    }
    return { ok: true, urls };
  },
};

/** 把 fal 的 "square_hd" 等尺寸提示转成火山的 "1024x1024" 格式 */
function volcanoSize(hint: string): string {
  if (/square/i.test(hint)) return "1024x1024";
  if (/portrait|vertical/i.test(hint)) return "768x1024";
  if (/landscape|horizontal/i.test(hint)) return "1024x768";
  return "1024x1024";
}
