/**
 * Mock 文本 provider —— 仅供本地验收用，不接任何真实 LLM。
 *
 * 给定任意句子，返回一棵「合法且丰富」的 VISTA 要素树 JSON，
 * 让真实的 decompose 路由（finalizeTree：去未知键 → 朝向归一化 →
 * 补齐候选 → 补默认模式 → 校验 → 留档）完整跑通。
 * 根据句子关键词切换几套主题树，模拟"不同客户的不同提示词"。
 */
import type { TextDecomposeRequest, TextProvider, TextResult } from "../types";

/** 主题树：每个都覆盖全部 8 个 VISTA 分组，且含 6 个出图节点（DECISION_TREE_ORDER）。 */
const TREES: Record<
  string,
  Record<string, Record<string, { value: string; candidates: string[]; mode: string }>>
> = {
  dog_sunset: {
    info: {
      name: { value: "sunset run", candidates: ["sunset run"], mode: "auto" },
      description: {
        value: "a girl and a dog running at sunset",
        candidates: ["a girl and a dog running at sunset"],
        mode: "auto",
      },
    },
    camera: { aspect_ratio: { value: "16:9", candidates: ["16:9", "1:1"], mode: "text" } },
    style: {
      aesthetic: {
        value: "photorealistic",
        candidates: ["photorealistic", "cinematic", "anime"],
        mode: "visual",
      },
      palette: { value: "warm earthy", candidates: ["warm earthy", "cool blue"], mode: "text" },
    },
    environment: {
      timeofday: { value: "sunset", candidates: ["sunset", "golden hour", "dusk"], mode: "visual" },
      weather: { value: "clear", candidates: ["clear", "cloudy"], mode: "visual" },
      location: { value: "beach", candidates: ["beach", "forest"], mode: "text" },
    },
    lighting: {
      direction: {
        value: "backlight",
        candidates: ["backlight", "rim light", "side light"],
        mode: "visual",
      },
      type: { value: "natural", candidates: ["natural", "studio softbox"], mode: "text" },
    },
    character: {
      species: { value: "human and dog", candidates: ["human and dog", "human"], mode: "text" },
      pose: { value: "running", candidates: ["running", "walking", "standing"], mode: "visual" },
      orientation: {
        value: "facing camera",
        candidates: ["facing camera", "side profile"],
        mode: "visual",
      },
    },
    composition: {
      framing: {
        value: "wide shot",
        candidates: ["wide shot", "medium shot", "full shot"],
        mode: "visual",
      },
      perspective: { value: "eye level", candidates: ["eye level", "low angle"], mode: "text" },
    },
    effects: {
      color_grade: { value: "warm grade", candidates: ["warm grade", "cool grade"], mode: "text" },
      fog: { value: "none", candidates: ["none", "light mist"], mode: "text" },
    },
  },
  cat_night: {
    info: {
      name: { value: "night cat", candidates: ["night cat"], mode: "auto" },
      description: {
        value: "a cat sitting on a windowsill at night",
        candidates: ["a cat sitting on a windowsill at night"],
        mode: "auto",
      },
    },
    camera: { aspect_ratio: { value: "4:3", candidates: ["4:3", "1:1"], mode: "text" } },
    style: {
      aesthetic: {
        value: "cinematic",
        candidates: ["cinematic", "photorealistic", "anime"],
        mode: "visual",
      },
      palette: { value: "cool blue", candidates: ["cool blue", "monochrome"], mode: "text" },
    },
    environment: {
      timeofday: { value: "night", candidates: ["night", "dusk"], mode: "visual" },
      weather: { value: "clear", candidates: ["clear", "foggy"], mode: "visual" },
      location: {
        value: "indoor studio",
        candidates: ["indoor studio", "urban street"],
        mode: "text",
      },
    },
    lighting: {
      direction: {
        value: "side light",
        candidates: ["side light", "rim light", "front light"],
        mode: "visual",
      },
      type: { value: "neon", candidates: ["neon", "candlelight"], mode: "text" },
    },
    character: {
      species: { value: "cat", candidates: ["cat", "creature"], mode: "text" },
      pose: { value: "sitting", candidates: ["sitting", "standing", "lying down"], mode: "visual" },
      orientation: {
        value: "back to camera (seen from behind)",
        candidates: ["back to camera (seen from behind)", "side profile"],
        mode: "visual",
      },
    },
    composition: {
      framing: {
        value: "close-up",
        candidates: ["close-up", "medium shot", "full shot"],
        mode: "visual",
      },
      perspective: { value: "eye level", candidates: ["eye level", "low angle"], mode: "text" },
    },
    effects: {
      color_grade: { value: "cool grade", candidates: ["cool grade", "desaturated"], mode: "text" },
      fog: { value: "none", candidates: ["none", "light mist"], mode: "text" },
    },
  },
  robot_cyberpunk: {
    info: {
      name: { value: "cyber robot", candidates: ["cyber robot"], mode: "auto" },
      description: {
        value: "a robot walking in a neon city",
        candidates: ["a robot walking in a neon city"],
        mode: "auto",
      },
    },
    camera: { aspect_ratio: { value: "2.39:1", candidates: ["2.39:1", "16:9"], mode: "text" } },
    style: {
      aesthetic: {
        value: "3D render",
        candidates: ["3D render", "cinematic", "editorial illustration"],
        mode: "visual",
      },
      palette: {
        value: "vivid saturated",
        candidates: ["vivid saturated", "muted filmic"],
        mode: "text",
      },
    },
    environment: {
      timeofday: { value: "night", candidates: ["night", "dusk"], mode: "visual" },
      weather: { value: "rainy", candidates: ["rainy", "stormy"], mode: "visual" },
      location: { value: "urban street", candidates: ["urban street", "mountain"], mode: "text" },
    },
    lighting: {
      direction: {
        value: "rim light",
        candidates: ["rim light", "backlight", "side light"],
        mode: "visual",
      },
      type: { value: "neon", candidates: ["neon", "studio softbox"], mode: "text" },
    },
    character: {
      species: { value: "creature", candidates: ["creature", "human"], mode: "text" },
      pose: { value: "walking", candidates: ["walking", "running", "standing"], mode: "visual" },
      orientation: {
        value: "three-quarter view",
        candidates: ["three-quarter view", "facing camera"],
        mode: "visual",
      },
    },
    composition: {
      framing: {
        value: "full shot",
        candidates: ["full shot", "wide shot", "medium shot"],
        mode: "visual",
      },
      perspective: { value: "low angle", candidates: ["low angle", "eye level"], mode: "text" },
    },
    effects: {
      color_grade: {
        value: "high saturation",
        candidates: ["high saturation", "warm grade"],
        mode: "text",
      },
      glow: { value: "bloom", candidates: ["bloom", "soft glow"], mode: "text" },
    },
  },
};

function pickTree(
  sentence: string,
): Record<string, Record<string, { value: string; candidates: string[]; mode: string }>> {
  const s = sentence.toLowerCase();
  if (s.includes("cat")) return TREES.cat_night;
  if (s.includes("robot") || s.includes("cyber")) return TREES.robot_cyberpunk;
  return TREES.dog_sunset;
}

export const mockTextProvider: TextProvider = {
  name: "mock",

  isConfigured() {
    return true;
  },

  missingKeyMessage() {
    return "mock text provider is always configured (no key needed for local verification)";
  },

  async decompose(req: TextDecomposeRequest): Promise<TextResult> {
    try {
      return { ok: true, content: JSON.stringify(pickTree(req.sentence)) };
    } catch (e) {
      return { ok: false, status: 500, detail: String(e) };
    }
  },

  async decomposeStream(
    req: TextDecomposeRequest,
    onDelta: (text: string) => void,
  ): Promise<TextResult> {
    const res = await this.decompose(req);
    if (res.ok) onDelta(res.content);
    return res;
  },
};
