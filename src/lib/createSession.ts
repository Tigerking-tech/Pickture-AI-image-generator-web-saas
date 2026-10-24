/**
 * 创作会话的 sessionStorage 持久化（P0-3）
 *
 * 为什么需要：创作页所有状态（树/候选图/已选/终图）都是内存态，
 * 刷新即丢 —— 7 个节点的长流程一次误刷新就前功尽弃。
 * 用 sessionStorage 而非 localStorage：语义是"一次创作会话"，
 * 关掉标签页自动清空，不在公共电脑上留内容尾巴。
 *
 * 本文件只做纯序列化/解析，不碰 window，保证可在 Node 单测中运行。
 * 存储内容属于外部输入（用户可改），解析时必须做防御性校验。
 */

import { VISTA_GROUPS, type VistaTree } from "./vista";

export const CREATE_SESSION_KEY = "pictory:create:v1";
export const CREATE_SESSION_VERSION = 1;

/** 需要跨刷新保留的创作页状态（loading/error/progress 等瞬态不在其列） */
export interface CreateSessionSnapshot {
  sentence: string;
  tree: VistaTree | null;
  nodeImages: Record<string, string[]>;
  picked: Record<string, string>;
  pickedImageUrl: string | null;
  finalImage: string | null;
  /** 飞轮会话 id：恢复时沿用同一个，保证刷新前后的选择能串起来 */
  sessionId: string;
  regenCount: Record<string, number>;
}

export function serializeSession(snapshot: CreateSessionSnapshot): string {
  return JSON.stringify({ v: CREATE_SESSION_VERSION, ...snapshot });
}

/**
 * 解析存档；任何字段形状不符或版本不匹配都返回 null（静默丢弃），
 * 绝不让一份坏存档把创作页搞崩。
 */
export function parseSession(raw: string | null): CreateSessionSnapshot | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  if (d.v !== CREATE_SESSION_VERSION) return null;
  if (typeof d.sentence !== "string") return null;
  if (typeof d.sessionId !== "string" || d.sessionId === "") return null;
  if (!isVistaTreeLike(d.tree)) return null;
  if (!isStringArrayMap(d.nodeImages)) return null;
  if (!isStringMap(d.picked)) return null;
  if (!isNumberMap(d.regenCount)) return null;
  if (d.pickedImageUrl !== null && typeof d.pickedImageUrl !== "string") return null;
  if (d.finalImage !== null && typeof d.finalImage !== "string") return null;

  return {
    sentence: d.sentence,
    tree: d.tree,
    nodeImages: d.nodeImages,
    picked: d.picked,
    pickedImageUrl: d.pickedImageUrl,
    finalImage: d.finalImage,
    sessionId: d.sessionId,
    regenCount: d.regenCount,
  };
}

/** 轻量校验：VistaTree 必须 8 个分组齐全（分组是必填键，缺了就不是合法树） */
function isVistaTreeLike(tree: unknown): tree is VistaTree | null {
  if (tree === null) return true;
  if (typeof tree !== "object") return false;
  const t = tree as Record<string, unknown>;
  return VISTA_GROUPS.every((g) => typeof t[g] === "object" && t[g] !== null);
}

function isStringMap(v: unknown): v is Record<string, string> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((x) => typeof x === "string");
}

function isNumberMap(v: unknown): v is Record<string, number> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((x) => typeof x === "number");
}

function isStringArrayMap(v: unknown): v is Record<string, string[]> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.values(v).every(
    (arr) => Array.isArray(arr) && arr.every((x) => typeof x === "string"),
  );
}
