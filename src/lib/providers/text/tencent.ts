/**
 * 腾讯混元（Hunyuan）文本 provider —— 完全 OpenAI 兼容接口。
 *
 * 接入点：base_url = https://api.hunyuan.cloud.tencent.com/v1
 * 凭证：TokenHub API Key（不是 CAM 的 SecretId/SecretKey！）
 * 免费档：hunyuan-lite 永久免费；新用户再送 100 万 tokens 资源包。
 * 因此这里直接复用 createOpenAIProvider，只换 baseUrl + 默认免费模型。
 */
import { createOpenAIProvider } from "./openai";

export const tencentTextProvider = createOpenAIProvider({
  name: "tencent",
  apiKey: process.env.TENCENT_HUNYUAN_KEY,
  baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
  // 默认走永久免费的 hunyuan-lite；想升档可在 .env.local 用 TENCENT_HUNYUAN_MODEL 覆盖
  defaultModel: process.env.TENCENT_HUNYUAN_MODEL ?? "hunyuan-lite",
  missingKeyMessage:
    "TENCENT_HUNYUAN_KEY is not configured, so the sentence cannot be decomposed via Tencent Hunyuan. Add the TokenHub API key to .env.local and retry. This endpoint will not fabricate output.",
});
