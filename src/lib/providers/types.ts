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
}

export type ImageGenResult =
  | { ok: true; urls: string[] }
  | { ok: false; status: number; detail: string };

export interface ImageProvider {
  /** 标识，用于日志 / 调试 */
  readonly name: string;
  /** 该 provider 是否已在环境变量中配置好密钥 */
  isConfigured(): boolean;
  /** 未配置时的明确报错信息（不静默降级、不伪造输出） */
  missingKeyMessage(): string;
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
}

/** 文本拆句请求参数（供应商中立） */
export interface TextDecomposeRequest {
  /** 用户输入的一句话 */
  sentence: string;
  /** 可选参考图 URL（多模态拆句用） */
  imageUrl?: string;
  /** 来自 modelRouter 的模型标识（如 gpt-4o-mini） */
  model: string;
}

export type TextResult =
  | { ok: true; content: string }
  | { ok: false; status: number; detail: string };

export interface TextProvider {
  readonly name: string;
  isConfigured(): boolean;
  missingKeyMessage(): string;
  decompose(req: TextDecomposeRequest): Promise<TextResult>;
}
