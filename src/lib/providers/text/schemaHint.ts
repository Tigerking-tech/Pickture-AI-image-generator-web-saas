/**
 * VISTA schema 提示（拆句用的紧凑描述）。
 * 抽成共享模块，避免 OpenAI / OpenRouter 等各 provider 重复定义。
 *
 * 候选数分层（2026-10-23 性能修复）：
 *   曾让所有属性一律出 9 个候选，一次拆解输出 117 个候选、耗时 ~47s，
 *   手机端经代理直接超时（Failed to fetch）。实际上只有"出图选"（visual）
 *   的属性需要 9 个候选（一张 3x3 网格一次调用），文字/自动属性给 3/1 个足够。
 *   另外 camera 组的器材参数（镜头/光圈/ISO 等）对消费级场景没意义，
 *   除非用户明说，否则整组跳过 —— 这一项就砍掉一半输出量。
 */
import { ATTRIBUTE_MODES } from "@/lib/elementConfig";
import { VISTA_ATTRIBUTES } from "@/lib/vista";

/** 各决策模式需要的候选数量：visual 出图选 / text 文字选 / auto 自动定 */
const CANDIDATES_BY_MODE: Record<string, number> = {
  visual: 9,
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
 */
export function buildSchemaHint(onlyGroups?: string[]): string {
  const filter = onlyGroups && onlyGroups.length > 0 ? new Set(onlyGroups) : null;
  const groups = new Map<string, string[]>();
  for (const a of VISTA_ATTRIBUTES) {
    if (SKIPPED_GROUPS.has(a.group)) continue;
    if (filter && !filter.has(a.group)) continue;
    if (!groups.has(a.group)) groups.set(a.group, []);
    const pool = a.pool.length > 0 ? ` [${a.pool.join("|")}]` : "";
    groups.get(a.group)!.push(`${a.key}${pool}{${candidatesFor(a.group, a.key)}}`);
  }
  const lines = [...groups.entries()].map(([g, keys]) => `${g}: ${keys.join("; ")}`).join("\n");
  return `${lines}

Candidate count rules (MANDATORY): the number in {n} after each attribute is EXACTLY how many candidates to output for it — {9} means 9, {3} means 3, {1} means 1. Do not give more or fewer.`;
}
