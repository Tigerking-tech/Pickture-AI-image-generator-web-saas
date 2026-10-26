/**
 * generative.ts — 语义重生成后端（Surepix 算法层 #5）
 *
 * 解决 pipeline.ts 中 `regenerate` / `hybrid` 两类路由此前是空壳（"not enabled in demo"）的问题：
 * 客户说"把背景换成白底 / 换个材质 / 扩图"这类 PhotoCraft 白名单覆盖不了的语义指令时，
 * 交给这里走真正的生成模型。
 *
 * 设计要点：
 *  - Provider 抽象：本地 `mock`（dev/CI 无 key 可用）+ 远端 `fal`（fal.run 上托管的 img2img/inpainting 模型）。
 *  - 默认 `mock`，避免缺 key 时整个编辑链路挂掉；生产设 `GENERATIVE_PROVIDER=fal` + `FAL_KEY` 即切真模型。
 *  - 每意图一套 prompt 模板，把"人话意图"翻译成模型能懂的英文指令；用户原话会作为补充。
 *  - 每个语义意图映射到不同的 fal 专用模型（见 `FAL_MODELS`）：背景/换材质/改色/加物体用 Kontext 编辑类，
 *    去物/改字用 Kontext [max]，换风格走 img2img，扩图走 outpaint，高清修复走 esrgan；请求体按模型形态自动组装。
 *  - 与 photoshop 命令链无关：这里是"生成"，返回一张新 PNG；保真校验对生成结果只做轻量结构体检（不阻断）。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type GenerativeIntent =
  | "swap_background"
  | "change_material"
  | "remove_object"
  | "change_object_color"
  | "style_transfer"
  | "extend_image"
  | (string & {}); // 允许未知意图透传（由 prompt 兜底）

export interface GenerativeRequest {
  /** 路由判出的语义意图 */
  intent: GenerativeIntent;
  /** 原图 PNG base64（无 data: 前缀） */
  imageBase64: string;
  /** 用户原话或补充描述，拼到 prompt 后 */
  prompt?: string;
  /** 可选局部重生成遮罩 PNG base64（inpainting 用） */
  maskBase64?: string;
  /** 透传给模型的额外参数（model-specific） */
  params?: Record<string, unknown>;
}

export interface GenerativeResult {
  ok: boolean;
  error?: string;
  /** 结果 PNG base64（无前缀） */
  imageBase64?: string;
  provider?: string;
  model?: string;
  costUsd?: number;
  ms?: number;
}

export interface GenerativeProvider {
  readonly name: string;
  edit(req: GenerativeRequest): Promise<GenerativeResult>;
}

/** 每意图的 prompt 模板：{p} 会被用户原话（如有）替换拼接 */
const PROMPT_TEMPLATES: Record<string, string> = {
  swap_background:
    "Replace the background of this product photo with a clean, seamless studio backdrop, keep the product subject exactly as-is with professional e-commerce lighting. {p}",
  change_material:
    "Change the material of the product to the requested material while preserving its exact shape, proportions and lighting; photorealistic. {p}",
  remove_object:
    "Remove the specified object from this image and inpaint the area naturally, keeping everything else unchanged. {p}",
  change_object_color:
    "Recolour the product body to the requested colour, keep material texture and lighting consistent. {p}",
  style_transfer:
    "Apply the requested visual style to this product photo while keeping the product itself intact. {p}",
  extend_image:
    "Outpaint / extend this image seamlessly, continuing the background and perspective naturally. {p}",
  upscale:
    "Upscale and enhance this product photo to higher resolution, restore detail and sharpness, keep it photorealistic and the product intact. {p}",
  add_object:
    "Add the requested object into this product photo naturally, matching the scene's lighting and perspective, keep the original product unchanged. {p}",
  change_text:
    "Replace the text or label in this image with the requested content, keep the original font style and layout, change nothing else. {p}",
};

function buildPrompt(intent: GenerativeIntent, userPrompt?: string): string {
  const tmpl =
    PROMPT_TEMPLATES[intent] ??
    "Edit this image according to the request, keep the product intact. {p}";
  const p = userPrompt?.trim() ? `User request: ${userPrompt.trim()}` : "";
  return tmpl.replace("{p}", p).trim();
}

/** 自带临时文件（不依赖 pc.ts，避免生成后端与 PhotoCraft 封装耦合） */
function tempFile(ext: string): string {
  return path.join(os.tmpdir(), `surepix-gen-${crypto.randomUUID()}.${ext}`);
}

/** 从 fal 多种返回形态里抽出图片 URL（data URL 或 http(s) URL） */
function extractImageUrl(data: Record<string, unknown>): string | null {
  const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const firstUrl = (v: unknown): string | null => {
    if (Array.isArray(v) && v.length > 0) {
      const item = v[0] as Record<string, unknown> | string;
      if (typeof item === "string") return item;
      if (item && typeof item === "object")
        return (
          asStr((item as Record<string, unknown>).url) ??
          asStr((item as Record<string, unknown>).image_url)
        );
    }
    return null;
  };
  return (
    asStr(data.image_url) ??
    firstUrl(data.images) ??
    firstUrl((data as Record<string, unknown>).data) ??
    asStr((data as Record<string, unknown>).image) ??
    null
  );
}

/** 不同 fal 模型接受的请求形态差异很大，这里统一抽象为 5 类 */
type FalShape = "img2img" | "edit" | "upscale" | "inpaint" | "outpaint";

interface FalModelSpec {
  /** fal 模型 slug，如 fal-ai/flux-pro/kontext */
  model: string;
  /** 该模型接受的请求形态 */
  shape: FalShape;
  /** 单次调用成本（美元），用于 meta 统计；缺省读 GENERATIVE_COST_USD */
  costUsd?: number;
}

/**
 * 按语义意图映射不同的 fal 专用模型。
 *  - 背景替换 / 换材质 / 改色 / 加物体：FLUX Kontext（擅长"局部精准编辑、不动其余"）
 *  - 去物体 / 改文字：FLUX Kontext [max]（typography 与擦除更强）
 *  - 换风格：FLUX.1 dev image-to-image（img2img）
 *  - 扩图：FLUX.2 Pro Outpaint（outpaint）
 *  - 高清修复：Real-ESRGAN（upscale，无 prompt）
 * 未知意图回退到全局 GENERATIVE_MODEL（默认 FLUX dev img2img）。
 */
const FAL_MODELS: Record<string, FalModelSpec> = {
  swap_background: { model: "fal-ai/flux-pro/kontext", shape: "edit" },
  change_material: { model: "fal-ai/flux-pro/kontext", shape: "edit" },
  change_object_color: { model: "fal-ai/flux-pro/kontext", shape: "edit" },
  add_object: { model: "fal-ai/flux-pro/kontext", shape: "edit" },
  remove_object: { model: "fal-ai/flux-pro/kontext/max", shape: "edit" },
  change_text: { model: "fal-ai/flux-pro/kontext/max", shape: "edit" },
  style_transfer: { model: "fal-ai/flux/dev/image-to-image", shape: "img2img" },
  extend_image: { model: "fal-ai/flux-2-pro/outpaint", shape: "outpaint" },
  upscale: { model: "fal-ai/real-esrgan", shape: "upscale", costUsd: 0.005 },
};

const DEFAULT_COST_USD = 0.02;

/** 允许通过 FAL_MODELS_JSON 环境变量整体覆盖/扩展映射（无需改代码） */
function loadModelMap(): Record<string, FalModelSpec> {
  const raw = process.env.FAL_MODELS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, FalModelSpec>;
      return { ...FAL_MODELS, ...parsed };
    } catch {
      // 解析失败则忽略，沿用内置映射
    }
  }
  return FAL_MODELS;
}

/** 解析某意图对应的模型 spec；未知意图回退到全局 GENERATIVE_MODEL（默认 img2img 形态） */
export function resolveFalSpec(intent: GenerativeIntent): FalModelSpec {
  const spec = loadModelMap()[intent];
  if (spec) return spec;
  return {
    model: process.env.GENERATIVE_MODEL || "fal-ai/flux/dev/image-to-image",
    shape: (process.env.FAL_SHAPE as FalShape) || "img2img",
  };
}

/** 按模型形态组装请求体（mask / 专属参数通过 req.params 透传覆盖） */
function buildFalBody(req: GenerativeRequest, spec: FalModelSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {
    image_url: `data:image/png;base64,${req.imageBase64}`,
  };
  // upscale 类模型不需要 prompt（real-esrgan 只看图）
  if (spec.shape !== "upscale") {
    body.prompt = buildPrompt(req.intent, req.prompt);
  }
  if (req.maskBase64) {
    body.mask_url = `data:image/png;base64,${req.maskBase64}`;
  }
  if (spec.shape === "img2img" || spec.shape === "edit") {
    body.num_images = 1;
  }
  if (spec.shape === "upscale") {
    body.scale = 4; // 可由 req.params.scale 覆盖
  }
  if (spec.shape === "outpaint") {
    // 默认四边各扩 128px，可由 req.params 的 left/right/top/bottom 覆盖
    body.left = 128;
    body.right = 128;
    body.top = 128;
    body.bottom = 128;
  }
  // 模型专属参数最后赋值，允许覆盖上述默认值
  Object.assign(body, req.params || {});
  return body;
}

/** fal.run 真实实现：按意图选择专用模型，组装对应形态的请求体 */
class FalProvider implements GenerativeProvider {
  readonly name = "fal";
  private key: string;
  private baseUrl: string;

  constructor() {
    this.key = process.env.FAL_KEY || "";
    this.baseUrl = (process.env.FAL_BASE_URL || "https://fal.run").replace(/\/$/, "");
    if (!this.key) {
      throw new Error("FAL_KEY is required when GENERATIVE_PROVIDER=fal");
    }
  }

  async edit(req: GenerativeRequest): Promise<GenerativeResult> {
    const t0 = Date.now();
    const spec = resolveFalSpec(req.intent);
    const url = `${this.baseUrl}/${spec.model}`;
    const body = buildFalBody(req, spec);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Key ${this.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `fal ${res.status}: ${text.slice(0, 300)}`,
        provider: this.name,
        model: spec.model,
        ms: Date.now() - t0,
      };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const imgUrl = extractImageUrl(data);
    if (!imgUrl) {
      return {
        ok: false,
        error: `fal: no image url in response (keys: ${Object.keys(data).join(",")})`,
        provider: this.name,
        model: spec.model,
        ms: Date.now() - t0,
      };
    }
    // 直接返回 data URL 时无需二次下载
    if (imgUrl.startsWith("data:")) {
      const buf = Buffer.from(imgUrl.split(",")[1] || "", "base64");
      return {
        ok: true,
        imageBase64: buf.toString("base64"),
        provider: this.name,
        model: spec.model,
        costUsd: spec.costUsd ?? Number(process.env.GENERATIVE_COST_USD || DEFAULT_COST_USD),
        ms: Date.now() - t0,
      };
    }
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      return {
        ok: false,
        error: `fal: failed to download result (${imgRes.status})`,
        provider: this.name,
        model: spec.model,
        ms: Date.now() - t0,
      };
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return {
      ok: true,
      imageBase64: buf.toString("base64"),
      provider: this.name,
      model: spec.model,
      costUsd: spec.costUsd ?? Number(process.env.GENERATIVE_COST_USD || DEFAULT_COST_USD),
      ms: Date.now() - t0,
    };
  }
}

/** 本地占位实现：原样返回输入图，仅用于 dev / CI 验证路由与管线打通，不产生真实生成 */
class MockProvider implements GenerativeProvider {
  readonly name = "mock";

  async edit(req: GenerativeRequest): Promise<GenerativeResult> {
    const t0 = Date.now();
    // 轻微变换以证明"确实经过了生成路径"：把意图映射到的 fal 模型名写进 model 字段，
    // 这样无需真实 key 也能验证"按意图选模型"这条逻辑（dev / CI 用）。
    const spec = resolveFalSpec(req.intent);
    const out = tempFile("png");
    try {
      const buf = Buffer.from(req.imageBase64, "base64");
      fs.writeFileSync(out, buf); // 占位：真实场景此处为模型输出
      const result = fs.readFileSync(out);
      return {
        ok: true,
        imageBase64: result.toString("base64"),
        provider: this.name,
        model: `mock:${spec.model}`,
        costUsd: 0,
        ms: Date.now() - t0,
      };
    } finally {
      fs.rmSync(out, { force: true });
    }
  }
}

let cached: GenerativeProvider | null = null;

/** 按 env 选择 provider：默认 mock（无 key 也不挂），生产设 fal + FAL_KEY */
export function getProvider(): GenerativeProvider {
  if (cached) return cached;
  const kind = (process.env.GENERATIVE_PROVIDER || "mock").toLowerCase();
  cached = kind === "fal" ? new FalProvider() : new MockProvider();
  return cached;
}

/**
 * 高层入口：路由层把语义意图 + 原图交给这里。
 * 返回合法 PNG base64（失败时在 error 里说明）。
 */
export async function runGenerative(
  intent: GenerativeIntent,
  imageBase64: string,
  userPrompt?: string,
  opts?: { maskBase64?: string; params?: Record<string, unknown> },
): Promise<GenerativeResult> {
  const provider = getProvider();
  try {
    return await provider.edit({
      intent,
      imageBase64,
      prompt: userPrompt,
      maskBase64: opts?.maskBase64,
      params: opts?.params,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, provider: provider.name };
  }
}
