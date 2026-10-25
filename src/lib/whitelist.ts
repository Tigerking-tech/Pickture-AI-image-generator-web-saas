/**
 * whitelist.ts — LLM → PhotoCraft 命令的白名单映射（Surepix 独有算法层 #3 的命令规划基础）
 *
 * 校准来源：photocraft-cli 0.15.1 命令注册表（935 条），参数范围照注册表校准。
 * 原则：
 *  1. 只能从白名单里选命令，禁止幻觉出不存在的命令
 *  2. 每个命令带参数 schema + 取值范围校验
 *  3. 语义动作（客户的人话）→ 命令链模板 的映射是 Surepix 自有资产
 */

type Validator = (v: unknown, range?: [number, number] | string[]) => boolean;

const validators: Record<string, Validator> = {
  int: (v, range) => {
    const [lo, hi] = (range as [number, number]) ?? [-Infinity, Infinity];
    return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
  },
  num: (v, range) => {
    const [lo, hi] = (range as [number, number]) ?? [-Infinity, Infinity];
    return typeof v === "number" && v >= lo && v <= hi;
  },
  str: (v) => typeof v === "string" && v.length > 0 && v.length < 500,
  bool: (v) => typeof v === "boolean",
  enum: (v, range) => typeof v === "string" && Array.isArray(range) && (range as string[]).includes(v),
  points: (v) =>
    Array.isArray(v) &&
    v.length >= 2 &&
    v.length <= 19 &&
    v.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 255),
    ),
};

export interface ParamSpec {
  type: string;
  range?: [number, number] | string[];
  required?: boolean;
}

export interface CommandSpec {
  risk: "safe" | "guarded";
  params: Record<string, ParamSpec>;
  desc: string;
}

/** 白名单命令表（全部经注册表核实存在） */
export const ALLOWED: Record<string, CommandSpec> = {
  "layer.newAdjustmentLayer.curves": {
    risk: "safe",
    params: { points: { type: "points", required: true } },
    desc: "Curves adjustment layer (colour / contrast / tone)",
  },
  "layer.newAdjustmentLayer.levels": {
    risk: "safe",
    params: {
      inBlack: { type: "int", range: [0, 253] },
      inWhite: { type: "int", range: [2, 255] },
      gamma: { type: "num", range: [0.01, 9.99] },
    },
    desc: "Levels adjustment layer",
  },
  "layer.newAdjustmentLayer.hueSaturation": {
    risk: "safe",
    params: {
      hue: { type: "int", range: [-180, 180] },
      saturation: { type: "int", range: [-100, 100] },
      lightness: { type: "int", range: [-100, 100] },
    },
    desc: "Hue / saturation adjustment layer",
  },
  "layer.newAdjustmentLayer.brightnessContrast": {
    risk: "safe",
    params: {
      brightness: { type: "int", range: [-150, 150] },
      contrast: { type: "int", range: [-50, 100] },
    },
    desc: "Brightness / contrast adjustment layer",
  },
  "image.imageSize": {
    risk: "guarded",
    params: {
      width: { type: "int", range: [16, 8000] },
      height: { type: "int", range: [16, 8000] },
      percent: { type: "int", range: [1, 1000] },
      resample: {
        type: "enum",
        range: ["automatic", "preserveDetails", "bicubicSmoother", "bicubicSharper", "bicubicAutomatic", "bicubic", "nearest", "bilinear", "lanczos", "none"],
      },
    },
    desc: "Image size (width/height or percent)",
  },
  "image.canvasSize": {
    risk: "guarded",
    params: {
      width: { type: "int", range: [16, 8000], required: true },
      height: { type: "int", range: [16, 8000], required: true },
      anchor: {
        type: "enum",
        range: ["topLeft", "top", "topRight", "left", "center", "right", "bottomLeft", "bottom", "bottomRight"],
      },
      extensionColor: { type: "enum", range: ["background", "foreground", "white", "black", "transparent"] },
    },
    desc: "Canvas size (extend/shrink; anchor positions content, extensionColor pads)",
  },
  "image.crop": {
    risk: "guarded",
    params: {
      x: { type: "int", range: [0, 7999] },
      y: { type: "int", range: [0, 7999] },
      width: { type: "int", range: [16, 8000] },
      height: { type: "int", range: [16, 8000] },
      targetWidth: { type: "int", range: [16, 8000] },
      targetHeight: { type: "int", range: [16, 8000] },
      resample: { type: "enum", range: ["bicubic", "bilinear", "nearest", "lanczos", "preserveDetails"] },
    },
    desc: "Crop (optionally resample to targetWidth×targetHeight)",
  },
  "type.create": {
    risk: "guarded",
    params: {
      text: { type: "str" },
      x: { type: "int", range: [0, 7999] },
      y: { type: "int", range: [0, 7999] },
      size: { type: "int", range: [6, 400] },
    },
    desc: "Create text layer (editable)",
  },
  "filter.sharpen.smartSharpen": {
    risk: "safe",
    params: {
      amount: { type: "int", range: [1, 500] },
      radius: { type: "num", range: [0.1, 64] },
      reduceNoise: { type: "int", range: [0, 100] },
    },
    desc: "Smart sharpen",
  },
};

/** 模板 build 的入参：指令解析出的参数 + 原图尺寸（管线注入，几何类模板需要） */
export interface BuildArgs {
  width?: number;
  height?: number;
  percent?: number;
  amount?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  text?: string;
  fontSize?: number;
  x?: number;
  y?: number;
  origW?: number;
  origH?: number;
}

export interface IntentTemplate {
  intent: string;
  patterns: RegExp[];
  desc: string;
  build: (a?: BuildArgs) => { cmd: string; params?: Record<string, unknown> }[];
  fallbacks: { level: number; desc: string; build: (a?: BuildArgs) => { cmd: string; params?: Record<string, unknown> }[] }[];
}

/** 语义动作 → 命令链模板（Surepix 自有映射资产，含降级链） */
export const INTENT_TEMPLATES: IntentTemplate[] = [
  {
    intent: "warm_up",
    patterns: [/暖|warm|温暖|暖色/i],
    desc: "Warm grade (lift red channel)",
    build: () => [{ cmd: "layer.newAdjustmentLayer.curves", params: { points: [[0, 18], [128, 142], [255, 248]] } }],
    fallbacks: [
      { level: 1, desc: "Gentler warm grade (halved curve offset)", build: () => [{ cmd: "layer.newAdjustmentLayer.curves", params: { points: [[0, 9], [128, 134], [255, 244]] } }] },
      { level: 2, desc: "Slight red-channel lift only", build: () => [{ cmd: "layer.newAdjustmentLayer.brightnessContrast", params: { brightness: 8, contrast: 0 } }] },
    ],
  },
  {
    intent: "cool_down",
    patterns: [/冷|cool|清冷/i],
    desc: "Cool grade (lift blue channel)",
    build: () => [{ cmd: "layer.newAdjustmentLayer.curves", params: { points: [[0, 10], [128, 128], [255, 240]] } }],
    fallbacks: [
      { level: 1, desc: "Gentler cool grade", build: () => [{ cmd: "layer.newAdjustmentLayer.curves", params: { points: [[0, 5], [128, 128], [255, 236]] } }] },
      { level: 2, desc: "Slight blue-channel lift only", build: () => [{ cmd: "layer.newAdjustmentLayer.brightnessContrast", params: { brightness: 6, contrast: 0 } }] },
    ],
  },
  {
    intent: "brighten",
    patterns: [/亮|bright|提亮|太暗/i],
    desc: "Brighten",
    build: (a = {}) => [{ cmd: "layer.newAdjustmentLayer.brightnessContrast", params: { brightness: a.brightness ?? 20, contrast: a.contrast ?? 5 } }],
    fallbacks: [
      { level: 1, desc: "Halved brighten", build: (a = {}) => [{ cmd: "layer.newAdjustmentLayer.brightnessContrast", params: { brightness: Math.round((a.brightness ?? 20) / 2), contrast: 0 } }] },
      { level: 2, desc: "Levels instead (softer)", build: () => [{ cmd: "layer.newAdjustmentLayer.levels", params: { inBlack: 0, inWhite: 255, gamma: 1.2 } }] },
    ],
  },
  {
    intent: "boost_saturation",
    patterns: [/饱和|鲜艳|vivid/i],
    desc: "Boost saturation",
    build: (a = {}) => [{ cmd: "layer.newAdjustmentLayer.hueSaturation", params: { saturation: a.saturation ?? 20 } }],
    fallbacks: [
      { level: 1, desc: "Halved saturation", build: (a = {}) => [{ cmd: "layer.newAdjustmentLayer.hueSaturation", params: { saturation: Math.round((a.saturation ?? 20) / 2) } }] },
      { level: 2, desc: "Contrast only, hue untouched", build: () => [{ cmd: "layer.newAdjustmentLayer.brightnessContrast", params: { brightness: 0, contrast: 10 } }] },
    ],
  },
  {
    intent: "resize_for_platform",
    patterns: [/(?:改成|切成|转成|resize|crop to|resize to)\s*(\d{2,4})\s*[x×*]\s*(\d{2,4})/i],
    desc: "Platform size: contain + pad (no distortion, no crop)",
    // contain + pad：电商平台主图的标准做法——缩放到完整放入目标框，短边补白。
    // 为什么不裁切（cover）：裁掉的价格签/LOGO 是商业元素，丢不得；
    // 为什么不拉伸：非等比缩放会畸变，保真校验必挂。
    build: (a = {}) => {
      const W = a.width ?? 800;
      const H = a.height ?? 800;
      const ow = a.origW ?? 1200;
      const oh = a.origH ?? 900;
      const s = Math.min(W / ow, H / oh, 1); // contain：不放大
      const fitW = Math.max(16, Math.round(ow * s));
      const fitH = Math.max(16, Math.round(oh * s));
      return [
        { cmd: "image.imageSize", params: { width: fitW, height: fitH } },
        { cmd: "image.canvasSize", params: { width: W, height: H, anchor: "center", extensionColor: "white" } },
      ];
    },
    fallbacks: [
      {
        level: 1,
        desc: "Same geometry + fidelity-aligned resample (bilinear)",
        build: (a = {}) => {
          const W = a.width ?? 800;
          const H = a.height ?? 800;
          const ow = a.origW ?? 1200;
          const oh = a.origH ?? 900;
          const s = Math.min(W / ow, H / oh, 1);
          const fitW = Math.max(16, Math.round(ow * s));
          const fitH = Math.max(16, Math.round(oh * s));
          return [
            { cmd: "image.imageSize", params: { width: fitW, height: fitH, resample: "bilinear" } },
            { cmd: "image.canvasSize", params: { width: W, height: H, anchor: "center", extensionColor: "white" } },
          ];
        },
      },
    ],
  },
  {
    intent: "scale_percent",
    patterns: [/(?:缩小|放大|缩放)\s*(?:到)?\s*(\d{1,3})\s*%/],
    desc: "Scale by percent",
    build: (a = {}) => [{ cmd: "image.imageSize", params: { percent: a.percent ?? 50 } }],
    fallbacks: [],
  },
  {
    intent: "sharpen",
    patterns: [/锐化|清晰|sharpen/i],
    desc: "Smart sharpen",
    build: (a = {}) => [{ cmd: "filter.sharpen.smartSharpen", params: { amount: a.amount ?? 80 } }],
    fallbacks: [
      { level: 1, desc: "Halved sharpen amount", build: (a = {}) => [{ cmd: "filter.sharpen.smartSharpen", params: { amount: Math.round((a.amount ?? 80) / 2), radius: 1 } }] },
    ],
  },
  {
    intent: "watermark",
    patterns: [/水印|watermark/i],
    desc: "Add text watermark (editable text layer)",
    build: (a = {}) => [
      {
        cmd: "type.create",
        params: {
          text: a.text || "SUREPIX",
          x: a.x ?? 40,
          y: a.y ?? 40,
          size: a.fontSize ?? 36,
        },
      },
    ],
    fallbacks: [],
  },
];

/** 语义级改动意图：白名单覆盖不了，必须走 AI 重生成 */
export const GENERATIVE_INTENTS = [
  { intent: "swap_background", patterns: [/换背景|背景换|换成.*背景|白底|纯色背景|去背景|remove background|background/i], desc: "Swap or remove background (semantic)" },
  { intent: "change_material", patterns: [/材质|木|金属|石|布|皮革|material/i], desc: "Change material (semantic)" },
  { intent: "remove_object", patterns: [/去掉|删除|抹掉|去除|remove|erase/i], desc: "Remove element (semantic)" },
  { intent: "change_object_color", patterns: [/(?:瓶身|产品|商品|主体).*(?:颜色|色)|改成.*色/i], desc: "Recolour product body (semantic)" },
  { intent: "style_transfer", patterns: [/风格|style|日系|复古|胶片/i], desc: "Style transfer (semantic)" },
  { intent: "extend_image", patterns: [/扩展|扩图|延展|outpaint|extend/i], desc: "AI outpaint (semantic)" },
];

export interface ChainStep {
  cmd: string;
  params?: Record<string, unknown>;
}

/** 意图探测：一条指令可能同时含确定性意图和语义级意图——路由算法的输入 */
export function detectIntents(instruction: string): { deterministic: IntentTemplate[]; generative: typeof GENERATIVE_INTENTS } {
  const deterministic = INTENT_TEMPLATES.filter((t) => t.patterns.some((re) => re.test(instruction)));
  const generative = GENERATIVE_INTENTS.filter((g) => g.patterns.some((re) => re.test(instruction)));
  return { deterministic, generative };
}

/** 把一条自然语言修图指令映射为命令链（origW/origH 供几何类模板计算 contain/pad） */
export function planChain(
  instruction: string,
  origW?: number,
  origH?: number,
): { ok: true; intent: string; desc: string; chain: ChainStep[]; args: BuildArgs } | { ok: false; error: string } {
  for (const t of INTENT_TEMPLATES) {
    if (t.patterns.some((re) => re.test(instruction))) {
      const args: BuildArgs = {};
      const m = instruction.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})/i);
      if (m) {
        args.width = Number(m[1]);
        args.height = Number(m[2]);
      }
      const p = instruction.match(/(\d{1,3})\s*%/);
      if (p) args.percent = Number(p[1]);
      if (origW) args.origW = origW;
      if (origH) args.origH = origH;
      return { ok: true, intent: t.intent, desc: t.desc, chain: t.build(args), args };
    }
  }
  return { ok: false, error: "no intent matched" };
}

/** 校验命令链：命令在白名单 + 参数过 schema（四层拦截） */
export function validateCommandChain(chain: ChainStep[]): { ok: boolean; error?: string } {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { ok: false, error: "chain must be a non-empty array" };
  }
  if (chain.length > 8) {
    return { ok: false, error: "chain too long (max 8 steps)" };
  }
  for (const step of chain) {
    const spec = ALLOWED[step.cmd];
    if (!spec) {
      return { ok: false, error: `command not in whitelist: ${step.cmd}` };
    }
    if (step.params) {
      for (const [key, val] of Object.entries(step.params)) {
        const ps = spec.params[key];
        if (!ps) {
          return { ok: false, error: `param not allowed for ${step.cmd}: ${key}` };
        }
        const check = validators[ps.type];
        if (!check || !check(val, ps.range)) {
          return { ok: false, error: `param out of range/invalid: ${step.cmd}.${key}=${JSON.stringify(val)}` };
        }
      }
    }
    for (const [key, ps] of Object.entries(spec.params)) {
      if (ps.required && !(step.params && key in step.params)) {
        return { ok: false, error: `missing required param: ${step.cmd}.${key}` };
      }
    }
  }
  return { ok: true };
}
