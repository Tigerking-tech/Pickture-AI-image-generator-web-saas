/**
 * 数据飞轮 · 学习点 B：全局候选重排
 *
 * 为什么需要：学习点 A（埋点）攒下的 selections 数据一直只进不出。
 * 这里把它用起来：某属性的候选被历史用户选中次数越多，排得越前 ——
 * 候选排序随使用量自动变好。竞品抄 UI 容易，抄不走这份积累。
 *
 * 冷启动保护：属性累计样本 < MIN_PICKS_PER_ATTR 时不重排
 * （小样本会把噪声放大成偏见）。
 * 红线：只动 candidates 顺序，绝不动 value（当前值是 LLM/用户定的，
 * 不能被统计掀翻）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VistaGroup, VistaTree } from "./vista";

/** 属性至少攒够这么多次被选中才启用重排 */
export const MIN_PICKS_PER_ATTR = 20;
/** 单次拉取上限：够统计用，又不至于拖慢拆解主流程 */
const READ_LIMIT = 5000;

/** nodeAttr → (candidateValue → 被选次数) */
export type PickStats = Map<string, Map<string, number>>;

/**
 * 按历史被选次数降序重排；次数相同保持原顺序（稳定排序）；
 * 全部无统计则原样返回。
 */
export function rerankCandidates(candidates: string[], stats: Map<string, number>): string[] {
  if (candidates.length < 2) return candidates;
  const counts = candidates.map((c) => stats.get(c) ?? 0);
  if (counts.every((n) => n === 0)) return candidates;
  return candidates
    .map((c, i) => ({ c, i, n: counts[i] }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.c);
}

/**
 * 对整棵树应用全局重排，返回被重排的属性 id。
 * 只处理样本量达标的属性；value 字段一律不动。
 */
export function applyGlobalRerank(tree: VistaTree, stats: PickStats): string[] {
  const reranked: string[] = [];
  for (const [nodeAttr, valueStats] of stats) {
    const total = [...valueStats.values()].reduce((s, n) => s + n, 0);
    if (total < MIN_PICKS_PER_ATTR) continue;
    const [group, key] = nodeAttr.split(".") as [VistaGroup, string];
    const attr = tree[group]?.[key];
    if (!attr || !Array.isArray(attr.candidates)) continue;
    const next = rerankCandidates(attr.candidates, valueStats);
    if (next.join("") !== attr.candidates.join("")) {
      attr.candidates = next;
      reranked.push(nodeAttr);
    }
  }
  return reranked;
}

/**
 * 拉取指定属性的历史选中统计。
 * 任何失败都静默返回空 Map —— 飞轮是增强项，绝不能拖垮拆解主流程。
 */
export async function fetchPickStats(
  db: Pick<SupabaseClient, "from">,
  nodeAttrs: string[],
): Promise<PickStats> {
  const stats: PickStats = new Map();
  if (nodeAttrs.length === 0) return stats;
  try {
    const { data, error } = await db
      .from("selections")
      .select("node_attr, candidate_value")
      .eq("event", "pick")
      .eq("was_picked", true)
      .in("node_attr", nodeAttrs)
      .limit(READ_LIMIT);
    if (error || !data) return stats;
    for (const row of data as Array<{ node_attr: string; candidate_value: string | null }>) {
      if (!row.candidate_value) continue;
      let m = stats.get(row.node_attr);
      if (!m) {
        m = new Map();
        stats.set(row.node_attr, m);
      }
      m.set(row.candidate_value, (m.get(row.candidate_value) ?? 0) + 1);
    }
  } catch {
    // 静默：统计拉不到就按原始顺序走
  }
  return stats;
}
