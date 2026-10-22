/**
 * OpenAI 文本 provider（拆句：句子 + 可选参考图 → VISTA JSON）
 *
 * 实现为"可配置 base URL 的 OpenAI 兼容客户端"：OpenRouter 等兼容服务
 * 只需换 baseUrl 即可复用，无需另写一份逻辑。
 */
import type { TextDecomposeRequest, TextProvider, TextResult } from "../types";
import { buildSchemaHint } from "./schemaHint";

export interface OpenAIConfig {
  /** provider 名称（用于日志，如 "openai" / "openrouter"） */
  name: string;
  /** 环境变量里的密钥名 */
  apiKey: string | undefined;
  /** API 基址，默认 OpenAI 官方 */
  baseUrl: string;
  /** 缺失密钥时的报错文案 */
  missingKeyMessage: string;
  /** 可选附加请求头（OpenRouter 需要 Authorization 之外的 referer 等） */
  extraHeaders?: Record<string, string>;
  /** 强制使用的模型名，覆盖请求里带来的模型标识（如接入 Tencent 时锁定免费模型） */
  defaultModel?: string;
}

const SYSTEM_PROMPT = `You are a visual element decomposer for an AI image tool.

Given ONE user sentence (and optionally a reference image), decompose it into a structured set of visual elements following the VISTA schema.

Rules:
0. FIDELITY FIRST (highest priority): any explicit visual constraint stated in the sentence MUST be preserved verbatim (translated to English) as the "value" of the most relevant attribute, AND placed first in that attribute's "candidates". NEVER replace an explicit constraint with a generic default. In particular:
   - Body/viewpoint orientation words (e.g. "背影", "back view", "seen from behind", "looking down from above") belong to "character.orientation" or "composition.perspective" — NEVER reinterpret them as lighting (e.g. do NOT map "背影" to "backlight").
   - If the stated constraint is not in the attribute's suggested pool, use the exact constraint anyway — the pool is only a suggestion.
1. Output ONLY valid JSON, no markdown fences, no commentary.
2. Shape: { "<group>": { "<attribute>": { "value": string, "candidates": string[] } } }
3. For every attribute you fill, provide up to 9 "candidates" (distinct plausible options, the chosen one first). Prefer the full 9 when the attribute is a visual one the user will choose by looking (pose, orientation, lighting, framing, etc.) — a 9-panel grid is generated in ONE image call, so more choices cost nothing extra.
4. Use English values (the image model consumes English).
5. Beyond the explicit constraints from Rule 0, do not invent facts the sentence does not support — pick the most reasonable default and list alternatives in candidates.
6. Leave out attributes you cannot reasonably determine.

Available schema:
${buildSchemaHint()}

Example input: "a girl seen from behind standing on a rooftop at sunset"
Example output (note: "seen from behind" is preserved in character.orientation, NOT dropped and NOT turned into lighting):
{"character":{"species":{"value":"human","candidates":["human","human and dog"]},"pose":{"value":"standing","candidates":["standing","walking"]},"orientation":{"value":"back to camera (seen from behind)","candidates":["back to camera (seen from behind)","side profile","facing camera"]}},"environment":{"timeofday":{"value":"sunset","candidates":["sunset","golden hour","dusk"]},"weather":{"value":"clear","candidates":["clear","cloudy","overcast"]}},"lighting":{"direction":{"value":"backlight","candidates":["backlight","rim light"]}},"composition":{"framing":{"value":"wide shot","candidates":["wide shot","medium shot","full shot"]}},"style":{"aesthetic":{"value":"photorealistic","candidates":["photorealistic","cinematic","anime"]}}}`;

export function createOpenAIProvider(config: OpenAIConfig): TextProvider {
  return {
    name: config.name,

    isConfigured() {
      return Boolean(config.apiKey);
    },

    missingKeyMessage() {
      return config.missingKeyMessage;
    },

    async decompose(req: TextDecomposeRequest): Promise<TextResult> {
      if (!config.apiKey) {
        return { ok: false, status: 503, detail: config.missingKeyMessage };
      }

      const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: `Sentence: ${req.sentence}` },
      ];
      if (typeof req.imageUrl === "string" && req.imageUrl.startsWith("http")) {
        userContent.push({ type: "image_url", image_url: { url: req.imageUrl } });
      }

      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...config.extraHeaders,
        },
        body: JSON.stringify({
          model: config.defaultModel ?? req.model,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!res.ok) {
        return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        return { ok: false, status: 502, detail: "empty completion from model" };
      }
      return { ok: true, content };
    },
  };
}
