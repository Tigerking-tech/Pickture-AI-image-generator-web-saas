/**
 * VISTA 画面要素 schema
 *
 * 来源：开源标准 VISTA（tuxxxu/vista），按本产品需要做裁剪与扩展（PRD §5）。
 * 规格 §2：lib/vista.ts —— 纯 schema 层，不含产品策略。
 * 产品策略（哪些属性出图选/文字选/自动定、节点顺序）见 elementConfig.ts。
 *
 * 本文件不得引入任何运行时依赖，保证可在 Node / 浏览器 / 单测中通用。
 */

/** VISTA 的八个要素分组（PRD §5.1） */
export const VISTA_GROUPS = [
  "info",
  "camera",
  "style",
  "environment",
  "lighting",
  "character",
  "composition",
  "effects",
] as const;

export type VistaGroup = (typeof VISTA_GROUPS)[number];

/**
 * 决策方式（R1 要求每属性带此标记）：
 * - visual：出图选 —— 生成 2–4 张候选图让用户点选（PRD §5.3 / R3）
 * - text  ：文字选 —— 给用户下拉或输入框，不出图
 * - auto  ：自动定 —— LLM 直接定，不打扰用户（避免决策树过长）
 */
export type DecisionMode = "visual" | "text" | "auto";

/** 属性值的来源，参考图模式（R7）下用于判断"继承自图"还是"被文字改动" */
export type ValueSource = "llm" | "image" | "user";

/** 单个属性的取值容器 */
export interface VistaAttributeValue {
  /** 当前选定值；未定时为空串 */
  value: string;
  /** LLM 给出的候选枚举值，长度 2–4（R3） */
  candidates: string[];
  /** 该属性在本作品中的决策方式 */
  mode: DecisionMode;
  /** 值来源 */
  source?: ValueSource;
  /** 参考图模式下：该值是否由参考图识别而来 */
  fromImage?: boolean;
  /** 参考图模式下：该值是否被用户文字指令改动 */
  changed?: boolean;
}

export type VistaAttributeMap = Record<string, VistaAttributeValue>;

/** 完整要素树 —— /api/decompose 的返回结构（R1） */
export interface VistaTree {
  info: VistaAttributeMap;
  camera: VistaAttributeMap;
  style: VistaAttributeMap;
  environment: VistaAttributeMap;
  lighting: VistaAttributeMap;
  character: VistaAttributeMap;
  composition: VistaAttributeMap;
  effects: VistaAttributeMap;
  meta?: VistaMeta;
}

export interface VistaMeta {
  /** 是否来自参考图模式（R7） */
  fromImage: boolean;
  /** 被文字指令改动的字段，形如 "character.species" */
  changedFields: string[];
  /** 原始用户句子 */
  sentence?: string;
  /** 拆解所用模型，便于成本归因 */
  model?: string;
}

/** 属性元数据：给 LLM 提示词、UI 渲染、校验共用 */
export interface VistaAttributeMeta {
  group: VistaGroup;
  key: string;
  label: string;
  labelEn: string;
  /** 候选值池：LLM 应优先从中挑选，必要时可自造但需是短语 */
  pool: readonly string[];
}

/**
 * 全量属性表（PRD §5.1 节选 + 扩展）。
 * 顺序即文档顺序；出图顺序由 elementConfig.ts 的 DECISION_TREE_NODES 决定，二者不同。
 */
export const VISTA_ATTRIBUTES: readonly VistaAttributeMeta[] = [
  // --- Info ---
  {
    group: "info",
    key: "name",
    label: "作品名",
    labelEn: "Name",
    pool: [],
  },
  {
    group: "info",
    key: "description",
    label: "画面描述",
    labelEn: "Description",
    pool: [],
  },

  // --- Camera ---
  {
    group: "camera",
    key: "model",
    label: "相机机型",
    labelEn: "Camera model",
    pool: ["DSLR", "mirrorless", "film camera", "cinema camera", "smartphone"],
  },
  {
    group: "camera",
    key: "lens_type",
    label: "镜头类型",
    labelEn: "Lens type",
    pool: ["wide angle", "standard", "telephoto", "macro", "fisheye", "tilt shift"],
  },
  {
    group: "camera",
    key: "focal_length",
    label: "焦距",
    labelEn: "Focal length",
    pool: ["16mm", "24mm", "35mm", "50mm", "85mm", "135mm", "200mm"],
  },
  {
    group: "camera",
    key: "fstop",
    label: "光圈",
    labelEn: "Aperture",
    pool: ["f/1.4", "f/1.8", "f/2.8", "f/4", "f/8", "f/11"],
  },
  {
    group: "camera",
    key: "iso",
    label: "ISO",
    labelEn: "ISO",
    pool: ["ISO 100", "ISO 200", "ISO 400", "ISO 800", "ISO 1600"],
  },
  {
    group: "camera",
    key: "shutter_speed",
    label: "快门",
    labelEn: "Shutter speed",
    pool: ["1/1000s", "1/500s", "1/250s", "1/60s", "1/15s", "long exposure"],
  },
  {
    group: "camera",
    key: "aspect_ratio",
    label: "画幅比",
    labelEn: "Aspect ratio",
    pool: ["1:1", "4:3", "3:2", "16:9", "9:16", "2.39:1"],
  },

  // --- Style ---
  {
    group: "style",
    key: "palette",
    label: "色彩方案",
    labelEn: "Color palette",
    pool: ["warm earthy", "cool blue", "monochrome", "pastel", "vivid saturated", "muted filmic"],
  },
  {
    group: "style",
    key: "lut",
    label: "调色 LUT",
    labelEn: "LUT",
    pool: ["teal and orange", "kodak portra", "fuji velvia", "cinematic log", "bleach bypass"],
  },
  {
    group: "style",
    key: "year",
    label: "年代感",
    labelEn: "Era",
    pool: ["modern", "1970s", "1980s", "1990s", "vintage", "futuristic"],
  },
  {
    group: "style",
    key: "aesthetic",
    label: "美学风格",
    labelEn: "Aesthetic",
    pool: [
      "photorealistic",
      "cinematic",
      "anime",
      "watercolor",
      "oil painting",
      "3D render",
      "editorial illustration",
      "minimalist flat",
    ],
  },
  {
    group: "style",
    key: "engine",
    label: "渲染引擎感",
    labelEn: "Render engine",
    pool: ["unreal engine", "octane render", "blender cycles", "corona", "none"],
  },

  // --- Environment ---
  {
    group: "environment",
    key: "location",
    label: "地点类型",
    labelEn: "Location",
    pool: ["urban street", "forest", "beach", "mountain", "indoor studio", "desert", "countryside"],
  },
  {
    group: "environment",
    key: "outdoor",
    label: "室内/室外",
    labelEn: "Indoor or outdoor",
    pool: ["indoor", "outdoor"],
  },
  {
    group: "environment",
    key: "timeofday",
    label: "时段",
    labelEn: "Time of day",
    pool: ["dawn", "morning", "noon", "afternoon", "golden hour", "sunset", "dusk", "night"],
  },
  {
    group: "environment",
    key: "weather",
    label: "天气",
    labelEn: "Weather",
    pool: ["clear", "sunny", "cloudy", "overcast", "rainy", "foggy", "snowy", "stormy"],
  },
  {
    group: "environment",
    key: "setting",
    label: "场景陈设",
    labelEn: "Setting",
    pool: ["minimal", "lush and detailed", "cluttered", "industrial", "cozy", "grand"],
  },

  // --- Lighting ---
  {
    group: "lighting",
    key: "type",
    label: "光型",
    labelEn: "Light type",
    pool: ["natural", "studio softbox", "practical lamps", "neon", "candlelight", "mixed"],
  },
  {
    group: "lighting",
    key: "direction",
    label: "光位",
    labelEn: "Light direction",
    pool: ["front light", "side light", "backlight", "top light", "under light", "rim light"],
  },
  {
    group: "lighting",
    key: "intensity",
    label: "光强",
    labelEn: "Light intensity",
    pool: ["soft", "moderate", "strong", "harsh"],
  },
  {
    group: "lighting",
    key: "temperature",
    label: "色温",
    labelEn: "Color temperature",
    pool: ["warm", "neutral", "cool"],
  },
  {
    group: "lighting",
    key: "color",
    label: "光色",
    labelEn: "Light color",
    pool: ["golden", "white", "blue", "amber", "green tint", "magenta"],
  },
  {
    group: "lighting",
    key: "softness",
    label: "柔硬",
    labelEn: "Softness",
    pool: ["very soft", "soft", "medium", "hard"],
  },
  {
    group: "lighting",
    key: "contrast",
    label: "对比度",
    labelEn: "Contrast",
    pool: ["low contrast", "medium contrast", "high contrast"],
  },
  {
    group: "lighting",
    key: "shadows",
    label: "阴影",
    labelEn: "Shadows",
    pool: ["no shadows", "soft shadows", "long dramatic shadows", "hard shadows"],
  },

  // --- Character ---
  {
    group: "character",
    key: "species",
    label: "主体物种",
    labelEn: "Subject species",
    pool: ["human", "dog", "cat", "bird", "horse", "creature", "object"],
  },
  {
    group: "character",
    key: "pose",
    label: "姿态",
    labelEn: "Pose",
    pool: ["running", "standing", "sitting", "walking", "jumping", "lying down", "crouching"],
  },
  {
    group: "character",
    key: "orientation",
    label: "朝向",
    labelEn: "Orientation",
    // 主体相对镜头的朝向 —— "背影"类描述的正确归属地（不要塞进 pose，更不要误解成光线）
    pool: [
      "facing camera",
      "back to camera (seen from behind)",
      "side profile",
      "three-quarter view",
    ],
  },
  {
    group: "character",
    key: "expression",
    label: "表情",
    labelEn: "Expression",
    pool: ["smiling", "neutral", "serious", "laughing", "surprised", "calm"],
  },
  {
    group: "character",
    key: "clothing",
    label: "服装",
    labelEn: "Clothing",
    pool: ["casual", "formal", "sportswear", "jacket", "dress", "uniform", "armor"],
  },
  {
    group: "character",
    key: "makeup",
    label: "妆容",
    labelEn: "Makeup",
    pool: ["none", "natural", "glam", "theatrical"],
  },
  {
    group: "character",
    key: "hairstyle",
    label: "发型",
    labelEn: "Hairstyle",
    pool: ["short", "long", "ponytail", "curly", "bob", "braided", "bald"],
  },

  // --- Composition ---
  {
    group: "composition",
    key: "framing",
    label: "取景",
    labelEn: "Framing",
    pool: ["extreme close-up", "close-up", "medium shot", "full shot", "wide shot", "establishing"],
  },
  {
    group: "composition",
    key: "perspective",
    label: "视角",
    labelEn: "Perspective",
    pool: ["eye level", "low angle", "high angle", "bird's eye", "dutch angle"],
  },
  {
    group: "composition",
    key: "focal_point",
    label: "视觉焦点",
    labelEn: "Focal point",
    pool: ["centered subject", "off-center subject", "foreground subject", "background subject"],
  },
  {
    group: "composition",
    key: "rule_of_thirds",
    label: "三分法",
    labelEn: "Rule of thirds",
    pool: ["on", "off"],
  },
  {
    group: "composition",
    key: "motion_blur",
    label: "动态模糊",
    labelEn: "Motion blur",
    pool: ["none", "subtle", "strong"],
  },

  // --- Effects ---
  {
    group: "effects",
    key: "color_grade",
    label: "调色",
    labelEn: "Color grade",
    pool: ["none", "warm grade", "cool grade", "desaturated", "high saturation"],
  },
  {
    group: "effects",
    key: "grain",
    label: "颗粒",
    labelEn: "Grain",
    pool: ["none", "light film grain", "heavy film grain"],
  },
  {
    group: "effects",
    key: "vignette",
    label: "暗角",
    labelEn: "Vignette",
    pool: ["none", "subtle", "strong"],
  },
  {
    group: "effects",
    key: "glow",
    label: "光晕",
    labelEn: "Glow",
    pool: ["none", "soft glow", "bloom"],
  },
  {
    group: "effects",
    key: "fog",
    label: "雾气",
    labelEn: "Fog",
    pool: ["none", "light mist", "thick fog"],
  },
  {
    group: "effects",
    key: "lens_flare",
    label: "镜头光晕",
    labelEn: "Lens flare",
    pool: ["none", "subtle", "anamorphic"],
  },
] as const;

/** 按分组取属性元数据 */
export function getGroupAttributes(group: VistaGroup): VistaAttributeMeta[] {
  return VISTA_ATTRIBUTES.filter((a) => a.group === group);
}

/** 取单个属性元数据；不存在返回 undefined，调用方需处理（不臆造字段） */
export function getAttributeMeta(group: VistaGroup, key: string): VistaAttributeMeta | undefined {
  return VISTA_ATTRIBUTES.find((a) => a.group === group && a.key === key);
}

export function isVistaGroup(value: unknown): value is VistaGroup {
  return typeof value === "string" && (VISTA_GROUPS as readonly string[]).includes(value);
}

/** 构造空的要素树 */
export function emptyVistaTree(): VistaTree {
  const tree = {} as VistaTree;
  for (const group of VISTA_GROUPS) {
    tree[group] = {};
  }
  return tree;
}

export interface VistaValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 校验一棵要素树结构是否合法。
 * 只校验结构与取值，不校验"像不像一幅画"——后者属于 LLM 的质量范畴。
 */
export function validateVistaTree(input: unknown): VistaValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null) {
    return { ok: false, errors: ["要素树必须是一个对象"] };
  }

  const tree = input as Record<string, unknown>;

  for (const group of VISTA_GROUPS) {
    const section = tree[group];
    if (section === undefined) {
      errors.push(`缺少分组：${group}`);
      continue;
    }
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      errors.push(`分组 ${group} 必须是对象`);
      continue;
    }
    for (const [key, raw] of Object.entries(section as Record<string, unknown>)) {
      if (!getAttributeMeta(group, key)) {
        errors.push(`未知属性：${group}.${key}`);
        continue;
      }
      if (typeof raw !== "object" || raw === null) {
        errors.push(`属性 ${group}.${key} 必须是对象`);
        continue;
      }
      const v = raw as Partial<VistaAttributeValue>;
      if (typeof v.value !== "string") {
        errors.push(`属性 ${group}.${key} 缺少字符串字段 value`);
      }
      if (!Array.isArray(v.candidates)) {
        errors.push(`属性 ${group}.${key} 的 candidates 必须是数组`);
      } else if (v.candidates.some((c) => typeof c !== "string")) {
        errors.push(`属性 ${group}.${key} 的 candidates 必须全为字符串`);
      }
      if (v.mode !== "visual" && v.mode !== "text" && v.mode !== "auto") {
        errors.push(`属性 ${group}.${key} 的 mode 必须是 visual|text|auto`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 把要素树序列化为生图提示词（英文，FLUX 系列吃英文）。
 * 只输出有值的属性；顺序按分组固定的叙述顺序，保证同一棵树每次得到同一段提示词。
 */
export function toPrompt(tree: VistaTree): string {
  const parts: string[] = [];

  const push = (group: VistaGroup, keys?: string[]) => {
    const section = tree[group] ?? {};
    const entries = Object.entries(section).filter(([k]) => !keys || keys.includes(k));
    for (const [, v] of entries) {
      if (typeof v?.value === "string" && v.value.trim() !== "") {
        parts.push(v.value.trim());
      }
    }
  };

  // 叙述顺序：主体 → 环境 → 光线 → 构图 → 镜头 → 风格 → 效果
  const desc = tree.info?.description?.value?.trim();
  if (desc) parts.push(desc);

  push("character");
  push("environment");
  push("lighting");
  push("composition");
  push("camera");
  push("style");
  push("effects");

  // 兜底：附上用户原句。即使拆解时某条明确约束（如"背影"）被丢失或改写，
  // 生图模型仍能看到原始意图。放在末尾，不干扰要素精修。
  const sentence = tree.meta?.sentence?.trim();
  if (sentence) parts.push(`(original scene: ${sentence})`);

  return parts.join(", ");
}

/** 深拷贝一棵树（避免 UI 与请求间共享引用导致串改） */
export function cloneVistaTree(tree: VistaTree): VistaTree {
  const out = emptyVistaTree();
  for (const group of VISTA_GROUPS) {
    for (const [key, v] of Object.entries(tree[group] ?? {})) {
      out[group][key] = {
        value: v.value,
        candidates: [...v.candidates],
        mode: v.mode,
        ...(v.source ? { source: v.source } : {}),
        ...(v.fromImage !== undefined ? { fromImage: v.fromImage } : {}),
        ...(v.changed !== undefined ? { changed: v.changed } : {}),
      };
    }
  }
  if (tree.meta) out.meta = { ...tree.meta, changedFields: [...tree.meta.changedFields] };
  return out;
}
