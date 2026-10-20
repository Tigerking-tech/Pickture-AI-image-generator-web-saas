/**
 * 套餐 → 模型路由（PRD §10.5 / 规格 §0.2）
 *
 * 红线：免费层用 FLUX schnell + GPT-4o-mini，付费层自动切 FLUX Pro + GPT-4o。
 * 禁止为省成本把免费层甩给"免费外部生图模型"（SDXL 自托管 / Bing 等）。
 *
 * 纯逻辑模块，无副作用，可单测。
 */

export type Plan = "free" | "starter" | "pro";

export interface ModelRoute {
  /** 拆句用 LLM：免费 mini，付费 GPT-4o（多模态，参考图模式要看图） */
  decomposeModel: string;
  /** 节点预览图模型：一律 schnell —— 18 张预览的便宜就便宜在这里 */
  previewModel: string;
  /** 终图模型 */
  finalModel: string;
  /** 免费层可体验的 Pro 终图次数（PRD §10.2：含 2 次 Pro 终图体验） */
  proTrials: number;
  /** 付费层走优先队列（PRD §10.2 Pro：优先队列） */
  priority: boolean;
  /** 免费层出图带品牌水印（PRD §10.2） */
  watermark: boolean;
  /** 月度积分额度（PRD §10.2） */
  monthlyCredits: number;
  /** 参考图上传：月度 / 每日硬上限（PRD §10.2.1） */
  refUploadMonthlyLimit: number;
  refUploadDailyLimit: number;
}

const FREE: ModelRoute = {
  decomposeModel: "gpt-4o-mini",
  previewModel: "fal-ai/flux/schnell",
  finalModel: "fal-ai/flux-pro/v1.1",
  proTrials: 2,
  priority: false,
  watermark: true,
  monthlyCredits: 60,
  refUploadMonthlyLimit: 8,
  refUploadDailyLimit: 3,
};

const STARTER: ModelRoute = {
  decomposeModel: "gpt-4o",
  previewModel: "fal-ai/flux/schnell",
  finalModel: "fal-ai/flux-pro/v1.1",
  proTrials: Number.POSITIVE_INFINITY,
  priority: false,
  watermark: false,
  monthlyCredits: 600,
  refUploadMonthlyLimit: 50,
  refUploadDailyLimit: 20,
};

const PRO: ModelRoute = {
  decomposeModel: "gpt-4o",
  previewModel: "fal-ai/flux/schnell",
  finalModel: "fal-ai/flux-pro/v1.1",
  proTrials: Number.POSITIVE_INFINITY,
  priority: true,
  watermark: false,
  monthlyCredits: 2400,
  // Pro 参考图上传不限（PRD §10.2.1），用极大值表示"不限"
  refUploadMonthlyLimit: Number.MAX_SAFE_INTEGER,
  refUploadDailyLimit: Number.MAX_SAFE_INTEGER,
};

const ROUTES: Record<Plan, ModelRoute> = {
  free: FREE,
  starter: STARTER,
  pro: PRO,
};

/** 归一化任意输入为合法套餐；未知一律降级为 free（不得臆造套餐） */
export function normalizePlan(input: unknown): Plan {
  if (typeof input !== "string") return "free";
  const v = input.trim().toLowerCase();
  if (v === "free" || v === "starter" || v === "pro") return v;
  // 兼容脚手架的 enterprise 等产品名：按付费处理但保守取 starter 权益
  if (v === "enterprise") return "pro";
  return "free";
}

export function routeForPlan(plan: unknown): ModelRoute {
  return ROUTES[normalizePlan(plan)];
}

/**
 * 是否允许使用 Pro 终图。
 * 免费层仅前 proTrials 次可用 Pro，之后降级为 schnell（不静默扣费、不静默失败）。
 */
export function resolveFinalModel(plan: unknown, proTrialsUsed: number): string {
  const route = routeForPlan(plan);
  if (Number.isFinite(route.proTrials) && proTrialsUsed >= route.proTrials) {
    return route.previewModel;
  }
  return route.finalModel;
}

/** 单个作品消耗的积分（PRD §10.2.1：纯文字与参考图模式均 10 积分/个） */
export const CREDITS_PER_WORK = 10;
