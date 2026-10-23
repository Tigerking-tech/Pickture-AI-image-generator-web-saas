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
  /**
   * 关闭"先思考再作答"（OpenAI 兼容写法：thinking:{type:"disabled"}）。
   *
   * 为什么要关（2026-10-23 实测）：腾讯 hy3 是推理模型，拆一句中文长句要 37~110s，
   * 其中绝大部分时间在吐 reasoning_content，正文最后才出来 —— 手机端 WebView
   * 常在 30s 左右掐断连接，用户看到 "Failed to fetch"。
   * 关闭后同一请求 1~2s 返回（reasoning_tokens=0），结构化抽取质量不受影响
   * （实测"背对着镜头"仍正确落到 character.orientation）。
   */
  disableThinking?: boolean;
}

const SYSTEM_PROMPT_HEAD = `You are a visual element decomposer for an AI image tool.

Given ONE user sentence (and optionally a reference image), decompose it into a structured set of visual elements following the VISTA schema.

Rules:
0. FIDELITY FIRST (highest priority): any explicit visual constraint stated in the sentence MUST be preserved verbatim (translated to English) as the "value" of the most relevant attribute, AND placed first in that attribute's "candidates". NEVER replace an explicit constraint with a generic default. In particular:
   - Body/viewpoint orientation words (e.g. "背影", "back view", "seen from behind", "looking down from above") belong to "character.orientation" or "composition.perspective" — NEVER reinterpret them as lighting (e.g. do NOT map "背影" to "backlight").
   - "character.orientation" must be PURE viewpoint only ("facing camera" / "back to camera (seen from behind)" / "side profile" / "viewed from above"). NEVER put motion verbs (running/walking/jumping) into it — motion belongs to "character.pose". "朝着镜头跑来" = pose "running" + orientation "facing camera".
   - If the stated constraint is not in the attribute's suggested pool, use the exact constraint anyway — the pool is only a suggestion.
1. Output ONLY valid JSON, no markdown fences, no commentary.
2. Shape: { "<group>": { "<attribute>": { "value": string, "candidates": string[] } } }
3. Candidate count is annotated per attribute in the schema as {n} — follow it exactly: attributes marked {9} are "pick by looking" elements (each 9-panel grid costs ONE image call, so 9 choices cost nothing extra); attributes marked {3} or {1} are fine/camera details, do NOT give them more than annotated. Keep every candidate value SHORT (1-3 words).
4. Use English values (the image model consumes English).
5. Skip the entire "camera" group (body/lens/fstop/iso/shutter/focal_length) unless the sentence explicitly mentions camera gear or a specific photographic technique — these details rarely matter and slow the decomposition down.
6. Beyond the explicit constraints from Rule 0, do not invent facts the sentence does not support — pick the most reasonable default and list alternatives in candidates.
7. Do NOT invent attributes outside the schema. Only output the group/attribute names listed in "Available schema" — any unknown key (e.g. "place", "prop", "elements") will be discarded, which loses information instead of adding it.
8. Leave out attributes you cannot reasonably determine.
9. ALWAYS fill "environment.location" (a concrete place type, e.g. "urban street", "forest", "beach", "mountain", "indoor studio") and "info.description" (ONE English sentence summarizing the scene). If the sentence does not state them, choose the most reasonable default instead of leaving them empty — otherwise the image model guesses randomly (a "running at sunset" scene may end up on a highway).

Available schema:
@@SCHEMA@@

Example input: "a girl seen from behind standing on a rooftop at sunset"
Example output (note: "seen from behind" is preserved in character.orientation, NOT dropped and NOT turned into lighting):
{"character":{"species":{"value":"human","candidates":["human","human and dog"]},"pose":{"value":"standing","candidates":["standing","walking"]},"orientation":{"value":"back to camera (seen from behind)","candidates":["back to camera (seen from behind)","side profile","facing camera"]}},"environment":{"timeofday":{"value":"sunset","candidates":["sunset","golden hour","dusk"]},"weather":{"value":"clear","candidates":["clear","cloudy","overcast"]}},"lighting":{"direction":{"value":"backlight","candidates":["backlight","rim light"]}},"composition":{"framing":{"value":"wide shot","candidates":["wide shot","medium shot","full shot"]}},"style":{"aesthetic":{"value":"photorealistic","candidates":["photorealistic","cinematic","anime"]}}}`;

/** 把 schema 占位符替换为实际提示（分批拆解时每批的 schema 不同） */
function buildSystemPrompt(schemaHint: string): string {
  return SYSTEM_PROMPT_HEAD.replace("@@SCHEMA@@", schemaHint);
}

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

      // 限流（429）/网关抖动（5xx）时自动重试一次 —— 免费档并发下偶发
      let res: Response | null = null;
      let lastDetail = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await fetch(`${config.baseUrl}/chat/completions`, {
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
              ...(config.disableThinking ? { thinking: { type: "disabled" } } : {}),
              messages: [
                { role: "system", content: buildSystemPrompt(req.schemaHint ?? buildSchemaHint()) },
                { role: "user", content: userContent },
              ],
            }),
          });
        } catch (err) {
          lastDetail = err instanceof Error ? err.message : String(err);
          res = null;
        }
        if (res && res.ok) break;
        if (res && res.status !== 429 && res.status < 500) break; // 客户端错误不重试
        if (attempt === 0) await new Promise((r) => setTimeout(r, 2500));
      }

      if (!res || !res.ok) {
        return {
          ok: false,
          status: res?.status ?? 502,
          detail: lastDetail || (res ? (await res.text()).slice(0, 500) : "request failed"),
        };
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

    /**
     * 流式拆解：把模型吐出的每个片段实时回调给调用方。
     * 这是长请求不被中间代理判超时的关键 —— 连接上一直有数据流动。
     */
    async decomposeStream(
      req: TextDecomposeRequest,
      onDelta: (text: string) => void,
    ): Promise<TextResult> {
      if (!config.apiKey) {
        return { ok: false, status: 503, detail: config.missingKeyMessage };
      }

      const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: `Sentence: ${req.sentence}` },
      ];

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
          stream: true,
          ...(config.disableThinking ? { thinking: { type: "disabled" } } : {}),
          messages: [
            { role: "system", content: buildSystemPrompt(req.schemaHint ?? buildSchemaHint()) },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!res.ok) {
        return { ok: false, status: res.status, detail: (await res.text()).slice(0, 500) };
      }
      if (!res.body) {
        return { ok: false, status: 502, detail: "upstream returned no stream body" };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === "" || payload === "[DONE]") continue;
            try {
              const chunk = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
              };
              const choice = chunk.choices?.[0]?.delta;
              const delta = choice?.content;
              // 推理模型的思维链（reasoning_content）同样推给前端当进度：
              // hy3 拆一句长话 60-120s 里绝大部分时间在吐思维链，正文最后才来。
              // 不推的话 SSE 长时间无数据，会被手机网络/代理当空闲连接掐断。
              const reasoning = choice?.reasoning_content;
              const piece =
                typeof delta === "string" && delta !== ""
                  ? delta
                  : typeof reasoning === "string" && reasoning !== ""
                    ? reasoning
                    : "";
              if (piece !== "") {
                if (typeof delta === "string" && delta !== "") content += delta;
                onDelta(piece);
              }
            } catch {
              // 单行解析失败（偶发分片），忽略即可
            }
          }
        }
      } catch (err) {
        return {
          ok: false,
          status: 502,
          detail: `stream read failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (content === "") {
        return { ok: false, status: 502, detail: "empty stream completion from model" };
      }
      return { ok: true, content };
    },
  };
}
