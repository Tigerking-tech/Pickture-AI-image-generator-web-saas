# 两级路由 + LLM 兜底：意图判端架构方案

> 适用读者：技术负责人 / 老板对齐。本文说明 Surepix "客户一句话 → 判端给 PhotoCraft 还是文生图还是混合" 的路由机制现状、目标架构与落地顺序。

---

## 1. 现状（已核实，非设想）

| 模块 | 文件 | 状态 |
|---|---|---|
| 路由判端 | `src/lib/router.ts` → `route()` | ✅ 真实存在，分 `photocraft / hybrid / regenerate / reject` 四类 |
| 意图识别 | `src/lib/whitelist.ts` → `detectIntents()` | ⚠️ **正则关键词匹配，非 LLM** |
| 确定性执行 | `src/lib/pc.ts` + PhotoCraft CLI | ✅ 真实可用（卖点） |
| 文生图执行 | `src/lib/pipeline.ts`（regenerate/hybrid 分支） | ⚠️ **此前是空壳**（"not enabled in demo"），本次已建成真实路径 |
| 文生图后端 | `src/lib/generative.ts` | ✅ 新增：Provider 抽象 + fal 真实实现 + mock 占位 |

**关键事实（务必对齐的一点）**：当前"判端"靠正则，不是大模型。"把背景换成白底"是被关键词 `白底/background` 命中，而不是模型"看懂"了这句话。正则的硬伤：单字误判（`石/木/布` 会误触 `change_material`）、漏覆盖（高清修复/加物体/换文字/换脸全空档）、听不懂 paraphrase（"更通透""更高级"直接 reject）。

---

## 2. 目标架构：两级路由（regex 快路径 + LLM 兜底）

不"用 LLM 全替换正则"，而是**两级**：

```
客户指令
   │
   ▼
[第 1 级] 正则快路径  detectIntents()           ← 现有，~0ms / $0 / 无外部依赖
   │ 高置信度命中？
   ├─ 是 → 直接走 photocraft / reject（绝大多数常见指令）
   │
   └─ 否（无命中 / 信号冲突）→ [第 2 级]
                                      │
                                      ▼
                         [第 2 级] LLM 判端 + 翻译   ← 新增，仅模糊请求触发（~10–20%）
                                      输出结构化 JSON（见 §3）
                                      │
                                      ├─ photocraft → 原确定性管线
                                      ├─ regenerate → 文生图后端（generative.ts）
                                      └─ hybrid     → 先确定性链 + 再文生图
```

**为什么是两级而非全 LLM**：纯 LLM 路由会为每一次编辑（含"调亮一点"）都加一次模型调用，直接对冲"确定性、不计调用费、可批量"的卖点，并引入幻觉误判与外部单点故障。两级把 LLM 成本/风险压到"拿不准的少数请求"上。

---

## 3. LLM 应返回的 JSON 结构（契约）

第 2 级 LLM 只产出**结构化决策**，不碰任何命令。下游 `router.ts` 消费它：

```jsonc
{
  "route": "photocraft" | "hybrid" | "regenerate" | "reject",
  "confidence": 0.0..1.0,            // <0.5 时回退 reject 并反问客户
  "intent": "swap_background",       // 标准化意图 id（见 whitelist.ts 的 INTENT_TEMPLATES / GENERATIVE_INTENTS）
  "params": { "color": "white" },   // 从人话里抽取的结构化参数
  "chain": [                         // 仅 photocraft/hybrid 时由 LLM 翻译出的确定性命令链
    { "cmd": "image.imageSize", "params": { "width": 800, "height": 800 } }
  ],
  "generative": ["swap_background"], // 仅 hybrid/regenerate 时存在的语义意图
  "reason": "用户要把背景换成白底，属语义级改动"
}
```

**LLM 最值钱的用法是"翻译"而非"判端"**：把"让产品更通透"翻成一条 PhotoCraft 命令链（轻微提饱和+对比+背景提亮），真正执行的还是确定性引擎、还是可逐元素校验。这样既听懂人话，又保住产品命根子。`generative` 字段只留给真正语义级的活（换背景/换材质/扩图等）。

---

## 4. 与现有 `router.ts` 的对接方式

新增一个薄包装，不重写现有逻辑：

```ts
// router.ts（新增）
import { callLlmRouter } from "./llm-router"; // 新增文件，封装 fetch LLM + JSON 解析 + 校验

export async function routeSmart(instruction: string, ctx) {
  const fast = route(instruction, ctx);          // 第 1 级：正则
  const confident =
    (fast.route === "photocraft" && fast.plan?.chain?.length) ||
    fast.route === "reject";
  if (confident) return fast;                    // 高置信度直接走，不调 LLM
  const llm = await callLlmRouter(instruction, ctx); // 第 2 级：仅模糊时
  return llm ?? fast;                            // LLM 失败则回落正则结果
}
```

`pipeline.ts` 把 `route(...)` 换成 `routeSmart(...)` 即可，其余执行/保真/回退逻辑不动。文生图后端（`generative.ts`）已经真实可用，LLM 判出 `regenerate/hybrid` 后能真正出图。

---

## 5. 文生图后端（已建成，`src/lib/generative.ts`）

- **Provider 抽象**：`GenerativeProvider` 接口 + `FalProvider`（真实调 `fal.run` 上的 img2img/inpainting）+ `MockProvider`（dev/CI 无 key 也能跑通管线）。
- **默认 `mock`**：缺 key 不挂；生产设 `GENERATIVE_PROVIDER=fal` + `FAL_KEY` 即切真模型（默认 `fal-ai/flux/dev/image-to-image`，可换 SDXL / 专用 inpainting）。
- **每意图 prompt 模板**：`swap_background / change_material / remove_object / change_object_color / style_transfer / extend_image`，用户原话作为补充拼入。
- **管线接入**：`pipeline.ts` 的 `regenerate` 直接生成；`hybrid` 先跑确定性命令链、再把结果交生成模型补语义差异。

---

## 6. 成本估算（每请求增量）

| 项 | 仅确定性（现状） | + 两级路由（模糊请求走 LLM） | + 文生图（regenerate/hybrid） |
|---|---|---|---|
| 延迟 | ~40ms | +0（命中正则）/ +0.3–1.5s（LLM） | +1–5s（生成模型） |
| 调用费 | $0 | 仅 ~10–20% 请求 ≈ $0.001–0.01 | 每次生成 ≈ $0.01–0.05（fal 计费） |
| 外部依赖 | 无 | LLM API（仅模糊时） | 生成模型 API |
| 批量 N 张 | 免费本地 | LLM 仅作用于模糊指令 | 生成类按张计费 |

**结论**：成本可控。确定性指令永远免费快速；LLM 与生成模型只花在真正需要的少数请求上。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM 误判（把"调清楚价格签"判成生成） | temperature=0 + 输出 JSON Schema 校验 + 低置信度回落 `reject` 反问；保留 `router.ts` 白名单兜底 |
| 生成模型引入伪影（LOGO/文字变形） | 仅 `generative` 意图走生成；确定性部分仍走 PhotoCraft + 逐元素保真；生成结果做轻量结构体检 |
| 生成 API 宕机 | `generative.ts` 失败时 `pipeline` 返回明确错误而非崩溃；可加降级（重试/换模型） |
| 单字正则误判（石/木/布） | 补正则阶段（A）修正单字匹配 + 加边界（如 `(?<!)石` 或要求成词），过渡期由 LLM 二级兜底 |

---

## 8. 落地顺序（建议）

1. **C — 文生图后端（本次已完成）**：`generative.ts` + `pipeline.ts` 接入。让任何路由"算数"。
2. **A — 补正则漏洞（建议下一步）**：修单字误判、补全高清修复/加物体/换文字等常见意图。不动 LLM。
3. **B — 加 LLM 二级路由（最后）**：实现 §3–§4 的 `llm-router.ts` + `routeSmart()`，仅模糊请求触发。

> 顺序的理由：在文生图后端建成前，加 LLM 路由只是把请求扔给空壳，毫无意义。先让后端"能出图"，再补正则，最后才用 LLM 兜底长尾。
