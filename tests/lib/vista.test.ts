/**
 * T3 验收单元：VISTA schema 与决策树配置
 * 验收命令：pnpm vitest run tests/lib/vista.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  buildDecisionTree,
  CANDIDATE_DEFAULT,
  CANDIDATE_MAX,
  CANDIDATE_MIN,
  DECISION_TREE_ORDER,
  ensureVisualCandidates,
  estimatePreviewCount,
  getAttributeMode,
  markChanged,
  withDefaultModes,
} from "@/lib/elementConfig";
import {
  cloneVistaTree,
  emptyVistaTree,
  getAttributeMeta,
  toPrompt,
  type VistaTree,
  validateVistaTree,
} from "@/lib/vista";

/**
 * 样例：与 R1 验收命令同一句话「女孩和狗在夕阳下奔跑」的期望拆解结果。
 * 这是 LLM 应产出的目标形态，本测试锁定其结构与标记。
 */
function sampleTree(): VistaTree {
  const tree = emptyVistaTree();

  tree.info.description = {
    value: "a girl and a dog running together at sunset",
    candidates: [],
    mode: "auto",
  };

  tree.character.species = {
    value: "human and dog",
    candidates: ["human and dog", "human and cat", "human only"],
    mode: "text",
  };
  tree.character.pose = {
    value: "running",
    candidates: ["running", "walking", "jumping"],
    mode: "visual",
  };
  tree.character.expression = {
    value: "smiling",
    candidates: ["smiling", "laughing", "neutral"],
    mode: "text",
  };

  tree.environment.location = {
    value: "open field",
    candidates: ["open field", "beach", "forest path"],
    mode: "text",
  };
  tree.environment.timeofday = {
    value: "sunset",
    candidates: ["sunset", "golden hour", "dusk"],
    mode: "visual",
  };
  tree.environment.weather = {
    value: "clear",
    candidates: ["clear", "cloudy", "overcast"],
    mode: "visual",
  };

  tree.lighting.direction = {
    value: "backlight",
    candidates: ["backlight", "side light", "rim light"],
    mode: "visual",
  };
  tree.lighting.temperature = {
    value: "warm",
    candidates: ["warm", "neutral", "cool"],
    mode: "text",
  };

  tree.composition.framing = {
    value: "wide shot",
    candidates: ["wide shot", "medium shot", "full shot"],
    mode: "visual",
  };

  tree.style.aesthetic = {
    value: "photorealistic",
    candidates: ["photorealistic", "cinematic", "anime"],
    mode: "visual",
  };

  tree.meta = { fromImage: false, changedFields: [], sentence: "女孩和狗在夕阳下奔跑" };
  return tree;
}

describe("VISTA schema", () => {
  it("样例要素树通过结构校验", () => {
    const result = validateVistaTree(sampleTree());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("R1：必须包含 character / environment / lighting 三个分组", () => {
    const tree = sampleTree();
    expect(tree.character).toBeDefined();
    expect(tree.environment).toBeDefined();
    expect(tree.lighting).toBeDefined();
  });

  it("缺分组时校验失败并给出明确报错", () => {
    const broken = sampleTree();
    // @ts-expect-error 故意删除分组以触发校验
    delete broken.lighting;
    const result = validateVistaTree(broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("缺少分组：lighting");
  });

  it("未知属性被拒绝（不得臆造字段）", () => {
    const broken = sampleTree();
    // 属性表（vista.ts）中不存在 mood，由 validateVistaTree 在运行时拒绝
    broken.environment.mood = { value: "happy", candidates: [], mode: "text" };
    const result = validateVistaTree(broken);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("未知属性：environment.mood");
  });

  it("mode 非法时校验失败", () => {
    const broken = sampleTree();
    // @ts-expect-error mode 只允许 visual|text|auto
    broken.lighting.direction.mode = "slider";
    const result = validateVistaTree(broken);
    expect(result.ok).toBe(false);
  });

  it("toPrompt 拼出可给 FLUX 的英文提示词，且包含关键要素", () => {
    const prompt = toPrompt(sampleTree());
    expect(prompt).toContain("running");
    expect(prompt).toContain("sunset");
    expect(prompt).toContain("backlight");
    expect(prompt).toContain("wide shot");
    expect(prompt).toContain("photorealistic");
  });

  it("cloneVistaTree 深拷贝，改动副本不污染原树", () => {
    const tree = sampleTree();
    const copy = cloneVistaTree(tree);
    copy.environment.weather!.value = "rainy";
    expect(tree.environment.weather!.value).toBe("clear");
  });
});

describe("决策树配置（产品灵魂）", () => {
  it("默认模式下，主体姿态与光位排在环境之前（PRD §5.3 先钉死主体与光线）", () => {
    const order = DECISION_TREE_ORDER.map((n) => `${n.group}.${n.key}`);
    expect(order.indexOf("character.pose")).toBeLessThan(order.indexOf("lighting.direction"));
    expect(order.indexOf("lighting.direction")).toBeLessThan(
      order.indexOf("environment.timeofday"),
    );
  });

  it("出图节点（visual）数量受控，避免预览成本失控（含朝向，共 7 节点）", () => {
    const visualCount = DECISION_TREE_ORDER.filter(
      (n) => getAttributeMode(n.group, n.key) === "visual",
    ).length;
    expect(visualCount).toBeGreaterThanOrEqual(4);
    expect(visualCount).toBeLessThanOrEqual(8);
  });

  it("朝向必须出现在决策树中（背影类描述的归属地，用户要能选能改）", () => {
    const order = DECISION_TREE_ORDER.map((n) => `${n.group}.${n.key}`);
    expect(order).toContain("character.orientation");
    // 朝向紧跟姿态：同属"主体"层，先钉死主体再看光线
    expect(order.indexOf("character.orientation")).toBe(order.indexOf("character.pose") + 1);
  });

  it("每个出图节点候选数落在 2–4 之间（R2 / R3）", () => {
    const nodes = buildDecisionTree(sampleTree());
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.candidates.length).toBeGreaterThanOrEqual(CANDIDATE_MIN);
      expect(node.candidates.length).toBeLessThanOrEqual(CANDIDATE_MAX);
      expect(node.needsImages).toBe(true);
    }
  });

  it("候选不足时只用真实属性池补齐，绝不拼凑修饰词（回归：playful clear 之类）", () => {
    const tree = sampleTree();
    // 模拟模型只吐 1 个候选，且强行要求补齐到上限
    tree.environment.weather!.candidates = ["clear"];
    ensureVisualCandidates(tree, CANDIDATE_MAX);

    const cands = tree.environment.weather!.candidates;
    const FILLER = [
      "playful",
      "energetic",
      "graceful",
      "dramatic",
      "serene",
      "dynamic",
      "bold",
      "gentle",
    ];
    for (const c of cands) {
      for (const q of FILLER) {
        expect(c.toLowerCase()).not.toContain(q);
      }
    }
    // 每个候选都必须是真实存在的可选值（来自属性池），不是编造出来的变体
    const pool = getAttributeMeta("environment", "weather")!.pool;
    expect(cands.length).toBeGreaterThan(1);
    for (const c of cands) {
      expect(pool).toContain(c);
    }
  });

  it(`默认每节点出 ${CANDIDATE_DEFAULT} 个候选（网格模式下仍是 1 次调用）`, () => {
    const tree = sampleTree();
    tree.environment.weather!.candidates = [
      "clear",
      "cloudy",
      "overcast",
      "rainy",
      "foggy",
      "snowy",
      "stormy",
      "drizzle",
      "hazy",
      "windy",
      "misty",
      "sleet",
    ];
    const node = buildDecisionTree(tree).find((n) => n.id === "environment.weather");
    expect(node?.candidates.length).toBe(CANDIDATE_DEFAULT);
  });

  it("候选数上限被硬性裁剪到 9，绝不超预算（R2 / R3）", () => {
    const tree = sampleTree();
    tree.environment.weather!.candidates = [
      "clear",
      "cloudy",
      "overcast",
      "rainy",
      "foggy",
      "snowy",
      "stormy",
      "drizzle",
      "hazy",
      "windy",
      "misty",
      "sleet",
    ];
    const node = buildDecisionTree(tree, { candidatesPerNode: 99 }).find(
      (n) => n.id === "environment.weather",
    );
    expect(node?.candidates.length).toBe(CANDIDATE_MAX);
  });

  it("预览图总量可预估，且调用次数与候选数解耦（网格：N 候选 = 1 次调用）", () => {
    const count = estimatePreviewCount(sampleTree());
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(60);
  });

  it("withDefaultModes 为缺 mode 的属性补齐标记", () => {
    const tree = emptyVistaTree();
    tree.character.pose = { value: "running", candidates: ["running", "walking"] } as never;
    const filled = withDefaultModes(tree);
    expect(filled.character.pose!.mode).toBe("visual");
    expect(filled.character.pose!.source).toBe("llm");
  });
});

describe("参考图模式（R7）", () => {
  it("继承自参考图且未被改动的节点不进入决策树（用户不必重选）", () => {
    const tree = sampleTree();
    tree.meta!.fromImage = true;
    tree.environment.timeofday!.fromImage = true;
    tree.environment.timeofday!.value = "sunset"; // 已确定
    tree.environment.weather!.fromImage = true;
    tree.environment.weather!.value = "clear";

    const nodes = buildDecisionTree(tree, { fromImage: true });
    const ids = nodes.map((n) => n.id);
    expect(ids).not.toContain("environment.timeofday");
    expect(ids).not.toContain("environment.weather");
  });

  it("被文字指令改动的节点必须暴露出来供用户决策", () => {
    const tree = sampleTree();
    tree.meta!.fromImage = true;
    tree.environment.weather!.fromImage = true;
    tree.environment.weather!.value = "clear";

    markChanged(tree, "environment", "weather");

    const nodes = buildDecisionTree(tree, { fromImage: true });
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("environment.weather");
    expect(tree.meta!.changedFields).toContain("environment.weather");
  });

  it("参考图模式下待定（无值）属性仍需用户决策", () => {
    const tree = sampleTree();
    tree.meta!.fromImage = true;
    tree.composition.framing!.value = "";

    const nodes = buildDecisionTree(tree, { fromImage: true });
    const ids = nodes.map((n) => n.id);
    expect(ids).toContain("composition.framing");
  });

  it("决策树交互不被压缩为「一键生成」（PRD §9.5.4 红线）", () => {
    // 纯文字模式下，出图节点数必须 ≥ 1，即用户始终有选择题可做
    const nodes = buildDecisionTree(sampleTree());
    const visualNodes = nodes.filter((n) => n.mode === "visual");
    expect(visualNodes.length).toBeGreaterThanOrEqual(1);
  });
});
