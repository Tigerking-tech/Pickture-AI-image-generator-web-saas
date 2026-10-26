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
  enum: (v, range) =>
    typeof v === "string" && Array.isArray(range) && (range as string[]).includes(v),
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
        range: [
          "automatic",
          "preserveDetails",
          "bicubicSmoother",
          "bicubicSharper",
          "bicubicAutomatic",
          "bicubic",
          "nearest",
          "bilinear",
          "lanczos",
          "none",
        ],
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
        range: [
          "topLeft",
          "top",
          "topRight",
          "left",
          "center",
          "right",
          "bottomLeft",
          "bottom",
          "bottomRight",
        ],
      },
      extensionColor: {
        type: "enum",
        range: ["background", "foreground", "white", "black", "transparent"],
      },
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
      resample: {
        type: "enum",
        range: ["bicubic", "bilinear", "nearest", "lanczos", "preserveDetails"],
      },
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
  "select.subject": {
    risk: "safe",
    params: {
      sampleAllLayers: { type: "bool" },
      mode: { type: "enum", range: ["replace", "add", "subtract", "intersect"] },
    },
    desc: "Auto-select the subject (AI)",
  },
  "select.inverse": {
    risk: "safe",
    params: {},
    desc: "Invert the active selection",
  },
  "select.deselect": {
    risk: "safe",
    params: {},
    desc: "Clear the active selection (so subsequent adjustment layers aren't masked to the selection)",
  },
  "edit.fill": {
    risk: "safe",
    params: {
      contents: {
        type: "enum",
        range: ["foreground", "background", "color", "contentAware", "pattern", "history", "black", "gray", "white"],
      },
      color: { type: "str" },
      opacity: { type: "int", range: [0, 100] },
      preserveTransparency: { type: "bool" },
      mode: {
        type: "enum",
        range: ["normal", "multiply", "screen", "overlay", "darken", "lighten", "colorDodge", "softLight", "hardLight", "difference", "exclusion", "hue", "saturation", "color", "luminosity"],
      },
    },
    desc: "Fill the selection (white → white background)",
  },
  "layer.removeBackground": {
    risk: "guarded",
    params: {
      layer: { type: "str" },
      sampleAllLayers: { type: "bool" },
      refine: { type: "bool" },
    },
    desc: "Remove background to transparency (layer mask from Select Subject)",
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
  fallbacks: {
    level: number;
    desc: string;
    build: (a?: BuildArgs) => { cmd: string; params?: Record<string, unknown> }[];
  }[];
}

/** 语义动作 → 命令链模板（Surepix 自有映射资产，含降级链） */
export const INTENT_TEMPLATES: IntentTemplate[] = [
  {
    intent: "warm_up",
    patterns: [/暖|warm|温暖|暖色/i],
    desc: "Warm grade (lift red channel)",
    build: () => [
      {
        cmd: "layer.newAdjustmentLayer.curves",
        params: {
          points: [
            [0, 18],
            [128, 142],
            [255, 248],
          ],
        },
      },
    ],
    fallbacks: [
      {
        level: 1,
        desc: "Gentler warm grade (halved curve offset)",
        build: () => [
          {
            cmd: "layer.newAdjustmentLayer.curves",
            params: {
              points: [
                [0, 9],
                [128, 134],
                [255, 244],
              ],
            },
          },
        ],
      },
      {
        level: 2,
        desc: "Slight red-channel lift only",
        build: () => [
          {
            cmd: "layer.newAdjustmentLayer.brightnessContrast",
            params: { brightness: 8, contrast: 0 },
          },
        ],
      },
    ],
  },
  {
    intent: "cool_down",
    patterns: [/冷|cool|清冷/i],
    desc: "Cool grade (lift blue channel)",
    build: () => [
      {
        cmd: "layer.newAdjustmentLayer.curves",
        params: {
          points: [
            [0, 10],
            [128, 128],
            [255, 240],
          ],
        },
      },
    ],
    fallbacks: [
      {
        level: 1,
        desc: "Gentler cool grade",
        build: () => [
          {
            cmd: "layer.newAdjustmentLayer.curves",
            params: {
              points: [
                [0, 5],
                [128, 128],
                [255, 236],
              ],
            },
          },
        ],
      },
      {
        level: 2,
        desc: "Slight blue-channel lift only",
        build: () => [
          {
            cmd: "layer.newAdjustmentLayer.brightnessContrast",
            params: { brightness: 6, contrast: 0 },
          },
        ],
      },
    ],
  },
  {
    intent: "brighten",
    patterns: [/亮|bright|提亮|太暗|通透|通透感|不够亮/i],
    desc: "Brighten",
    build: (a = {}) => [
      {
        cmd: "layer.newAdjustmentLayer.brightnessContrast",
        params: { brightness: a.brightness ?? 20, contrast: a.contrast ?? 5 },
      },
    ],
    fallbacks: [
      {
        level: 1,
        desc: "Halved brighten",
        build: (a = {}) => [
          {
            cmd: "layer.newAdjustmentLayer.brightnessContrast",
            params: { brightness: Math.round((a.brightness ?? 20) / 2), contrast: 0 },
          },
        ],
      },
      {
        level: 2,
        desc: "Levels instead (softer)",
        build: () => [
          {
            cmd: "layer.newAdjustmentLayer.levels",
            params: { inBlack: 0, inWhite: 255, gamma: 1.2 },
          },
        ],
      },
    ],
  },
  {
    intent: "boost_saturation",
    patterns: [/饱和|鲜艳|vivid|质感|更有质感/i],
    desc: "Boost saturation",
    build: (a = {}) => [
      { cmd: "layer.newAdjustmentLayer.hueSaturation", params: { saturation: a.saturation ?? 20 } },
    ],
    fallbacks: [
      {
        level: 1,
        desc: "Halved saturation",
        build: (a = {}) => [
          {
            cmd: "layer.newAdjustmentLayer.hueSaturation",
            params: { saturation: Math.round((a.saturation ?? 20) / 2) },
          },
        ],
      },
      {
        level: 2,
        desc: "Contrast only, hue untouched",
        build: () => [
          {
            cmd: "layer.newAdjustmentLayer.brightnessContrast",
            params: { brightness: 0, contrast: 10 },
          },
        ],
      },
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
        {
          cmd: "image.canvasSize",
          params: { width: W, height: H, anchor: "center", extensionColor: "white" },
        },
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
            {
              cmd: "image.canvasSize",
              params: { width: W, height: H, anchor: "center", extensionColor: "white" },
            },
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
    patterns: [/锐化|sharpen/i],
    desc: "Smart sharpen",
    build: (a = {}) => [{ cmd: "filter.sharpen.smartSharpen", params: { amount: a.amount ?? 80 } }],
    fallbacks: [
      {
        level: 1,
        desc: "Halved sharpen amount",
        build: (a = {}) => [
          {
            cmd: "filter.sharpen.smartSharpen",
            params: { amount: Math.round((a.amount ?? 80) / 2), radius: 1 },
          },
        ],
      },
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
  {
    intent: "remove_bg_white",
    patterns: [/去背景|抠图|抠出来|白底|纯色背景|背景换成白底|去掉背景|移除背景|去除背景|remove (?:the )?background|remove bg|background removal|knockout|cutout/i],
    desc: "Knock out background to pure white (e-commerce standard, deterministic)",
    build: () => [
      { cmd: "select.subject", params: { sampleAllLayers: true, mode: "replace" } },
      { cmd: "select.inverse" },
      { cmd: "edit.fill", params: { contents: "white" } },
    ],
    fallbacks: [
      {
        level: 1,
        desc: "Same knockout without sampling all layers",
        build: () => [
          { cmd: "select.subject", params: { sampleAllLayers: false, mode: "replace" } },
          { cmd: "select.inverse" },
          { cmd: "edit.fill", params: { contents: "white" } },
        ],
      },
    ],
  },
  {
    intent: "remove_bg_transparent",
    patterns: [/透明背景|透明底|透明底图|保留透明/i],
    desc: "Remove background to transparency (deterministic)",
    build: () => [{ cmd: "layer.removeBackground", params: { refine: true } }],
    fallbacks: [],
  },
];

/** 语义级改动意图：白名单覆盖不了，必须走 AI 重生成
 *  正则约定：
 *   - 避免单字裸匹配（如「木/石/布」会误中「石榴汁/布局/木讷」），统一用复合词。
 *   - 删除类动词（去掉/删除/去除）必须带宾语上下文，否则「去掉水印」会与确定性意图混淆。
 */
export const GENERATIVE_INTENTS = [
  {
    intent: "swap_background",
    patterns: [
      /换背景|换成.{1,30}背景(?!白)|场景图?|把背景.{0,12}(?:改成|换成|调成|变)(?!白底|纯色|透明|纯白)|背景换成(?!白底|纯色|透明|纯白)|change (?:the )?background|replace (?:the )?background|new background|background to/i,
    ],
    desc: "Swap to a scene/coloured background (semantic; pure white/transparent is deterministic)",
  },
  {
    intent: "change_material",
    patterns: [
      /材质|木质|木纹|木制|木材|原木|金属|石材|石质|大理石|石头|布料|布艺|棉布|织物|皮革|material|texture/i,
    ],
    desc: "Change material (semantic)",
  },
  {
    intent: "remove_object",
    patterns: [
      /抹掉|擦掉|擦除/,
      /(?:去除|去掉|删除).{0,6}(物体|瑕疵|污点|背景|人|东西|元素|水杯|杂物|污渍|划痕|灰尘|指纹|瑕疵|道具|配饰|物品|摆件)/,
      /remove (?:the )?(?:background )?(?:object|item|person|thing)/,
      /erase (?:the )?(?:object|item)/,
    ],
    desc: "Remove element (semantic)",
  },
  {
    intent: "change_object_color",
    patterns: [
      /(?:瓶身|产品|商品|主体|衣服|机身|外壳|表面).{0,8}(?:颜色|色)/i,
      /把(?:瓶身|产品|商品|主体|衣服|机身).{0,12}(?:改成|换成).{0,8}(?:色|颜色)/i,
    ],
    desc: "Recolour product body (semantic)",
  },
  {
    intent: "style_transfer",
    patterns: [/风格|style|日系|复古|胶片/i],
    desc: "Style transfer (semantic)",
  },
  {
    intent: "extend_image",
    patterns: [/扩展|扩图|延展|outpaint|extend/i],
    desc: "AI outpaint (semantic)",
  },
  {
    intent: "upscale",
    patterns: [
      /高清修复|超分|超分辨率|提升清晰度|清晰化|画质增强|更清晰|变清晰|upscal|super.?res|enhance (?:quality|resolution)/i,
    ],
    desc: "Upscale / enhance resolution (semantic)",
  },
  {
    intent: "add_object",
    patterns: [
      /加个(杯子|物品|物体|装饰|配饰|花|绿植|道具|植物)/i,
      /加(?:一|这|那)?(?:个|种|盆|朵|株|棵|些)?(杯子|物品|物体|装饰|配饰|花|绿植|道具|植物)/i,
      /加(?:一|这|那)?(?:个|种|盆|朵|株|棵|些)?(杯子|物品|物体|装饰|配饰|花|绿植|道具|植物).*(?:在|到|于).*(?:旁边|背景|一侧|前)/i,
      /添加(?!水印).*(物体|元素|配饰|绿植|道具|植物)/i,
      /在.*(旁边|背景).*加(?!水印)/i,
      /add (?:an? |the )?(?:object|item|cup|plant|prop)/i,
    ],
    desc: "Add object to scene (semantic)",
  },
  {
    intent: "change_text",
    patterns: [
      /(文字|文案|标签|字).*(改|换|替换|写)/i,
      /修改.*(文字|标签|标)/i,
      /把.{0,10}(文字|文案|标签|字).{0,8}(改成|换成|替换为)/i,
      /change (?:the )?(?:text|label|word)/i,
      /replace (?:the )?text/i,
    ],
    desc: "Change text/label in image (semantic)",
  },
];

export interface ChainStep {
  cmd: string;
  params?: Record<string, unknown>;
}

/** 意图探测：一条指令可能同时含确定性意图和语义级意图——路由算法的输入 */
export function detectIntents(instruction: string): {
  deterministic: IntentTemplate[];
  generative: typeof GENERATIVE_INTENTS;
} {
  const deterministic = INTENT_TEMPLATES.filter((t) =>
    t.patterns.some((re) => re.test(instruction)),
  );
  const generative = GENERATIVE_INTENTS.filter((g) =>
    g.patterns.some((re) => re.test(instruction)),
  );
  return { deterministic, generative };
}

/** 多意图合并时的执行顺序（关键：PhotoCraft 的 active-layer 是状态化的）。
 *  需要像素层活跃的操作（去背景/改尺寸/水印/锐化滤镜）必须排在所有"调整层类"操作之前，
 *  否则后续的 edit.fill / smartSharpen 会因 active layer 变成 Adjustment layer 而报错。
 *  分层：0 去背景 → 1 改尺寸 → 2 水印 → 3 锐化滤镜 → 4 调色调整层。 */
const MERGE_PRIORITY: Record<string, number> = {
  remove_bg_transparent: 0,
  remove_bg_white: 0,
  resize_for_platform: 1,
  scale_percent: 1,
  watermark: 2,
  sharpen: 3,
  warm_up: 4,
  cool_down: 4,
  brighten: 4,
  boost_saturation: 4,
};
export const mergeRank = (i: string) => MERGE_PRIORITY[i] ?? 5;

/** 把一条自然语言修图指令映射为命令链（origW/origH 供几何类模板计算 contain/pad）
 *  多确定性意图：合并所有命中的模板链，并按 MERGE_PRIORITY 排序后拼接 */
export function planChain(
  instruction: string,
  origW?: number,
  origH?: number,
):
  | { ok: true; intent: string; intents: string[]; desc: string; chain: ChainStep[]; args: BuildArgs }
  | { ok: false; error: string } {
  const matchedAll = INTENT_TEMPLATES.filter((t) => t.patterns.some((re) => re.test(instruction)));
  if (matchedAll.length === 0) return { ok: false, error: "no intent matched" };
  const matched = [...matchedAll].sort((a, b) => mergeRank(a.intent) - mergeRank(b.intent));
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
  const chain: ChainStep[] = [];
  let emittedBg = false;
  for (const t of matched) {
    const isBg = t.intent === "remove_bg_white" || t.intent === "remove_bg_transparent";
    // 背景选区在 edit.fill 后仍激活，会让后续调整层被"选区蒙版"限制到背景 → 跨过背景块进入调整层前先取消选区
    if (emittedBg && !isBg) {
      chain.push({ cmd: "select.deselect" });
      emittedBg = false;
    }
    if (isBg) emittedBg = true;
    chain.push(...t.build(args));
  }
  const intents = matched.map((t) => t.intent);
  return {
    ok: true,
    intent: intents.join("+"),
    intents,
    desc: matched.map((t) => t.desc).join("; "),
    chain,
    args,
  };
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
          return {
            ok: false,
            error: `param out of range/invalid: ${step.cmd}.${key}=${JSON.stringify(val)}`,
          };
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
