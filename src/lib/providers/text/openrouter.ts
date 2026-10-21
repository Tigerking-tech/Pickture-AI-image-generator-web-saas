/**
 * OpenRouter 文本 provider
 *
 * OpenRouter 是 OpenAI 兼容协议，仅 base URL 与请求头不同，复用 createOpenAIProvider。
 * 优点：模型池广（GPT / Claude / Llama 等），按 token 计费、路由灵活。
 */
import { createOpenAIProvider } from "./openai";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export const openRouterTextProvider = createOpenAIProvider({
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY,
  baseUrl: OPENROUTER_BASE,
  missingKeyMessage:
    "OPENROUTER_API_KEY is not configured. Set it to use OpenRouter as the text provider.",
  extraHeaders: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost",
    "X-Title": "Pickture",
  },
});
