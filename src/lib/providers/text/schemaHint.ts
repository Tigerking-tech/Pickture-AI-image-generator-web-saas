/**
 * VISTA schema 提示（拆句用的紧凑描述）。
 * 抽成共享模块，避免 OpenAI / OpenRouter 等各 provider 重复定义。
 *
 * 候选数分层（2026-10-23 性能 + 成本双修复）：
 *   曾让所有属性一律出 9 个候选，一次拆解输出 117 个候选、耗时 ~47s，
 *   手机端经代理直接超时（Failed to fetch）。实际上只有"出图选"（visual）
 *   的属性需要多个候选，文字/自动属性给 3/1 个足够。
 *   另外 camera 组的器材参数（镜头/光圈/ISO 等）对消费级场景没意义，
 *   除非用户明说，否则整组跳过 —— 这一项就砍掉一半输出量。
 */
import { ATTRIBUTE_MODES, CANDIDATE_DEFAULT } from "@/lib/elementConfig";
import { VISTA_ATTRIBUTES } from "@/lib/vista";

/**
 * 各决策模式需要的候选数量：visual 出图选 / text 文字选 / auto 自动定。
 *
 * visual 直接绑定 CANDIDATE_DEFAULT（当前 4），与 UI 实际展示/生图的数量一致：
 * 之前写死 9，模型老老实实吐 9 个，而前端只用前 4 个 —— 多出来的 5 个
 * 纯属浪费输出 token（实测拆解从 64s 涨到 109s），且逼得补齐逻辑去凑修饰词。
 */
const CANDIDATES_BY_MODE: Record<string, number> = {
  visual: CANDIDATE_DEFAULT,
  text: 3,
  auto: 1,
};

/** 无明确 mode 时的默认候选数 */
const DEFAULT_CANDIDATES = 3;

/**
 * 整组跳过的属性：camera 器材参数（机身/镜头/光圈/ISO/快门）对消费级场景
 * 几乎没有意义，却曾占一次拆解输出的一半以上（6 属性 × 9 候选）。
 * 直接不写进 schema 提示，模型就不会填 —— 比用规则"劝"它跳过可靠得多。
 */
const SKIPPED_GROUPS = new Set(["camera"]);

function candidatesFor(group: string, key: string): number {
  return CANDIDATES_BY_MODE[ATTRIBUTE_MODES[`${group}.${key}`] ?? ""] ?? DEFAULT_CANDIDATES;
}

/**
 * @param onlyGroups 只输出这些分组（分批拆解用）。不传则输出全部。
 * @param visualCount 出图属性（visual）要求的候选数，默认 CANDIDATE_DEFAULT。
 *   付费档会传 9（3x3 网格），免费档 4（2x2 网格）—— 让模型按套餐吐对应数量，
 *   避免"要 4 个却吐 9 个"浪费输出 token（实测拆解 109s → 37.6s 主要来自这里）。
 */
export function buildSchemaHint(onlyGroups?: string[], visualCount?: number): string {
  // 模型最多只吐 3 个候选（付费档 perNode=9 也一样）：剩下的由
  // ensureVisualCandidates 从属性池补齐。这样既把输出 token 压到 1/3（拆解更快），
  // 又让用户看到的候选数量仍按套餐给足 —— 前 3 个是模型针对这句量身挑的，
  // 后面补的是该属性的标准可选项。
  const visual = Math.min(visualCount ?? CANDIDATE_DEFAULT, 2);
  const filter = onlyGroups && onlyGroups.length > 0 ? new Set(onlyGroups) : null;
  const groups = new Map<string, string[]>();
  for (const a of VISTA_ATTRIBUTES) {
    if (SKIPPED_GROUPS.has(a.group)) continue;
    if (filter && !filter.has(a.group)) continue;
    if (!groups.has(a.group)) groups.set(a.group, []);
    const pool = a.pool.length > 0 ? ` [${a.pool.join("|")}]` : "";
    const n =
      ATTRIBUTE_MODES[`${a.group}.${a.key}`] === "visual" ? visual : candidatesFor(a.group, a.key);
    groups.get(a.group)!.push(`${a.key}${pool}{${n}}`);
  }
  const lines = [...groups.entries()].map(([g, keys]) => `${g}: ${keys.join("; ")}`).join("\n");
  return `${lines}

Candidate count rules (MANDATORY): the number in {n} after each attribute is EXACTLY how many candidates to output for it — {9} means 9, {3} means 3, {1} means 1. Do not give more or fewer.`;
}
