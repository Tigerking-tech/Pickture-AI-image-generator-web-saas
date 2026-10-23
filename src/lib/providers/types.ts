/**
 * 提供方抽象层（PRD 架构原则：API 可替换，按成本随时切换供应商）
 *
 * 设计目标：业务路由只依赖这两个接口，绝不写死任何供应商的 URL / 密钥。
 * 切换供应商 = 改一个环境变量（IMAGE_PROVIDER / TEXT_PROVIDER）+ Redeploy，
 * 不需要改路由代码。新增供应商 = 加一个实现文件 + 在 index.ts 注册一行。
 */

/** 单张图生成请求参数（供应商中立） */
export interface ImageGenRequest {
  /** 已渲染好的完整 prompt（英文） */
  prompt: string;
  /** 来自 modelRouter 的模型标识（fal-ai/flux/schnell 等） */
  model: string;
  /** 出图数量，默认 1 */
  numImages?: number;
  /** 尺寸提示，默认 "square_hd" */
  size?: string;
  /**
   * 可选：参考图 URL（服务端可访问）。用于"控制变量"——
   * 用户在前序节点选中的图作为主体锚，后续节点只变一个要素。
   * 支持图生图的 provider（阿里）会取图转 base64 传入；不支持的忽略。
   */
  referenceUrl?: string;
}

/**
 * 出图结果。
 * `model` 由 provider 回填**实际使用的模型** —— 不能沿用 modelRouter 里写死的
 * fal 模型名：实测（2026-10-23）切到阿里后，响应仍报 fal-ai/flux-pro/v1.1，
 * 而图其实是 qwen/wan 生成的，C2PA 溯源（R10）会因此失真。
 */
export type ImageGenResult =
  | { ok: true; urls: string[]; model?: string }
  | { ok: false; status: number; detail: string };

export interface ImageProvider {
  /** 标识，用于日志 / 调试 */
  readonly name: string;
  /** 该 provider 是否已在环境变量中配置好密钥 */
  isConfigured(): boolean;
  /** 未配置时的明确报错信息（不静默降级、不伪造输出） */
  missingKeyMessage(): string;
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
  /**
   * 可选能力：一次调用画出一张 N 格网格图（req.prompt 已是构造好的网格提示词）。
   * 用于把一个决策节点的 N 个候选压成 1 次 API 调用，再由调用方按坐标切割。
   * 不支持网格的 provider（如 fal）不实现此方法，调用方自动回退逐张生成。
   */
  generateGrid?(req: ImageGenRequest): Promise<ImageGenResult>;
}

/** 文本拆句请求参数（供应商中立） */
export interface TextDecomposeRequest {
  /** 用户输入的一句话 */
  sentence: string;
  /** 可选参考图 URL（多模态拆句用） */
  imageUrl?: string;
  /** 来自 modelRouter 的模型标识（如 gpt-4o-mini） */
  model: string;
  /**
   * 可选：只拆指定分组时传入该分组的 schema 提示。
   * 用于"分批拆解"——把一次大输出拆成几次小输出并行调用，降低单次耗时。
   * 不传则使用完整 schema。
   */
  schemaHint?: string;
}

export type TextResult =
  | { ok: true; content: string }
  | { ok: false; status: number; detail: string };

export interface TextProvider {
  readonly name: string;
  isConfigured(): boolean;
  missingKeyMessage(): string;
  decompose(req: TextDecomposeRequest): Promise<TextResult>;
  /**
   * 可选能力：流式拆解。每收到一段增量文本就回调 onDelta，
   * 用于把生成过程实时推给前端（SSE），避免长请求被中间代理判为超时。
   * 不支持流式的 provider 不实现此方法，调用方回退到普通 decompose。
   */
  decomposeStream?(req: TextDecomposeRequest, onDelta: (text: string) => void): Promise<TextResult>;
}
