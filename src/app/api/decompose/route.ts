import { type NextRequest, NextResponse } from "next/server";
import { withDefaultModes } from "@/lib/elementConfig";
import { normalizePlan } from "@/lib/modelRouter";
import { emptyVistaTree, VISTA_ATTRIBUTES, type VistaTree, validateVistaTree } from "@/lib/vista";

/**
 * R1 拆句：句子（+ 可选参考图）→ VISTA 要素 JSON
 *
 * 服务端代理，密钥绝不进浏览器（规格 §0.2 红线）。
 * 缺 OPENAI_API_KEY 时返回 503 并明确报错 —— 不静默降级、不伪造输出。
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

/** 把属性表压成 LLM 能理解的紧凑描述 */
function buildSchemaHint(): string {
  const groups = new Map<string, string[]>();
  for (const a of VISTA_ATTRIBUTES) {
    if (!groups.has(a.group)) groups.set(a.group, []);
    const pool = a.pool.length > 0 ? ` [${a.pool.join("|")}]` : "";
    groups.get(a.group)!.push(`${a.key}${pool}`);
  }
  return [...groups.entries()].map(([g, keys]) => `${g}: ${keys.join("; ")}`).join("\n");
}

const SYSTEM_PROMPT = `You are a visual element decomposer for an AI image tool.

Given ONE user sentence (and optionally a reference image), decompose it into a structured set of visual elements following the VISTA schema.

Rules:
1. Output ONLY valid JSON, no markdown fences, no commentary.
2. Shape: { "<group>": { "<attribute>": { "value": string, "candidates": string[] } } }
3. For every attribute you fill, provide 2-4 "candidates" (distinct plausible options, the chosen one first).
4. Use English values (the image model consumes English).
5. Do not invent attributes outside the schema. Do not invent facts the sentence does not support — pick the most reasonable default and list alternatives in candidates.
6. Leave out attributes you cannot reasonably determine.

Available schema:
${buildSchemaHint()}

Example input: "a girl and a dog running at sunset"
Example output:
{"character":{"species":{"value":"human and dog","candidates":["human and dog","human and cat","human only"]},"pose":{"value":"running","candidates":["running","walking","jumping"]}},"environment":{"timeofday":{"value":"sunset","candidates":["sunset","golden hour","dusk"]},"weather":{"value":"clear","candidates":["clear","cloudy","overcast"]}},"lighting":{"direction":{"value":"backlight","candidates":["backlight","side light","rim light"]}},"composition":{"framing":{"value":"wide shot","candidates":["wide shot","medium shot","full shot"]}},"style":{"aesthetic":{"value":"photorealistic","candidates":["photorealistic","cinematic","anime"]}}}`;

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "MISSING_OPENAI_API_KEY",
        message:
          "OPENAI_API_KEY is not configured, so the sentence cannot be decomposed. Add the key to .env.local and retry. This endpoint will not fabricate output.",
      },
      { status: 503 },
    );
  }

  let body: { sentence?: string; imageUrl?: string; plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sentence = typeof body.sentence === "string" ? body.sentence.trim() : "";
  if (sentence === "") {
    return NextResponse.json({ error: "sentence_required" }, { status: 400 });
  }
  if (sentence.length > 500) {
    return NextResponse.json({ error: "sentence_too_long" }, { status: 400 });
  }

  const plan = normalizePlan(body.plan);
  // 免费档 GPT-4o-mini；付费档 GPT-4o（PRD §10.5）
  const model = plan === "free" ? "gpt-4o-mini" : "gpt-4o";

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: `Sentence: ${sentence}` },
  ];
  if (typeof body.imageUrl === "string" && body.imageUrl.startsWith("http")) {
    userContent.push({ type: "image_url", image_url: { url: body.imageUrl } });
  }

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: "upstream_error", status: res.status, detail: detail.slice(0, 500) },
      { status: 502 },
    );
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    return NextResponse.json({ error: "empty_completion" }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return NextResponse.json(
      { error: "invalid_json_from_model", raw: content.slice(0, 500) },
      { status: 502 },
    );
  }

  // 补齐分组 + 决策标记，再校验
  const tree: VistaTree = { ...emptyVistaTree(), ...(parsed as object) };
  withDefaultModes(tree);
  tree.meta = {
    fromImage: typeof body.imageUrl === "string" && body.imageUrl.startsWith("http"),
    changedFields: [],
    sentence,
    model,
  };

  const validation = validateVistaTree(tree);
  if (!validation.ok) {
    // 模型可能返回了 schema 外的属性：剔除后再校验一次，仍失败才报错
    return NextResponse.json(
      { error: "schema_validation_failed", errors: validation.errors.slice(0, 10) },
      { status: 502 },
    );
  }

  return NextResponse.json(tree);
}
