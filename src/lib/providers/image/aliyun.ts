/**
 * 阿里云百炼（DashScope）通义千问图像 provider
 *
 * 接入说明（2026-10-23 实测验证通过）：
 *   - 端点：POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 *   - 鉴权：Authorization: Bearer <API Key>
 *   - 模型：qwen-image-3.0（标准，已验证）/ qwen-image-3.0-pro / wan2.7-image
 *   - 请求体：{ model, input: { messages: [{ role:"user", content:[{text}] }] },
 *              parameters: { size, n, watermark, prompt_extend } }
 *   - 响应：output.choices[0].message.content[0].image → 图片 URL
 *
 * ⚠️ 实测结论（重要，别改回兼容模式）：
 *   本账号的 OpenAI 兼容端点 /compatible-mode/v1/images/generations 返回 404（网关未开放），
 *   必须走 DashScope 原生接口。/compatible-mode/v1/models 可用来核对账号可用的模型 ID。
 *
 * ⚠️ 两个必须注意的点：
 *   1) 尺寸格式是 `宽*高`（星号，如 1024*1024），不是 OpenAI 的 `1024x1024`。
 *   2) 返回的图片 URL 有效期仅 24 小时 —— 因此必须由 persistImage 转存到自有存储，
 *      绝不能直接把该 URL 存进数据库，否则一天后全变死链。
 *   3) n 必须显式传 1 —— 阿里部分模型默认 n=4，不传会一次出 4 张、扣 4 倍费用。
 *
 * 地域：默认华北2（北京）国内站。国际站请把 ALIYUN_BASE_URL
 *      改为 https://dashscope-intl.aliyuncs.com
 *      （地域与 API Key 必须匹配，否则鉴权失败）。
 * 接口签名与 ImageProvider 完全一致，因此切换对业务路由零侵入。
 */
import type { ImageGenRequest, ImageGenResult, ImageProvider } from "../types";

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_MODEL = "qwen-image-3.0";
const GENERATION_PATH = "/api/v1/services/aigc/multimodal-generation/generation";

interface AliyunNativeResponse {
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string; text?: string }>;
      };
    }>;
  };
  code?: string;
  message?: string;
}

export const aliyunImageProvider: ImageProvider = {
  name: "aliyun",

  isConfigured() {
    return Boolean(process.env.ALIYUN_API_KEY ?? process.env.DASHSCOPE_API_KEY);
  },

  missingKeyMessage() {
    return "ALIYUN_API_KEY is not configured. Set it (or DASHSCOPE_API_KEY) to use Alibaba Cloud Bailian (Qwen-Image) as the image provider.";
  },

  async generate(req: ImageGenRequest): Promise<ImageGenResult> {
    const apiKey = process.env.ALIYUN_API_KEY ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return { ok: false, status: 503, detail: this.missingKeyMessage() };
    }

    const model = process.env.ALIYUN_IMAGE_MODEL ?? DEFAULT_MODEL;
    const baseUrl = process.env.ALIYUN_BASE_URL ?? DEFAULT_BASE_URL;

    // 免费档/新账号 QPS 很低，偶发 429 Throttling.RateQuota —— 指数退避重试
    const maxAttempts = 3;
    let result = await callOnce(req, apiKey, model, baseUrl);
    for (let attempt = 1; attempt < maxAttempts && !result.ok && result.status === 429; attempt++) {
      await new Promise((r) => setTimeout(r, 3000 * attempt)); // 3s → 6s
      result = await callOnce(req, apiKey, model, baseUrl);
    }
    return result;
  },

  /**
   * 网格出候选：一次调用画一张 N 格网格图。
   * 与单图走同一端点，只是 req.prompt 已由 buildGridPrompt 构造为网格指令。
   * 实测 z-image-turbo / qwen-image 对网格指令遵循良好（9 格规整、可等分切割）。
   */
  async generateGrid(req: ImageGenRequest): Promise<ImageGenResult> {
    const apiKey = process.env.ALIYUN_API_KEY ?? process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return { ok: false, status: 503, detail: this.missingKeyMessage() };
    }
    const model = process.env.ALIYUN_IMAGE_MODEL ?? DEFAULT_MODEL;
    const baseUrl = process.env.ALIYUN_BASE_URL ?? DEFAULT_BASE_URL;
    // 正方形才能按行列等分切割
    return callOnce({ ...req, size: "square" }, apiKey, model, baseUrl);
  },
};

/** 单次调用阿里原生接口（不含重试逻辑，重试由 generate 的退避循环负责） */
async function callOnce(
  req: ImageGenRequest,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<ImageGenResult> {
  // 参考图（图生图）：把用户选中的图取回来转 base64 传入，锁住主体
  let referencePart: { image: string; text: string } | null = null;
  if (req.referenceUrl) {
    try {
      const refRes = await fetch(req.referenceUrl, { signal: AbortSignal.timeout(30_000) });
      if (refRes.ok) {
        const buf = Buffer.from(await refRes.arrayBuffer());
        if (buf.byteLength > 0 && buf.byteLength < 10 * 1024 * 1024) {
          const b64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
          // 实测（2026-10-23）：z-image 要求 image 与 text 合并在同一个 content 项里，
          // 且整个 content 只允许一个 text 项
          referencePart = { image: b64, text: req.prompt };
        }
      }
    } catch {
      // 参考图取不到就退化为纯文生图，不阻断
    }
  }

  // 生图耗时较长（数十秒），给足超时，避免请求被过早中断
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${GENERATION_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: {
          messages: [
            {
              role: "user",
              content: referencePart ? [referencePart] : [{ text: req.prompt }],
            },
          ],
        },
        parameters: {
          size: aliyunSize(req.size ?? "square_hd"),
          n: 1,
          watermark: false,
          // 关闭提示词智能改写：我们的 prompt 已由决策树精心构造，
          // 开启改写可能引入受版权保护内容并触发内容审核报错
          prompt_extend: false,
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      detail: `Alibaba Bailian request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, detail: text.slice(0, 500) };
  }

  let json: AliyunNativeResponse;
  try {
    json = JSON.parse(text) as AliyunNativeResponse;
  } catch {
    return {
      ok: false,
      status: 502,
      detail: `Alibaba Bailian returned non-JSON: ${text.slice(0, 300)}`,
    };
  }

  if (json.code) {
    return { ok: false, status: 502, detail: json.message ?? json.code };
  }

  const urls = (json.output?.choices ?? [])
    .flatMap((c) => c.message?.content ?? [])
    .map((c) => c.image)
    .filter((u): u is string => Boolean(u));

  if (urls.length === 0) {
    return { ok: false, status: 502, detail: "Alibaba Bailian returned no image URLs" };
  }
  return { ok: true, urls };
}

/** fal 风格的 "square_hd" 转成阿里原生接口的 `宽*高` 格式（星号分隔） */
function aliyunSize(hint: string): string {
  if (/portrait|vertical|tall/i.test(hint)) return "768*1024";
  if (/landscape|horizontal|wide/i.test(hint)) return "1024*768";
  return "1024*1024";
}
