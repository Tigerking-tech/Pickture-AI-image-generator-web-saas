import { type NextRequest, NextResponse } from "next/server";
import { withDefaultModes } from "@/lib/elementConfig";
import { normalizePlan } from "@/lib/modelRouter";
import { emptyVistaTree, type VistaTree, validateVistaTree } from "@/lib/vista";
import { getTextProvider } from "@/lib/providers/text";

/**
 * R1 拆句：句子（+ 可选参考图）→ VISTA 要素 JSON
 *
 * 文本 provider 经 getTextProvider() 注入（OpenAI / OpenRouter 按 env 切换），
 * 密钥绝不进浏览器（规格 §0.2 红线）。缺 key 时返回 503 并明确报错。
 */

/** 可选模型覆盖：避免切换供应商时改代码 */
function resolveModel(plan: string, base: string): string {
  const override = plan === "free" ? process.env.TEXT_MODEL_FREE : process.env.TEXT_MODEL_PAID;
  return override && override.trim() ? override.trim() : base;
}

export async function POST(request: NextRequest) {
  const text = getTextProvider();
  if (!text.isConfigured()) {
    return NextResponse.json(
      { error: "MISSING_TEXT_PROVIDER_KEY", message: text.missingKeyMessage() },
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
  // 免费档 GPT-4o-mini；付费档 GPT-4o（PRD §10.5），可用 env 覆盖
  const baseModel = plan === "free" ? "gpt-4o-mini" : "gpt-4o";
  const model = resolveModel(plan, baseModel);

  const result = await text.decompose({
    sentence,
    imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
    model,
  });

  if (!result.ok) {
    const status = result.status >= 400 && result.status < 600 ? result.status : 502;
    return NextResponse.json(
      { error: "upstream_error", status: result.status, detail: result.detail },
      { status },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return NextResponse.json(
      { error: "invalid_json_from_model", raw: result.content.slice(0, 500) },
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
    return NextResponse.json(
      { error: "schema_validation_failed", errors: validation.errors.slice(0, 10) },
      { status: 502 },
    );
  }

  return NextResponse.json(tree);
}
