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
  VISTA_GROUPS,
  type VistaAttributeValue,
  type VistaGroup,
  type VistaTree,
} from "./vista";

/** 每个属性的默认决策方式 */
export const ATTRIBUTE_MODES: Record<string, DecisionMode> = {
  // --- 主体：姿态出图选，其余文字选/自动定 ---
  "character.species": "text",
  "character.pose": "visual",
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
  { group: "lighting", key: "direction" },
  { group: "environment", key: "timeofday" },
  { group: "environment", key: "weather" },
  { group: "composition", key: "framing" },
  { group: "style", key: "aesthetic" },
];

/** 出图节点的候选图数量区间（R2/R3 要求 2–4 张） */
export const CANDIDATE_MIN = 2;
export const CANDIDATE_MAX = 4;
/** 默认每个出图节点出 3 张（PRD §9.4：6 节点 × 3 张 = 18 图） */
export const CANDIDATE_DEFAULT = 3;

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
