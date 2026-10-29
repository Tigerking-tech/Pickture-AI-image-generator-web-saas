# 引擎矩阵：每个能力用「最合适的实现」，而不是一个引擎包打天下

> 这份文档回答一个问题：**为什么不能只靠一个 PhotoCraft 引擎？**
> 以及每个能力我们最终选了什么、为什么不选别的、许可有没有坑。

## 0. 结论先说

PhotoCraft 是一套**操作级**命令库（curves / levels / hueSaturation / smartSharpen…），
它能把"调色"翻译成命令，但**无法表达"什么是好调色"**：

- 它没有色温（white balance）概念，只有 RGB 三通道各自的曲线；
- 它没有"中性色保护"，所以灰底会被一起染色；
- 它没有"高光 roll-off"，所以 R 通道推过头就被裁成纯红——这就是番茄红的来源。

所以差距不在引擎快慢，而在**语义层级**。正确做法是：
**命令层保留（可回放、可校验、可批量），能力层按能力换最优实现。**

```
意图 ──► 模板（确定性链）──► 命令（可白名单校验）
                                │
                                ├─ 能纯算法做到位的 → Surepix 自研算子（grade.pro / contactShadow）
                                └─ 需要语义理解的 → 专用模型（背景分割 RMBG / BiRefNet）
```

## 1. 能力矩阵

| 能力 | 当前实现 | 备选（开源） | 选择理由 | 许可 |
|---|---|---|---|---|
| 主体分割（去背） | **RMBG-1.4** ONNX 44MB（[rmbg.ts](../src/lib/rmbg.ts)） | BiRefNet（MIT）、BEN2、RMBG-2.0、ISNet | CPU 上 300–600ms，产物 44MB 可随镜像分发；边缘质量足够电商图 | ⚠️ **非商业**（见 §3） |
| 蒙版后处理 / 边缘羽化 | **自研**：二值化→去小岛→填洞→EDT 距离场→高斯平滑→窄羽化（[rmbg.ts](../src/lib/rmbg.ts) `refineAlpha`） | guided filter（cv2.ximgproc）、Closed-form matting | 1024 mask 放大后的台阶是"几何问题"不是"滤波问题"，SDF 平滑才能把等值线拉直；实测半径波动 1.02px→0.31px | 自有 |
| 边缘去灰（de-fringe） | **自研**：`bleedColor` 让背景色向内渗透 | GIMP 的 color-to-alpha | 半透明边缘混着原背景色，不去灰会在白底上留一圈脏环 | 自有 |
| 调色（暖调/冷调/对比） | **自研** `grade.pro`：OKLab 亮度曲线 + 线性光色温 + 分离色调 + 中性保护（[grade.ts](../src/lib/grade.ts)） | 3D LUT（.cube）、OpenColorIO、Pillow ImageEnhance | 需要"中性色不染色 + 高光不裁剪"，通用库都不直接提供 | 自有 |
| 接触投影 | **自研** `contactShadow`：列底轮廓 + 垂直衰减带 | CSS box-shadow、Photoroom（闭源） | 整块 alpha 模糊在多物体场景会互相污染成灰雾（实测），列底法天然按物体分离 | 自有 |
| 锐化 | sharp `smartSharpen`（USM） | Real-ESRGAN、SwinIR | USM 在白底边缘会产生 ringing，故白底链**默认不锐化**；需要时只作用于主体内部 | sharp: Apache-2.0 |
| 放大 / 超分 | sharp Lanczos3 | Real-ESRGAN、4x-UltraSharp、SwinIR | 电商主图多为"缩到目标尺寸"，Lanczos 已够；真需要 4× 再上 GAN 模型（体积 60MB+，CPU 慢 10×） | 按模型 |
| 移除物体 / 扩图 | 未实现 | **LaMa**（Apache-2.0）、IOPaint、SD inpainting | LaMa 有 ONNX 版（~200MB），CPU 3–8s，是下一步最值得接的能力 | Apache-2.0 |
| 重打光 | 未实现 | IC-Light（部分组件非商用，见 §3） | 依赖 RMBG-1.4 的实现有许可风险，需换成 BiRefNet 后才能商用 | 混合 |
| 文字水印 | sharp + SVG 合成 | — | 矢量文字比位图字体清晰，且可任意旋转/透明 | 自有 |

## 2. 为什么"功能级选型"是对的

一个引擎包打天下的两个必然结果：

1. **短板决定体验**：调色算子差 → 整条链路看起来都差（用户看到的就是"番茄红"）。
2. **无法替换**：引擎把"去背"和"调色"焊死在一个二进制里，出了问题只能等上游。

按能力拆分后，每一格都可以独立换供应商，而且**换的时候有回归测试兜底**
（`tests/lib/grade.test.ts`、`tests/lib/rmbg.test.ts`、`tests/lib/refine-alpha.test.ts`）。

## 3. ⚠️ 许可风险（必须处理，否则不能商用）

| 组件 | 许可 | 能否商用 | 替代方案 |
|---|---|---|---|
| **BRIA RMBG-1.4** | `bria-rmbg-1.4`（非商业） | ❌ 需向 BRIA 购买授权 | **BiRefNet**（MIT，可商用）；或 RMBG-2.0 商用授权 |
| BiRefNet | MIT | ✅ | — |
| BEN2 | 需逐版本确认 | ⚠️ 待核 | 以官方 LICENSE 为准 |
| sharp / libvips | Apache-2.0 | ✅ | — |
| onnxruntime-node | MIT | ✅ | — |

**当前 demo 用的是 RMBG-1.4，只能用于技术验证，不能随产品商用。**
上线前必须二选一：

- 换 **BiRefNet**（MIT）：模型更大（~900MB fp32 / 200MB 量化），CPU 慢 2–3×，质量与 RMBG-1.4 同级或更好；
- 或向 BRIA 购买 RMBG 商用授权（按调用量计费）。

`src/lib/rmbg.ts` 已经把模型路径收敛在 `modelPath()` 一个函数里，换模型只改这一处 + `preprocess` 的归一化参数。

## 4. 下一步（按性价比排序）

1. **换 BiRefNet**（解决许可 + 提升边缘）—— 必须先做，否则商用不合规。
2. **接 LaMa**（消除/扩图）—— 这是目前完全缺失、但客户最常问的能力。
3. **3D LUT 支持**（`grade.pro` 之外的风格化调色）—— 让"胶片感/日系/暗黑"这类风格可配置而不写代码。
4. **超分**（Real-ESRGAN ONNX）—— 低分辨率素材放大到 2000px 以上时必需。

## 5. 如何验证选型没有退步

```bash
npm test                 # 171 个单测，含调色/去背/羽化的回归断言
npm run qc               # 视觉质检门禁（主体保留 / 背景纯度 / 边缘羽化 / 轮廓贴合）
npm run edge:audit       # 12 处边界 ×5 放大宫格，人工复核用
```

任何一次"换引擎"，都必须让这三条同时为绿，否则视为退步。
