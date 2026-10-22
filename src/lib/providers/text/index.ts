/**
 * 文本 provider 选择器
 *
 * 切换方式（Vercel / .env.local）：设置 TEXT_PROVIDER=openai | openrouter
 * 默认 openai。
 */
import type { TextProvider } from "../types";
import { createOpenAIProvider } from "./openai";
import { openRouterTextProvider } from "./openrouter";
import { tencentTextProvider } from "./tencent";

const openaiTextProvider: TextProvider = createOpenAIProvider({
  name: "openai",
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: "https://api.openai.com/v1",
  missingKeyMessage:
    "OPENAI_API_KEY is not configured, so the sentence cannot be decomposed. Add the key to .env.local and retry. This endpoint will not fabricate output.",
});

export function getTextProvider(): TextProvider {
  const kind = (process.env.TEXT_PROVIDER ?? "openai").toLowerCase();
  switch (kind) {
    case "openrouter":
      return openRouterTextProvider;
    case "tencent":
    case "hunyuan":
      return tencentTextProvider;
    case "openai":
    default:
      return openaiTextProvider;
  }
}

export type { TextProvider };
