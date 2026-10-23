/**
 * 决策树配置 —— 产品的灵魂（规格 §2）
 *
 * 职责：决定"哪些属性出图选 / 文字选 / 自动定"，以及节点出现顺序。
 * 与 vista.ts 的分工：vista.ts 只定义"有哪些属性"，本文件定义"怎么让用户决策"。
 *
 * 顺序策略（PRD §5.3）：先钉死主体与光线（对画面影响最大），再逐步细化其余属性。
 * 成本控制（PRD §9.4）：单个作品约 18 张预览图 = 6 个出图节点 × 3 张候选。
 */

import {
  type DecisionMode,
  getAttributeMeta,
  VISTA_ATTRIBUTES,
  VISTA_GROUPS,
  type VistaAttributeValue,
  type VistaGroup,
  type VistaTree,
} from "./vista";

/** 每个属性的默认决策方式 */
export const ATTRIBUTE_MODES: Record<string, DecisionMode> = {
  // --- 主体：姿态/朝向出图选（背影/视角类描述对画面影响同样大），其余文字选/自动定 ---
  "character.species": "text",
  "character.pose": "visual",
  "character.orientation": "visual",
  "character.expression": "text",
  "character.clothing": "text",
  "character.hairstyle": "text",
  "character.makeup": "auto",

  // --- 光线：光位出图选（对画面影响最大），其余文字/自动 ---
  "lighting.direction": "visual",
  "lighting.type": "text",
  "lighting.temperature": "text",
  "lighting.intensity": "auto",
  "lighting.color": "auto",
  "lighting.softness": "auto",
  "lighting.contrast": "auto",
  "lighting.shadows": "auto",

  // --- 环境：时段与天气视觉差异大，出图选 ---
  "environment.timeofday": "visual",
  "environment.weather": "visual",
  "environment.location": "text",
  "environment.setting": "text",
  "environment.outdoor": "auto",

  // --- 构图：取景出图选 ---
  "composition.framing": "visual",
  "composition.perspective": "text",
  "composition.focal_point": "auto",
  "composition.rule_of_thirds": "auto",
  "composition.motion_blur": "auto",

  // --- 镜头：太技术性，交给自动定，避免小白被参数淹没 ---
  "camera.aspect_ratio": "text",
  "camera.focal_length": "text",
  "camera.model": "auto",
  "camera.lens_type": "auto",
  "camera.fstop": "auto",
  "camera.iso": "auto",
  "camera.shutter_speed": "auto",

  // --- 风格：美学风格视觉差异明显，出图选 ---
  "style.aesthetic": "visual",
  "style.palette": "text",
  "style.lut": "auto",
  "style.year": "auto",
  "style.engine": "auto",

  // --- 效果：文字选/自动定 ---
  "effects.color_grade": "text",
  "effects.fog": "text",
  "effects.grain": "auto",
  "effects.vignette": "auto",
  "effects.glow": "auto",
  "effects.lens_flare": "auto",

  // --- 元信息 ---
  "info.name": "auto",
  "info.description": "auto",
};

/**
 * 决策树节点顺序（PRD §5.3：先主体与光线，再细化）。
 * 只有 mode === "visual" 的属性会进入此序列并生成候选图。
 */
export const DECISION_TREE_ORDER: ReadonlyArray<{ group: VistaGroup; key: string }> = [
  { group: "character", key: "pose" },
  // 朝向：与姿态同属"主体"层，视觉差异极大，且是"背影"类描述的归属地。
  // 之前虽标记为 visual 却漏在这里 —— 用户永远选不到/改不了朝向，
  // 而保真红线最在意的正是它，因此补进决策树（紧跟 pose）。
  { group: "character", key: "orientation" },
  { group: "lighting", key: "direction" },
  { group: "environment", key: "timeofday" },
  { group: "environment", key: "weather" },
  { group: "composition", key: "framing" },
  { group: "style", key: "aesthetic" },
];

/** 出图节点的候选图数量区间（R2/R3 要求 2–4 张） */
export const CANDIDATE_MIN = 2;
export const CANDIDATE_MAX = 9;
/**
 * 默认每个出图节点出 4 个候选。
 *
 * 为什么从 9 改回 4（2026-10-23 真实模型实测后修正）：
 *   1) 与对外承诺一致：落地页写的是 "each element shows 2–4 candidate images"，
 *      而 9 候选与文案自相矛盾。
 *   2) 与成本约束一致：PRD §9.4 的预算是"约 18 张预览 = 6 节点 × 3"；
 *      9 候选在网格失败回退串行时会变成 6 × 9 = 54 次真实出图调用，
 *      实测直接把免费额度烧光、终图反而出不来。
 *   3) 4 个候选正好走 2x2 网格（满格、无需补空），且所有出图属性的
 *      候选池都 ≥ 4，因此不再需要任何"凑数"逻辑。
 *
 * 网格模式下 4 候选仍是 1 次调用（2x2 网格 + 本地切割），选择面与成本兼顾。
 */
export const CANDIDATE_DEFAULT = 4;

export function getAttributeMode(group: VistaGroup, key: string): DecisionMode {
  return ATTRIBUTE_MODES[`${group}.${key}`] ?? "auto";
}

export interface DecisionNode {
  /** 形如 "environment.weather" */
  id: string;
  group: VistaGroup;
  key: string;
  label: string;
  labelEn: string;
  mode: DecisionMode;
  /** 候选值（已裁剪到 2–4 个） */
  candidates: string[];
  /** 当前选定值 */
  value: string;
  /** 是否需要出候选图 */
  needsImages: boolean;
  /** 参考图模式下是否为继承值（不需要用户重选） */
  inheritedFromImage: boolean;
}

export interface BuildDecisionTreeOptions {
  /** 参考图模式：只暴露"被改/待定"的属性（R7） */
  fromImage?: boolean;
  /** 单节点候选数上限，默认 CANDIDATE_DEFAULT */
  candidatesPerNode?: number;
}

function clampCandidates(list: string[], limit: number): string[] {
  const max = Math.min(Math.max(limit, CANDIDATE_MIN), CANDIDATE_MAX);
  if (list.length === 0) return [];
  if (list.length <= max) return [...list];
  return list.slice(0, max);
}

/**
 * 保证"出图选"（visual）属性恰好有 min 个候选。
 *
 * 为什么需要：分批拆解后，模型并不总遵守 schema 里标注的候选数
 * （实测长句时 pose/orientation 只给了 3 个，而网格需要 9 个）。
 * 补齐顺序：LLM 给的（保留其判断）→ 属性 pool 补 → 修饰变体兜底。
 * 统一到 9 还有一个原因：用户要求每个节点的宫格数量一致（8/9 混着很难看）。
 */
export function ensureVisualCandidates(tree: VistaTree, min = CANDIDATE_DEFAULT): void {
  for (const a of VISTA_ATTRIBUTES) {
    if (ATTRIBUTE_MODES[`${a.group}.${a.key}`] !== "visual") continue;
    const pool = getAttributeMeta(a.group, a.key)?.pool ?? [];

    // 第一层兜底：模型没填这个属性（实测偶发跳过 direction）→ 用 pool 默认值补全，
    // 保证所有出图节点永远存在、永远可出图
    const section = tree[a.group] ?? {};
    let attr = section[a.key] as VistaAttributeValue | undefined;
    if (!attr || typeof attr !== "object" || typeof attr.value !== "string" || attr.value === "") {
      if (pool.length === 0) continue;
      attr = { value: pool[0], candidates: [...pool], mode: "visual" };
      section[a.key] = attr;
    }
    tree[a.group] = section;
    if (!Array.isArray(attr.candidates)) attr.candidates = [];

    // 第二层兜底：候选不足时用属性池补齐（只补真实存在的可选值）。
    // 注意：这里**不再**用修饰词（playful/energetic/…）拼凑变体。
    // 实测（2026-10-23 真实模型）那样会产生 "playful clear"（天气）、
    // "graceful backlight"（光线）、"playful sunset"（时段）这种毫无语义、
    // 用户一看就觉得产品有 bug 的假候选。宁可少几个候选，也不编造。
    const merged = [...attr.candidates];
    for (const p of pool) {
      if (merged.length >= min) break;
      if (!merged.includes(p)) merged.push(p);
    }
    attr.candidates = merged;
  }
}

/**
 * 由要素树构建有序决策节点列表。
 *
 * 纯文字模式（fromImage=false）：按 DECISION_TREE_ORDER 输出全部出图节点。
 * 参考图模式（fromImage=true）：继承值（fromImage=true 且未被改动）的节点不要求用户重选，
 *   仅输出"被改动的"与"待定的（无值）"节点 —— 对应 R7。
 */
export function buildDecisionTree(
  tree: VistaTree,
  opts: BuildDecisionTreeOptions = {},
): DecisionNode[] {
  const fromImage = opts.fromImage ?? tree.meta?.fromImage ?? false;
  const perNode = opts.candidatesPerNode ?? CANDIDATE_DEFAULT;
  const nodes: DecisionNode[] = [];

  for (const { group, key } of DECISION_TREE_ORDER) {
    const attr: VistaAttributeValue | undefined = tree[group]?.[key];
    const meta = getAttributeMeta(group, key);
    if (!attr || !meta) continue;

    const changed = attr.changed === true;
    const inherited = fromImage && attr.fromImage === true && !changed;
    // 参考图模式下：被改动的（changed）与待定的（无值）需要用户决策
    const needsDecision = fromImage ? changed || attr.value.trim() === "" : true;
    if (!needsDecision) continue;

    nodes.push({
      id: `${group}.${key}`,
      group,
      key,
      label: meta.label,
      labelEn: meta.labelEn,
      mode: attr.mode ?? getAttributeMode(group, key),
      candidates: clampCandidates(attr.candidates ?? [], perNode),
      value: attr.value ?? "",
      needsImages: true,
      inheritedFromImage: inherited,
    });
  }

  return nodes;
}

/** 出图节点数 × 每节点候选数 = 预览图总量，用于成本预估（PRD §9.4） */
export function estimatePreviewCount(tree: VistaTree, opts: BuildDecisionTreeOptions = {}): number {
  return buildDecisionTree(tree, opts).reduce((sum, n) => sum + n.candidates.length, 0);
}

/**
 * 把 LLM 返回的原始属性补齐决策标记。
 * LLM 只给 value + candidates，这里统一补 mode / source，保证下游（UI、生图、埋点）拿到完整结构。
 */
export function withDefaultModes(tree: VistaTree): VistaTree {
  for (const group of VISTA_GROUPS) {
    const section = tree[group];
    if (!section) continue;
    for (const [key, attr] of Object.entries(section)) {
      if (!attr) continue;
      if (!attr.mode) attr.mode = getAttributeMode(group, key);
      if (!attr.source) attr.source = "llm";
      if (!Array.isArray(attr.candidates)) attr.candidates = [];
      if (typeof attr.value !== "string") attr.value = "";
    }
  }
  return tree;
}

/**
 * 参考图模式：标记某属性被文字指令改动（R7 要求返回 changedFields）。
 */
export function markChanged(tree: VistaTree, group: VistaGroup, key: string): string[] {
  const attr = tree[group]?.[key];
  if (!attr) return tree.meta?.changedFields ?? [];
  attr.changed = true;
  attr.source = "user";
  const id = `${group}.${key}`;
  const fields = new Set(tree.meta?.changedFields ?? []);
  fields.add(id);
  if (!tree.meta) tree.meta = { fromImage: true, changedFields: [] };
  tree.meta.changedFields = [...fields];
  tree.meta.fromImage = true;
  return tree.meta.changedFields;
}
