/**
 * 属性依赖推理引擎
 *
 * 为什么需要：VISTA 开源 schema 只有孤立的属性表，没有属性之间的摄影常识。
 * 实测：句子写"夕阳下奔跑"，environment.timeofday=sunset 选对了，
 * 但 lighting.temperature 还是 neutral —— 画面逻辑自相矛盾。
 * 这里把 "sunset → 暖色温" 这类摄影常识显式化成规则。
 *
 * 红线：绝不动用户已选（target.source === "user" 一律跳过）。只做两件事：
 *   1. 重排候选顺序（把更合理的顶到前面，用户仍可改选）
 *   2. 给空 value 补默认值（且默认值必须已在候选里，不臆造）
 */

import type { VistaGroup, VistaTree } from "./vista";

export interface AttributeDepRule {
  /** 触发条件：某属性的当前值命中 pattern */
  when: { group: VistaGroup; key: string; pattern: RegExp };
  /** 联动：把哪些属性的哪些值提到候选最前（兼作空 value 的默认填充） */
  boost: Record<string, string[]>;
  /** 规则意图，便于调试与埋点 */
  note: string;
}

export const ATTRIBUTE_DEP_RULES: readonly AttributeDepRule[] = [
  {
    when: { group: "environment", key: "timeofday", pattern: /sunset|golden hour|dusk/i },
    boost: {
      "lighting.temperature": ["warm"],
      "lighting.color": ["golden", "amber"],
    },
    note: "夕阳/黄金时刻 → 暖色温 + 金/琥珀光色",
  },
  {
    when: { group: "environment", key: "timeofday", pattern: /\bnight\b/i },
    boost: {
      "lighting.type": ["neon", "practical lamps"],
      "lighting.color": ["blue"],
    },
    note: "夜晚 → 霓虹/实用光源 + 冷蓝光",
  },
  {
    when: { group: "environment", key: "timeofday", pattern: /noon|midday/i },
    boost: {
      "lighting.direction": ["top light"],
      "lighting.intensity": ["strong", "harsh"],
    },
    note: "正午 → 顶光 + 强光",
  },
  {
    when: { group: "environment", key: "weather", pattern: /rainy|overcast|foggy|cloudy|snowy/i },
    boost: {
      "lighting.contrast": ["low contrast"],
      "lighting.softness": ["very soft"],
    },
    note: "雨雪阴晴 → 低对比 + 柔光",
  },
  {
    when: { group: "character", key: "pose", pattern: /running|jumping|chasing/i },
    boost: {
      "composition.motion_blur": ["subtle", "strong"],
    },
    note: "奔跑/跳跃/追逐 → 带动态模糊",
  },
  {
    when: { group: "composition", key: "framing", pattern: /close-up/i },
    boost: {
      "lighting.direction": ["front light", "side light", "rim light"],
    },
    note: "特写 → 人像布光（正面/侧光/轮廓光）",
  },
];

/** 把 preferred 里的值提到 list 最前；不在 list 中的忽略，其余保持原相对顺序（稳定） */
export function preferValues(list: string[], preferred: string[]): string[] {
  const head = preferred.filter((p) => list.includes(p));
  const rest = list.filter((v) => !head.includes(v));
  return [...head, ...rest];
}

/**
 * 应用全部依赖规则，返回被调整的属性 id（便于埋点/调试）。
 * 触发属性自身为空值时不触发；目标属性为用户已选时跳过。
 */
export function applyAttributeDeps(tree: VistaTree): string[] {
  const adjusted: string[] = [];
  for (const rule of ATTRIBUTE_DEP_RULES) {
    const triggerValue = tree[rule.when.group]?.[rule.when.key]?.value ?? "";
    if (triggerValue === "" || !rule.when.pattern.test(triggerValue)) continue;

    for (const [attrId, preferred] of Object.entries(rule.boost)) {
      const [group, key] = attrId.split(".") as [VistaGroup, string];
      const target = tree[group]?.[key];
      // 红线：用户显式选择过的一律不动
      if (!target || target.source === "user") continue;

      const beforeCandidates = target.candidates.join("");
      const beforeValue = target.value;
      target.candidates = preferValues(target.candidates, preferred);
      // 空值补默认：只补"已在候选里"的首选值，绝不臆造候选外的词
      if (target.value.trim() === "" && preferred.length > 0) {
        const fill = preferred.find((p) => target.candidates.includes(p));
        if (fill) target.value = fill;
      }
      if (target.candidates.join("") !== beforeCandidates || target.value !== beforeValue) {
        adjusted.push(attrId);
      }
    }
  }
  return adjusted;
}
