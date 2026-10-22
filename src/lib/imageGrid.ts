/**
 * 网格出候选（Grid-of-candidates）
 *
 * 目的：一个决策节点本来要出 N 张候选图 = N 次 API 调用；改成
 * 「一次调用画一张 N 格网格图 + 本地按坐标切割」，成本降到 1/N。
 *
 * 为什么能行（2026-10-23 实测，z-image-turbo）：
 *   实验 1：约束只写一次、埋在长 prompt 中间 → 9 格里约 5~6 格跑偏（背影变正面）
 *   实验 2：约束置顶重复强调 + 负面约束 + 每格单独标注 → 9 格里 8 格纯背影
 * 结论：模型的"跨面板一致约束"遵循能力弱，必须靠 prompt 工程强化。
 * 因此本模块的核心就是 buildGridPrompt 的三段式写法。
 *
 * 失败处理：网格画歪时切割出的格子数/尺寸不对，由调用方回退到逐张生成，
 * 本模块只负责"如实报告"，绝不伪造图片。
 */

/** 参与网格的最小候选数（1 张没必要建网格） */
export const GRID_MIN_PANELS = 2;
/** 超过这个数就不建网格（格子太小、模型遵循更难） */
export const GRID_MAX_PANELS = 9;

export interface GridLayout {
  rows: number;
  cols: number;
}

/**
 * 按候选数选网格布局。
 * ⚠️ 实测（2026-10-23，z-image-turbo）：模型对"满格方阵"（2x2 / 3x3）的布局遵循
 * 很好，但对 1x3 这类非满格布局会自作主张画成 2x3。因此统一用满格方阵，
 * 多余的格子由 buildGridPrompt 指定为"重复最后一格"，切割后丢弃。
 */
export function gridLayoutFor(count: number): GridLayout {
  return count <= 4 ? { rows: 2, cols: 2 } : { rows: 3, cols: 3 };
}

/** 把一个候选描述拆成词元（用于求公共部分） */
function tokensOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[,.;:()\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2);
}

/**
 * 求所有候选共有的描述片段 —— 也就是"所有格子都必须保持的约束"。
 * 例如 ["a man, rooftop, night, back to camera", "a man, rooftop, night, running"]
 * 的公共部分是 "a man / rooftop / night"，差异是 "back to camera" vs "running"。
 */
export function sharedConstraintOf(candidates: string[]): string {
  if (candidates.length === 0) return "";
  const sets = candidates.map((c) => new Set(tokensOf(c)));
  const shared = [...sets[0]].filter((t) => sets.every((s) => s.has(t)));
  // 保留原句顺序（按第一个候选的出现顺序），读起来更自然
  const order = tokensOf(candidates[0]);
  const ordered = order.filter((t) => shared.includes(t));
  return ordered.join(", ");
}

/**
 * 构造"强化约束"的网格提示词 —— 三段式：
 *   1) 公共约束置顶并重复强调（跨面板一致性）
 *   2) 必要时的负面约束（朝向类最容易漂，必须反向堵死）
 *   3) 网格格式 + 逐格标注（每格都带上公共约束关键词）
 */
export function buildGridPrompt(candidates: string[], layout: GridLayout): string {
  const shared = sharedConstraintOf(candidates);
  const n = candidates.length;
  const { rows, cols } = layout;
  const total = rows * cols;

  // 朝向/视角类约束：模型极易把它画丢，追加负面约束堵死
  const orientationWords =
    /\b(back to camera|seen from behind|back view|from behind|背影|behind)\b/i;
  const negative =
    shared && orientationWords.test(shared)
      ? "\nNEGATIVE CONSTRAINT: the subject's face is NEVER visible in ANY panel. " +
        "No frontal view, no side view, no three-quarter view. Every panel shows the subject's back only."
      : "";

  const panels = candidates.map((c, i) => `Panel ${i + 1}: ${c}`).join("\n");
  // 满格方阵里多出来的格子：指令为"重复最后一格"，避免模型自由发挥画无关内容
  const filler =
    total > n ? `\nPanel ${n + 1} to Panel ${total}: repeat Panel ${n}'s content exactly.` : "";

  return [
    shared
      ? `CRITICAL CONSTRAINT — applies to ALL ${total} panels equally: ${shared}. Keep this identical across every panel; panels may differ ONLY in the varying detail listed below.`
      : `CRITICAL CONSTRAINT — all ${total} panels must show the same scene, same subject, same outfit, same location and same style.`,
    negative,
    `A clean ${rows}x${cols} contact sheet grid: exactly ${total} equal square panels arranged in ${rows} rows and ${cols} columns, separated by thin white borders, no text, no captions, no numbers.`,
    "The panels differ ONLY in this way:",
    panels,
    filler,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 按网格坐标把一张网格图切成 n 张。
 * 用 sharp 的 extract 做无损区域裁剪，返回的 Buffer 与候选数一致。
 */
export async function sliceGrid(
  input: Buffer,
  layout: GridLayout,
  count: number,
): Promise<Buffer[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width <= 0 || height <= 0) return [];

  const cellW = Math.floor(width / layout.cols);
  const cellH = Math.floor(height / layout.rows);
  if (cellW <= 0 || cellH <= 0) return [];

  const out: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    const buf = await sharp(input)
      .extract({
        left: col * cellW,
        top: row * cellH,
        width: cellW,
        height: cellH,
      })
      .toBuffer();
    out.push(buf);
  }
  return out;
}
