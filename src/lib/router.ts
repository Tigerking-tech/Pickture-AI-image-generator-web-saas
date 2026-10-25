/**
 * router.ts — Surepix 独有算法 #2：修图 vs 重生成路由 + #3：失败回退 + #4：批量质量策略
 *
 * 核心原则：确定性优先（deterministic-first）
 *  - PhotoCraft 确定性修图：~40ms/张、可逆、可批量、质量可校验 → 永远优先
 *  - AI 重生成：3-8s/张、概率性、LOGO/文字有约 1/5 变形风险 → 只在语义级改动或保真失败时兜底
 */

import { planChain, detectIntents, validateCommandChain, type ChainStep } from "./whitelist";
import type { FidelityReport } from "./fidelity";

/** 成本常量（毫秒） */
export const COST = {
  deterministicRunMs: 40,
  fidelityCheckMs: 6,
  aiRegenerateMs: 4000,
  aiRetryRisk: 0.2,
};

export type RouteKind = "photocraft" | "hybrid" | "regenerate" | "reject";

export interface RouteDecision {
  route: RouteKind;
  plan: { kind: "chain" | "hybrid" | "ai"; chain?: ChainStep[]; generative?: string[] } | null;
  reason: string;
  decision: string;
  costEstimateMs: number;
}

/** 保真校验 verdict → 路由动作 */
export function routeAfterFidelity(
  fidelityResult: FidelityReport,
  opts: { maxRepairs?: number } = {},
): { action: "accept" | "repair" | "regenerate"; reason: string; costMs: number; maxRepairs?: number; scope?: string[] } {
  const { maxRepairs = 2 } = opts;
  const verdict = fidelityResult && fidelityResult.verdict;
  if (verdict === "PASS") {
    return { action: "accept", reason: "Fidelity check passed", costMs: COST.fidelityCheckMs };
  }
  if (verdict === "REPAIR") {
    return {
      action: "repair",
      reason: `Local damage (${fidelityResult.summary.REPAIR || 0} elements REPAIR) — retry with fallback params`,
      costMs: COST.fidelityCheckMs,
      maxRepairs,
    };
  }
  return {
    action: "regenerate",
    reason: `Structural damage (${fidelityResult.summary.REGENERATE || 0} elements REGENERATE) — escalate to AI regeneration`,
    costMs: COST.aiRegenerateMs,
    scope: fidelityResult.elements
      ? Object.entries(fidelityResult.elements)
          .filter(([, v]) => v.verdict !== "PASS")
          .map(([k]) => k)
      : ["all"],
  };
}

/** 主路由：自然语言指令 → 执行计划（origW/origH 供几何模板计算 contain/pad） */
export function route(instruction: string, ctx: { protectedElements?: string[]; origW?: number; origH?: number } = {}): RouteDecision {
  const { deterministic, generative } = detectIntents(instruction);
  const protectedElements = ctx.protectedElements || [];

  if (deterministic.length > 0 && generative.length === 0) {
    const plan = planChain(instruction, ctx.origW, ctx.origH);
    if (plan.ok) {
      return {
        route: "photocraft",
        plan: { kind: "chain", chain: plan.chain },
        reason: `Deterministic intent "${plan.desc}" — PhotoCraft handles it`,
        decision: `Deterministic-first: ${COST.deterministicRunMs}ms vs AI ${COST.aiRegenerateMs}ms`,
        costEstimateMs: COST.deterministicRunMs + COST.fidelityCheckMs,
      };
    }
  }

  if (deterministic.length > 0 && generative.length > 0) {
    const plan = planChain(instruction, ctx.origW, ctx.origH);
    return {
      route: "hybrid",
      plan: {
        kind: "hybrid",
        chain: plan.ok ? plan.chain : [],
        generative: generative.map((g) => g.intent),
      },
      reason: `Mixed instruction: deterministic [${deterministic.map((d) => d.intent).join(", ")}] + semantic [${generative.map((g) => g.intent).join(", ")}]`,
      decision: "Deterministic first, AI last, fidelity-gated throughout",
      costEstimateMs: COST.deterministicRunMs + COST.aiRegenerateMs + COST.fidelityCheckMs,
    };
  }

  if (generative.length > 0) {
    const risk = protectedElements.length > 0 ? "high (protected elements — per-element fidelity check required)" : "normal";
    return {
      route: "regenerate",
      plan: { kind: "ai", generative: generative.map((g) => g.intent) },
      reason: `Semantic intent "${generative.map((g) => g.desc).join("; ")}" — beyond deterministic editing`,
      decision: `Escalate to AI regeneration, risk: ${risk}`,
      costEstimateMs: COST.aiRegenerateMs,
    };
  }

  return {
    route: "reject",
    plan: null,
    reason: "No known intent matched",
    decision: "Reject and ask — never guess",
    costEstimateMs: 0,
  };
}

/** 失败回退规划：[原链, L1 降级, L2 降级] 三级执行序列（origW/origH 供几何模板） */
export function planWithFallback(
  instruction: string,
  origW?: number,
  origH?: number,
): {
  ok: boolean;
  error?: string;
  intent?: string;
  levels?: { level: number; desc: string; chain: ChainStep[] }[];
  maxLevel?: number;
} {
  const { deterministic } = detectIntents(instruction);
  if (deterministic.length === 0) {
    return { ok: false, error: "no deterministic intent" };
  }
  const template = deterministic[0];
  const plan = planChain(instruction, origW, origH);
  if (!plan.ok) return { ok: false, error: plan.error };
  const levels = [
    { level: 0, desc: plan.desc, chain: plan.chain },
    ...(template.fallbacks || []).map((f) => ({ level: f.level, desc: f.desc, chain: f.build(plan.args) })),
  ];
  for (const lv of levels) {
    const check = validateCommandChain(lv.chain);
    if (!check.ok) {
      return { ok: false, error: `fallback L${lv.level} invalid: ${check.error}`, levels };
    }
  }
  return { ok: true, intent: template.intent, levels, maxLevel: levels.length - 1 };
}

export type BatchPolicy = "noop" | "accept_all" | "redo_individual" | "rollback_batch";

/** 批量质量策略：受损率 >10% 且 ≥2 张 → 整批回退；其余（含小批次单张）→ 只重做受损单张 */
export function batchQualityPolicy(
  fidelityResults: { verdict: string }[],
  opts: { threshold?: number } = {},
): { policy: BatchPolicy; reason: string; damaged: number[]; rate: number } {
  const { threshold = 0.1 } = opts;
  const n = fidelityResults.length;
  if (n === 0) return { policy: "noop", reason: "empty batch", damaged: [], rate: 0 };
  const damaged = fidelityResults.map((r, i) => (r.verdict !== "PASS" ? i : -1)).filter((i) => i >= 0);
  const rate = damaged.length / n;
  if (rate === 0) return { policy: "accept_all", reason: "all pass", damaged: [], rate };
  if (rate > threshold && damaged.length >= 2) {
    return {
      policy: "rollback_batch",
      reason: `${(rate * 100).toFixed(0)}% damaged (${damaged.length} images) — systematic parameter issue, rollback batch`,
      damaged,
      rate,
    };
  }
  return {
    policy: "redo_individual",
    reason: `${(rate * 100).toFixed(0)}% damaged (${damaged.length} images) — individual outliers, redo only damaged`,
    damaged,
    rate,
  };
}
