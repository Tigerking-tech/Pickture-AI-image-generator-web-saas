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
  /**
   * 决策（2026-10-23，用户确认）：**准确率优先，思维链必须保持开启**。
   *
   * 实测对照：
   *   思维链开 → 拆一句 30~120s，但「背对着镜头」正确抽成 back to camera
   *   思维链关 → 只要 16s，却把「背对着镜头」错抽成 facing camera，
   *              动作也把 sitting fishing 抽成 running
   * 用户明确选择保持准确率，因此这里显式写 false（而不是留空），
   * 并在 tests/lib/providers.test.ts 里加了回归断言防止被误改。
   * 提速改走"压缩模型输出量"（见 schemaHint.ts）。
   */
  disableThinking: false,
  missingKeyMessage:
    "TENCENT_HUNYUAN_KEY is not configured, so the sentence cannot be decomposed via Tencent Hunyuan. Add the TokenHub API key to .env.local and retry. This endpoint will not fabricate output.",
});
