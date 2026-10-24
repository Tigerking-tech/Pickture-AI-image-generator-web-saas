/**
 * 候选多样性补齐
 *
 * 为什么需要：ensureVisualCandidates 原来从属性 pool 顺序填充，LLM 给了
 * running 就顺次补 standing/walking —— 同一词族挤在一起，4 张候选图视觉
 * 差异极小，用户等于没选。这里用贪心 max-min：每一步都挑"与已选集合
 * 最不相似"的候选补上。
 *
 * 相似度信号（纯本地、零模型成本）：
 *   1. Jaccard：词元集合交并比，抓 "golden hour" vs "golden sunset" 这类重叠
 *   2. 词缀形态学：running/standing 这类单词候选词元不重叠，用共享词缀兜底
 * 决胜项：相似度并列时，挑在 pool 中下标离已选成员最远的项
 *   （pool 顺序大体按语义族群排，离得远 ≈ 不同族）。
 */

/** 词元化：小写后按非字母数字（保留 /）切分，去空串 */
function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9/]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );
}

/** Jaccard 相似度：|A∩B| / |A∪B|；任一边为空视为 0（拿不到信号） */
export function jaccardSimilarity(a: string, b: string): number {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
  }
  return inter / (ta.size + tb.size - inter);
}

/**
 * 形态学相似度：单词候选（running/standing/walking）没有词元重叠，
 * Jaccard 全为 0、拿不到任何信号 —— 但共享 ≥3 字符词缀（-ing、-ly 等）
 * 的词往往属于同一词族，视觉差异也小。命中返回 0.5，否则 0。
 */
function morphologicalSimilarity(a: string, b: string): number {
  const wa = a
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/);
  const wb = b
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/);
  for (const x of wa) {
    for (const y of wb) {
      if (x.length < 4 || y.length < 4 || x === y) continue;
      for (let len = 4; len <= Math.min(x.length, y.length); len++) {
        if (x.slice(-len) === y.slice(-len) || x.slice(0, len) === y.slice(0, len)) {
          return 0.5;
        }
      }
    }
  }
  return 0;
}

/** 候选相似度：取两种信号的最大值 */
export function candidateSimilarity(a: string, b: string): number {
  return Math.max(jaccardSimilarity(a, b), morphologicalSimilarity(a, b));
}

/**
 * 贪心 max-min 补齐：把 selected 补到 target 个，补充项来自 pool。
 *
 * 每轮从 pool 剩余项里挑：
 *   1. 与已选集合的最大相似度最小（离已选最远者优先）
 *   2. 并列时挑 pool 下标离已选成员最远的
 * selected 里已有的值（LLM 给的判断）原样保留在最前，不重复、不打乱。
 */
export function diversifyFill(
  selected: string[],
  pool: readonly string[],
  target: number,
): string[] {
  const out = [...selected];
  const remaining = pool.filter((p) => !out.includes(p));
  while (out.length < target && remaining.length > 0) {
    let bestIdx = 0;
    let bestSim = Number.POSITIVE_INFINITY;
    let bestDist = -1;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      // 亲密度取最大值：跟任何一个已选撞车都算撞车
      const sim = out.reduce((m, s) => Math.max(m, candidateSimilarity(cand, s)), 0);
      // 决胜：在 pool 中与最近已选成员的下标距离，越大越远
      const poolIdx = pool.indexOf(cand);
      const dist = out.reduce((m, s) => {
        const si = pool.indexOf(s);
        return si < 0 ? m : Math.min(m, Math.abs(poolIdx - si));
      }, Number.POSITIVE_INFINITY);
      if (sim < bestSim || (sim === bestSim && dist > bestDist)) {
        bestSim = sim;
        bestDist = dist;
        bestIdx = i;
      }
    }
    out.push(remaining.splice(bestIdx, 1)[0]);
  }
  return out;
}
