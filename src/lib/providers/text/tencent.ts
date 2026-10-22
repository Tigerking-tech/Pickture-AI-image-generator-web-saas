/**
 * 腾讯混元（Hunyuan）文本 provider —— 走 TokenHub OpenAI 兼容接口。
 *
 * 接入点：base_url = https://tokenhub.tencentmaas.com/v1
 * 凭证：TokenHub API Key（一个 key 同时覆盖文本与图像）
 * 免费档：新用户送 100 万 tokens 免费资源包（hy3 可用），之后按量计费。
 * 旧版 hunyuan-lite 等已于 2026-06-22 下线，统一用 TokenHub 的 hy3。
 */
import { createOpenAIProvider } from "./openai";

export const tencentTextProvider = createOpenAIProvider({
  name: "tencent",
  apiKey: process.env.TENCENT_HUNYUAN_KEY,
  baseUrl: "https://tokenhub.tencentmaas.com/v1",
  // 默认 hy3（含免费额度）；想升档可在 .env.local 用 TENCENT_HUNYUAN_MODEL 覆盖
  defaultModel: process.env.TENCENT_HUNYUAN_MODEL ?? "hy3",
  missingKeyMessage:
    "TENCENT_HUNYUAN_KEY is not configured, so the sentence cannot be decomposed via Tencent Hunyuan. Add the TokenHub API key to .env.local and retry. This endpoint will not fabricate output.",
});
