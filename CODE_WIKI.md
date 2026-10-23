# Pictory — Code Wiki

> 一句话把画面拆成要素树，每个要素出几张候选图让用户点选，最后合成一张终图。
> 本 Wiki 是项目的结构化技术文档，覆盖架构、模块、关键函数、依赖与运行方式。

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术栈](#2-技术栈)
3. [整体架构](#3-整体架构)
4. [核心概念](#4-核心概念)
5. [模块职责详解](#5-模块职责详解)
   - 5.1 [lib/ 核心库](#51-lib-核心库)
   - 5.2 [app/ 路由与页面](#52-app-路由与页面)
   - 5.3 [components/ 组件](#53-components-组件)
   - 5.4 [supabase/ 数据库](#54-supabase-数据库)
6. [关键类与函数说明](#6-关键类与函数说明)
7. [依赖关系图](#7-依赖关系图)
8. [API 路由清单](#8-api-路由清单)
9. [数据库 Schema](#9-数据库-schema)
10. [环境变量](#10-环境变量)
11. [项目运行方式](#11-项目运行方式)
12. [测试体系](#12-测试体系)

---

## 1. 项目概述

**Pictory** 是一个基于"视觉决策树"范式的 AI 出图产品。它与传统文生图（Midjourney / Stable Diffusion 式）的核心差异在于：

| 维度 | 传统文生图 | Pictory |
|------|-----------|---------|
| 输入 | 100–200 词的长 prompt | 一句话 |
| 过程 | 反复"摇骰子"重生成 6–10 次 | LLM 拆句 → 每个要素出 2–4 张候选 → 用户点选 |
| 终图 | 多次中挑一张 | 决策确定后**只生成一次** |
| 单张可用图成本 | $0.15–0.40 | ~$0.10 |
| 耗时 | 15–30 分钟 | 2–5 分钟 |

产品定位：**把"写 prompt"这件事变成"做选择题"**，降低普通用户的使用门槛，同时用"廉价预览图 + 昂贵终图只出一次"的成本结构控制单张成本。

项目基于一套 SaaS 脚手架（Next.js + Supabase + Creem）二次开发而来，脚手架提供认证、支付、订阅、License、积分、折扣码等商业底座，Pictory 在其上叠加了 AI 出图与要素拆解的核心业务。

---

## 2. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 框架 | Next.js 16（App Router）+ React 19 + TypeScript strict | 服务端组件 + 客户端组件混合 |
| 数据库 | Supabase（Postgres + Auth + RLS + Storage） | 行级安全，所有表均启用 RLS |
| 支付 | Creem（Merchant of Record） | 13 种 webhook 事件，License Keys，折扣码 |
| 生图 | fal.ai / 火山引擎 Ark / 腾讯混元 / 阿里云百炼 | 可切换，通过 `IMAGE_PROVIDER` 环境变量 |
| 拆句 LLM | OpenAI / OpenRouter / 腾讯混元（TokenHub） | 可切换，通过 `TEXT_PROVIDER` 环境变量 |
| 样式 | Tailwind CSS 4 | Neo-brutalist 设计系统 |
| 邮件 | Resend | 欢迎邮件 + 支付确认 |
| 限流 | Upstash Redis（滑动窗口） | 敏感 API 路由限流 |
| 图像处理 | sharp | 图片转码、网格切割、缩略图 |
| 测试 | Vitest（单元）+ Playwright（E2E） | 130+ 单元测试 |
| Lint/Format | Biome | |

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      客户端（浏览器）                          │
│                                                             │
│  /create（创作工作台） ──┐                                   │
│  /gallery（画廊）        ├── fetch ──┐                        │
│  /pricing /dashboard    ──┘          │                        │
└─────────────────────────────────────┼────────────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js App Router（服务端）               │
│                                                             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐     │
│  │ api/decompose│   │ api/generate │   │ api/selections│    │
│  │ （拆句→VISTA）│   │（预览/终图）  │   │（飞轮埋点）    │    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘     │
│         │                  │                  │             │
│  ┌──────▼──────────────────▼──────────────────▼───────┐     │
│  │                  lib/ 核心逻辑层                     │     │
│  │  vista.ts / elementConfig.ts / imageGrid.ts          │     │
│  │  modelRouter.ts / credits.ts / jobs.ts               │     │
│  │  providers/image + providers/text（多供应商适配）      │     │
│  └──────────────────────────┬──────────────────────────┘     │
│                             │                                │
│  ┌──────────────────────────▼──────────────────────────┐     │
│  │              lib/supabase/*（数据访问层）              │     │
│  └──────────────────────────┬──────────────────────────┘     │
└─────────────────────────────┼───────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌────────────────┐    ┌─────────────────┐
│   Supabase    │    │  Creem（支付）  │    │  AI 供应商 API   │
│ Postgres/RLS  │    │ subscriptions  │    │ fal / 火山 / 阿里 │
│ Auth/Storage  │    │ licenses       │    │ OpenAI / 腾讯    │
└───────────────┘    └────────────────┘    └─────────────────┘
```

### 核心数据流（一次创作）

1. 用户在 `/create` 输入一句话
2. 前端 `POST /api/decompose` → LLM 把句子拆成 VISTA 要素树（8 组 40+ 属性）
3. 前端按决策树顺序，对每个 visual 属性 `POST /api/generate {mode:preview}` 生成候选图（网格模式：1 次调用画 N 格 → 本地切割）
4. 用户点选候选 → 把选中值写回要素树
5. 全部选完后 `POST /api/generate {mode:final}` → 用完整要素树合成终图，扣 10 积分
6. 终图持久化到 Supabase Storage，同时记录到 `works` 表

---

## 4. 核心概念

### 4.1 VISTA Schema（视觉要素树）

定义在 [lib/vista.ts](file:///workspace/src/lib/vista.ts)。把画面拆解为 8 个分组、40+ 属性：

| 分组 | 说明 | 典型属性 |
|------|------|---------|
| info | 作品元信息 | name, description |
| camera | 相机参数 | model, lens_type, focal_length, fstop, iso, shutter_speed, aspect_ratio |
| style | 风格 | palette, lut, year, aesthetic, engine |
| environment | 环境 | location, outdoor, timeofday, weather, setting |
| lighting | 光线 | type, direction, intensity, temperature, color, softness, contrast, shadows |
| character | 主体 | species, pose, orientation, expression, clothing, makeup, hairstyle |
| composition | 构图 | framing, perspective, focal_point, rule_of_thirds, motion_blur |
| effects | 特效 | color_grade, grain, vignette, glow, fog, lens_flare |

每个属性的结构：
```ts
interface VistaAttributeValue {
  value: string;           // 当前选定值
  candidates: string[];    // 候选值（2–4 个）
  mode: DecisionMode;      // "visual" | "text" | "auto"
  source?: ValueSource;    // "llm" | "image" | "user"
  fromImage?: boolean;     // 参考图模式：是否由图识别而来
  changed?: boolean;       // 参考图模式：是否被用户文字改动
}
```

关键函数：
- `toPrompt(tree)` —— 把要素树序列化为英文生图 prompt，按"主体→环境→光线→构图→镜头→风格→效果"的叙述顺序
- `normalizeOrientation(tree)` —— 把朝向值强制规范为纯朝向（剥掉动作词，避免与 pose 冲突）
- `stripUnknownAttributes(raw)` —— 丢弃模型编造的 schema 外字段
- `validateVistaTree(input)` —— 结构校验
- `cloneVistaTree(tree)` —— 深拷贝，避免 UI 与请求间共享引用

### 4.2 决策树（Decision Tree）

定义在 [lib/elementConfig.ts](file:///workspace/src/lib/elementConfig.ts)。决定"哪些属性出图选 / 文字选 / 自动定"以及节点顺序。

**三种决策方式**：
- `visual`：出图选 —— 生成候选图让用户点选
- `text`：文字选 —— 下拉或输入框
- `auto`：自动定 —— LLM 直接定，不打扰用户

**节点顺序**（先钉死主体与光线，再细化）：
```
character.pose → character.orientation → lighting.direction
→ environment.timeofday → environment.weather
→ composition.framing → style.aesthetic
```

**候选数策略**：
- 免费档：每节点 4 个候选（2x2 网格，1 次调用）
- 付费档：每节点 9 个候选（3x3 网格，1 次调用）
- 模型只吐 2 个，其余由 `ensureVisualCandidates` 从属性池补齐

关键函数：
- `buildDecisionTree(tree, opts)` —— 由要素树构建有序决策节点列表
- `ensureVisualCandidates(tree, min)` —— 补齐 visual 属性的候选数
- `withDefaultModes(tree)` —— 给所有属性补 mode/source 默认值
- `estimatePreviewCount(tree, opts)` —— 预览图总量预估（成本控制）

### 4.3 网格出候选（Grid-of-candidates）

定义在 [lib/imageGrid.ts](file:///workspace/src/lib/imageGrid.ts)。核心成本优化：一个决策节点本来要出 N 张候选图 = N 次 API 调用，改成"一次调用画一张 N 格网格图 + 本地按坐标切割"，成本降到 1/N。

关键设计：
- 统一用满格方阵（2x2 / 3x3），模型对非满格布局遵循差
- `buildGridPrompt(candidates, layout, opts)` —— 三段式提示词：公共约束置顶 + 负面约束（朝向类）+ 逐格标注
- `sharedConstraintOf(candidates)` —— 提取所有候选共有的描述片段作为跨面板一致性约束
- `sliceGrid(input, layout, count)` —— 用 sharp 按坐标切割
- 失败自动回退到逐张串行生成，绝不返回残缺或伪造的候选图

### 4.4 数据飞轮（Data Flywheel）

定义在 [supabase/migrations/006_learning.sql](file:///workspace/supabase/migrations/006_learning.sql) 与 [lib/](file:///workspace/src/lib/)。

**学习点 A（已实现）**：选择信号沉淀
- 每次用户在某节点选了哪个候选，写入 `selections` 表
- 会话级满意度信号：下载终图=正，重出>3次=负

**学习点 B（待实现，需 1000 样本）**：全局候选重排
- 把历史选中频率高的候选值排到前面

**学习点 C（待实现）**：个性化
- 根据用户历史偏好调整候选

**学习点 D（待实现）**：few-shot 回灌
- 把高满意度拆解作为示例喂给拆句 LLM

红线（PRD §9.5.4）：飞轮只优化候选排序与默认项，**绝不替用户做决定**。

### 4.5 异步作业（Job Polling）

定义在 [lib/jobs.ts](file:///workspace/src/lib/jobs.ts)。

**为什么需要**：拆句 40–70s、出图 15–25s，而线上外网代理约 15s 就会以 HTTP 524 掐断连接。改为"短请求提交任务 + 短请求轮询结果"，每次 HTTP 都在 1s 内返回。

```ts
interface AsyncJob {
  status: "pending" | "done" | "error";
  progress?: string;
  result?: unknown;
  message?: string;
  createdAt: number;
}
```

- `createJob()` → 返回 jobId，挂在 `globalThis` 上（dev 热更新也保住）
- `updateJob(id, patch)` / `completeJob(id, result)` / `failJob(id, message)`
- TTL 10 分钟，自动 sweep
- 单进程部署适用；迁 Serverless 时换 Supabase 表或 Redis

### 4.6 套餐 → 模型路由

定义在 [lib/modelRouter.ts](file:///workspace/src/lib/modelRouter.ts)。

| 套餐 | 拆句模型 | 预览模型 | 终图模型 | 月度积分 | 候选数 | Pro终图体验 |
|------|---------|---------|---------|---------|--------|------------|
| free | gpt-4o-mini | FLUX schnell | FLUX Pro | 60 | 4 | 2 次 |
| starter | gpt-4o | FLUX schnell | FLUX Pro | 600 | 9 | 无限 |
| pro | gpt-4o | FLUX schnell | FLUX Pro | 2400 | 9 | 无限 |

关键函数：
- `routeForPlan(plan)` —— 获取套餐对应路由配置
- `candidatesForPlan(plan)` —— 每节点候选数（免费4/付费9）
- `resolveFinalModel(plan, proTrialsUsed)` —— 免费层超出体验次数则降级为预览模型
- `normalizePlan(input)` —— 未知套餐一律降级 free（成本保守）

---

## 5. 模块职责详解

### 5.1 lib/ 核心库

| 文件 | 职责 |
|------|------|
| [vista.ts](file:///workspace/src/lib/vista.ts) | VISTA schema 定义、属性元数据、校验、序列化、归一化 |
| [elementConfig.ts](file:///workspace/src/lib/elementConfig.ts) | 决策树配置：属性决策方式、节点顺序、候选数策略 |
| [imageGrid.ts](file:///workspace/src/lib/imageGrid.ts) | 网格出候选：提示词构造、公共约束提取、网格切割 |
| [modelRouter.ts](file:///workspace/src/lib/modelRouter.ts) | 套餐→模型路由、积分额度、候选数、参考图配额 |
| [credits.ts](file:///workspace/src/lib/credits.ts) | 积分钱包：读余额、原子扣减、参考图配额、月度补齐 |
| [jobs.ts](file:///workspace/src/lib/jobs.ts) | 异步作业表（内存）：拆句与生图共用 |
| [storage.ts](file:///workspace/src/lib/storage.ts) | 作品图持久化：WebP 转码、两级尺寸、同域代理 |
| [rate-limit.ts](file:///workspace/src/lib/rate-limit.ts) | Upstash 滑动窗口限流 |
| [upstream-error.ts](file:///workspace/src/lib/upstream-error.ts) | 上游报错人话翻译（429/402/403 → 可执行提示） |
| [entitlements.ts](file:///workspace/src/lib/entitlements.ts) | 套餐功能权限映射 |
| [seo.ts](file:///workspace/src/lib/seo.ts) | 站点常量、Metadata 工厂、JSON-LD 生成器 |
| [creem.ts](file:///workspace/src/lib/creem.ts) | Creem SDK 客户端（自动识别 test/prod） |
| [email.ts](file:///workspace/src/lib/email.ts) | Resend 邮件发送（欢迎/支付确认） |
| [providers/types.ts](file:///workspace/src/lib/providers/types.ts) | 图像/文本 provider 抽象接口 |
| [providers/image/](file:///workspace/src/lib/providers/image) | 图像 provider 实现：fal / volcano / tencent / aliyun / mock |
| [providers/text/](file:///workspace/src/lib/providers/text) | 文本 provider 实现：openai / openrouter / tencent / mock |
| [demo/mode.ts](file:///workspace/src/lib/demo/mode.ts) | Demo 模式检测 |
| [demo/store.ts](file:///workspace/src/lib/demo/store.ts) | Demo 内存数据 store |
| [supabase/client.ts](file:///workspace/src/lib/supabase/client.ts) | 浏览器客户端 |
| [supabase/server.ts](file:///workspace/src/lib/supabase/server.ts) | 服务端 SSR 客户端 |
| [supabase/admin.ts](file:///workspace/src/lib/supabase/admin.ts) | Service role 客户端（webhook/后台） |
| [supabase/middleware.ts](file:///workspace/src/lib/supabase/middleware.ts) | 会话刷新中间件 |

### 5.2 app/ 路由与页面

#### 页面路由

| 路径 | 说明 |
|------|------|
| `/` | Landing 页：价值主张 + 真实作品预览条 |
| `/create` | 创作工作台（三栏：决策树步骤 / 候选图画布 / 要素摘要） |
| `/gallery` | 公开画廊（瀑布流 + lightbox） |
| `/pricing` | 定价页（Free/Starter/Pro + 折扣码输入） |
| `/dashboard` | 用户仪表盘（订阅状态、积分、交易记录） |
| `/dashboard/transactions` | 支付历史 |
| `/dashboard/licenses` | License Key 管理 |
| `/dashboard/admin` | 管理后台 |
| `/admin/flywheel` | 数据飞轮看板（仅 ADMIN_EMAIL 可访问） |
| `/login` `/signup` `/callback` | 认证（Email + Google + GitHub OAuth） |

#### API 路由

详见 [第 8 节 API 路由清单](#8-api-路由清单)。

### 5.3 components/ 组件

| 组件 | 职责 |
|------|------|
| [GalleryGrid.tsx](file:///workspace/src/components/GalleryGrid.tsx) | 画廊瀑布流网格 + lightbox |
| [pricing-card.tsx](file:///workspace/src/components/pricing-card.tsx) | 定价卡片 |
| [pricing-section.tsx](file:///workspace/src/components/pricing-section.tsx) | 定价区 + 折扣码输入 |
| [subscription-card.tsx](file:///workspace/src/components/subscription-card.tsx) | 订阅状态展示 |
| [cancel-dialog.tsx](file:///workspace/src/components/cancel-dialog.tsx) | 两步取消确认 |
| [upgrade-dialog.tsx](file:///workspace/src/components/upgrade-dialog.tsx) | 套餐切换（含按比例计费） |
| [seat-manager.tsx](file:///workspace/src/components/seat-manager.tsx) | 团队席位管理 |
| [credits-card.tsx](file:///workspace/src/components/credits-card.tsx) | 积分余额 + 近期活动 |
| [license-card.tsx](file:///workspace/src/components/license-card.tsx) | License Key 展示与激活 |
| [transaction-list.tsx](file:///workspace/src/components/transaction-list.tsx) | 分页支付历史 |
| [alert-banner.tsx](file:///workspace/src/components/alert-banner.tsx) | 退款/争议告警 |
| [oauth-buttons.tsx](file:///workspace/src/components/oauth-buttons.tsx) | Google + GitHub OAuth |
| [checkout-sync.tsx](file:///workspace/src/components/checkout-sync.tsx) | 支付后 URL 同步 |
| [Analytics.tsx](file:///workspace/src/components/Analytics.tsx) | 统计脚本 |
| [JsonLd.tsx](file:///workspace/src/components/JsonLd.tsx) | JSON-LD 结构化数据 |

### 5.4 supabase/ 数据库

详见 [第 9 节 数据库 Schema](#9-数据库-schema)。

---

## 6. 关键类与函数说明

### 6.1 拆句流程（api/decompose/route.ts）

**入口**：`POST /api/decompose`，参数 `{ sentence, imageUrl?, plan?, sessionId?, async? }`

核心函数：

- **`decomposeOnce(text, opts)`** —— 非流式拆解主逻辑
  1. 分 3 批并行调用 LLM（character+environment / lighting+composition / style+effects）
  2. 缺哪组就补拆哪组（一轮）
  3. 全量兜底（分批失败时）
  4. `finalizeTree` 整理结果

- **`finalizeTree(parsed, sentence, model, imageUrl, sessionId, perNode)`** —— 结果整理
  1. `stripUnknownAttributes` —— 丢未知键
  2. `normalizeOrientation` —— 朝向归一化
  3. `ensureVisualCandidates` —— 补齐候选
  4. `withDefaultModes` —— 补默认 mode/source
  5. `validateVistaTree` —— 结构校验
  6. 写入 `decompositions` 表留档

- **`findCachedTree(sentence, model, imageUrl)`** —— 同句拆解缓存，命中则 0 等待

- **`sseStream(run)`** —— SSE 流式响应，含 4s 心跳保活

- **`buildSchemaHint(onlyGroups?, visualCount?)`** —— 生成给 LLM 的 schema 提示
  - camera 组整组跳过（消费级场景无意义）
  - visual 属性只让模型吐 2 个候选，其余由属性池补齐（压缩输出量）

### 6.2 生图流程（api/generate/route.ts）

**入口**：`POST /api/generate`，参数 `{ mode, tree?, candidates?, attribute?, referenceUrl?, varySubject?, async? }`

核心函数：

- **`handleGenerate(raw)`** —— 生图主逻辑
  - `mode=preview`：节点预览生图
  - `mode=final`：终图合成

- **`tryGridPreview(img, candidates, model, uid, opts)`** —— 网格出候选
  1. 调 `img.generateGrid` 画一张网格图
  2. `sliceGrid` 按坐标切割
  3. 逐格 `persistImageBuffer` 转存
  4. 任一环节失败返回 null，回退逐张串行

- **预览模式的 identity-block 技巧**：
  - 树中其他已确定要素 = 固定的 identity block
  - 当前节点的候选值 = 唯一变量
  - 逐个替换后用 `toPrompt` 组装成完整提示词
  - 这样每张候选图都保留主体/场景/光线，只变当前要素

- **终图模式的计费顺序**：
  1. 先校验余额（不足直接 402，不出图）
  2. 出图成功
  3. **此时才扣分**（所有失败路径零扣费）

### 6.3 前端创作工作台（app/create/page.tsx）

核心交互：

- **`runDecompose()`** —— 提交拆句任务 + 短轮询取结果
- **`handlePreview(node)`** —— 生成某节点的候选图
- **`handlePick(nodeId, group, key, value, candidateIndex, imageUrl)`** —— 用户点选候选，写回要素树，记住选中图作为后续节点的主体锚
- **`handleFinal()`** —— 合成终图
- **`track(payload)`** —— 数据飞轮埋点（选择信号 + 满意度）
- **`generateViaJob(body)`** —— 生图走"提交任务 + 短轮询"

### 6.4 Provider 抽象层

**`ImageProvider` 接口**（[providers/types.ts](file:///workspace/src/lib/providers/types.ts)）：

```ts
interface ImageProvider {
  name: string;
  isConfigured(): boolean;
  missingKeyMessage(): string;
  generate(req: ImageGenRequest): Promise<ImageGenResult>;
  generateGrid?(req: ImageGenRequest): Promise<ImageGenResult>;  // 可选：网格能力
}
```

**`TextProvider` 接口**：

```ts
interface TextProvider {
  name: string;
  isConfigured(): boolean;
  missingKeyMessage(): string;
  decompose(req: TextDecomposeRequest): Promise<TextResult>;
  decomposeStream?(req, onDelta): Promise<TextResult>;  // 可选：流式
}
```

**设计原则**：业务路由只依赖接口，不写死任何供应商的 URL/密钥。切换供应商 = 改一个环境变量 + Redeploy。新增供应商 = 加一个实现文件 + 在 index.ts 注册一行。

### 6.5 积分系统（lib/credits.ts）

- **`getPlan(userId)`** —— 读用户套餐（未知一律降级 free）
- **`getBalance(userId)`** —— 读余额（无记录返回 null）
- **`spendCredits(userId, amount, reason)`** —— 原子扣积分（底层 `spend_credits()` for update 行锁，防并发超扣）
- **`spendOneWork(userId, reason)`** —— 扣一个作品的积分（10 分）
- **`consumeRefUploadQuota(userId, plan)`** —— 参考图上传配额（免费 月≤8/日≤3）
- **`ensureMonthlyGrant(userId)`** —— 跨月补齐订阅积分（greatest 保护已购积分不过期）

### 6.6 存储系统（lib/storage.ts）

- **`persistImage(sourceUrl, basePath)`** —— 把远端临时图转存为自有存储的两级 WebP
  - 大图 ≤1536px q85（lightbox/下载）
  - 缩略图 ≤640px q70（瀑布流）
- **`persistImageBuffer(input, basePath)`** —— 内存图转存（网格切割出的单格）
- **`toSameOrigin(publicUrl)`** —— 本地 Supabase 时把公网地址改写成同域 `/sb/...` 路径，由 next.config.ts rewrite 反向代理
- **`removeImage(basePath)`** —— 删除两级文件

---

## 7. 依赖关系图

### 核心模块依赖

```
create/page.tsx
  ├── elementConfig (buildDecisionTree)
  ├── modelRouter (candidatesForPlan)
  ├── vista (VistaTree, VistaGroup)
  └── fetch → /api/decompose, /api/generate, /api/selections, /api/credits

api/decompose/route.ts
  ├── credits (getPlan)
  ├── elementConfig (ensureVisualCandidates, withDefaultModes, CANDIDATE_DEFAULT)
  ├── jobs (createJob, completeJob, failJob, getJob, updateJob)
  ├── modelRouter (candidatesForPlan, normalizePlan)
  ├── providers/text (getTextProvider)
  ├── providers/text/schemaHint (buildSchemaHint)
  ├── supabase/admin, supabase/server
  ├── upstream-error
  └── vista (emptyVistaTree, normalizeOrientation, stripUnknownAttributes, validateVistaTree)

api/generate/route.ts
  ├── credits (CREDITS_PER_WORK, getBalance, getPlan, spendOneWork)
  ├── elementConfig (withDefaultModes)
  ├── imageGrid (buildGridPrompt, sliceGrid, gridLayoutFor, GRID_*)
  ├── jobs
  ├── modelRouter (candidatesForPlan, normalizePlan, resolveFinalModel, routeForPlan)
  ├── providers/image (getImageProvider)
  ├── rate-limit
  ├── storage (persistImage, persistImageBuffer)
  ├── supabase/server
  ├── upstream-error
  └── vista (cloneVistaTree, emptyVistaTree, toPrompt, validateVistaTree)

providers/text/openai.ts
  └── providers/text/schemaHint (buildSchemaHint)

providers/image/aliyun.ts, volcano.ts, tencent.ts, fal.ts
  └── providers/types

modelRouter.ts  ← 无业务依赖（纯配置）
elementConfig.ts ← vista.ts
imageGrid.ts    ← sharp
jobs.ts         ← 无依赖（内存 Map）
vista.ts        ← 无依赖（纯 schema）
```

### 技术依赖

| 包 | 用途 |
|----|------|
| next | 框架 |
| @supabase/ssr, @supabase/supabase-js | Supabase 客户端 |
| @creem_io/nextjs, creem | Creem 支付 SDK |
| @upstash/ratelimit, @upstash/redis | 限流 |
| resend, @react-email/components | 邮件 |
| sharp | 图像处理 |
| lucide-react | 图标 |
| tailwindcss | 样式 |
| vitest, @testing-library/react, jsdom | 单元测试 |
| @playwright/test | E2E 测试 |
| @biomejs/biome | Lint/Format |

---

## 8. API 路由清单

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/decompose` | 拆句：句子→VISTA 要素树（支持同步/异步/流式） |
| GET | `/api/decompose?job=` | 异步拆句任务轮询 |
| POST | `/api/generate` | 生图：preview（节点候选）/ final（终图） |
| GET | `/api/generate?job=` | 异步生图任务轮询 |
| POST | `/api/selections` | 数据飞轮埋点（选择信号 + 满意度） |
| GET | `/api/credits` | 查询积分余额与套餐 |
| POST | `/api/credits/spend` | 扣积分 |
| POST | `/api/checkout` | 创建 Creem 支付会话（含折扣码） |
| GET | `/api/checkout/success` | 支付成功回调 |
| POST | `/api/billing-portal` | Creem 账单门户 |
| POST | `/api/subscriptions/cancel` | 取消订阅（立即/到期） |
| POST | `/api/subscriptions/upgrade` | 升级/降级套餐 |
| POST | `/api/subscriptions/update-seats` | 更新团队席位 |
| POST | `/api/discounts` | 创建/查询折扣码 |
| GET | `/api/transactions` | 交易历史（分页） |
| POST | `/api/licenses/activate` | 激活 License |
| POST | `/api/licenses/validate` | 校验 License |
| POST | `/api/licenses/deactivate` | 注销 License |
| POST | `/api/feedback` | 用户反馈 |
| POST | `/api/webhooks/creem` | Creem webhook（13 种事件，HMAC 验签，幂等） |

---

## 9. 数据库 Schema

### 表清单

| 表 | 用途 | 来源迁移 |
|----|------|---------|
| `profiles` | 用户档案（含 plan、参考图配额字段） | 002 + 003 |
| `subscriptions` | Creem 订阅状态 | 002 |
| `credits` | 积分钱包余额 | 002 |
| `credit_transactions` | 积分收支审计日志 | 002 |
| `licenses` | License Key | 002 |
| `webhook_events` | webhook 幂等处理 | 002 |
| `billing_events` | 退款/争议跟踪 | 002 |
| `works` | 作品（终图 + 要素树 + 预览） | 003 |
| `selections` | 数据飞轮埋点 | 003 + 006 + 007 |
| `ref_uploads` | 参考图上传记录 | 003 |
| `consents` | GDPR 即时细分同意 | 003 |
| `decompositions` | 拆解结果留档 | 006 |

### 关键函数

| 函数 | 用途 |
|------|------|
| `spend_credits(p_user_id, p_amount, p_reason)` | 原子扣积分（for update 行锁） |
| `monthly_credit_grant(p_plan)` | 各套餐月度积分额度（free 60 / starter 600 / pro 2400） |
| `ensure_quota_periods(p_user)` | 跨月/跨天重置计数桶，补齐订阅积分 |
| `consume_ref_upload_quota(p_month_max, p_day_max, p_user_id)` | 参考图上传配额原子递增 |

### RLS 策略

所有表均启用 Row Level Security：
- `works`：本人可增删改查；公开作品所有人可读
- `selections`：本人可查；插入允许匿名（user_id 为 null 的会话级埋点）
- `ref_uploads`：本人可读写
- `consents`：本人可插入、可查看；不允许修改（GDPR 证据留痕）
- `decompositions`：用户只能读自己的；写入走 service role
- service role（webhook/后台）绕过 RLS

---

## 10. 环境变量

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key（服务端） |
| `CREEM_API_KEY` | Creem API key（`creem_test_` 前缀自动识别测试模式） |
| `CREEM_WEBHOOK_SECRET` | Creem webhook 签名密钥 |
| `NEXT_PUBLIC_APP_URL` | 应用 URL |
| `NEXT_PUBLIC_CREEM_STARTER_PRODUCT_ID` | Starter 产品 ID |
| `NEXT_PUBLIC_CREEM_PRO_PRODUCT_ID` | Pro 产品 ID |
| `NEXT_PUBLIC_CREEM_ENTERPRISE_PRODUCT_ID` | Enterprise 产品 ID |
| `ADMIN_EMAIL` | 管理员邮箱 |
| `RESEND_API_KEY` | Resend 邮件 key（可选） |
| `RESEND_FROM_EMAIL` | 发件地址 |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL（可选，无则不限流） |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |
| `NEXT_PUBLIC_SITE_URL` | SEO 站点 URL |
| `IMAGE_PROVIDER` | 图像供应商：fal / volcano / tencent / aliyun / mock |
| `FAL_KEY` | fal.ai key |
| `VOLCANO_API_KEY`, `VOLCANO_IMAGE_MODEL` | 火山引擎 key 与模型 |
| `TENCENT_HUNYUAN_KEY` | 腾讯混元 TokenHub key |
| `ALIYUN_API_KEY` / `DASHSCOPE_API_KEY`, `ALIYUN_IMAGE_MODEL`, `ALIYUN_BASE_URL` | 阿里云百炼 |
| `TEXT_PROVIDER` | 文本供应商：openai / openrouter / tencent / mock |
| `OPENAI_API_KEY` | OpenAI key |
| `OPENROUTER_API_KEY` | OpenRouter key |
| `TEXT_MODEL_FREE`, `TEXT_MODEL_PAID` | 免费/付费档拆句模型覆盖 |
| `IMAGE_MODEL_PREVIEW`, `IMAGE_MODEL_FINAL` | 预览/终图模型覆盖 |

---

## 11. 项目运行方式

### Demo 模式（零配置）

```bash
npm install
npm run dev
# 打开 http://localhost:3000
```

Supabase 凭证缺失时自动进入 Demo 模式，所有功能用内存数据，无需任何外部服务。

### 真实服务模式

```bash
cp .env.example .env.local
# 填入 Supabase / Creem / fal / OpenAI 等凭证
npm run dev
```

Supabase 迁移按顺序执行：
```
supabase/schema.sql
supabase/migrations/002_expand.sql
supabase/migrations/003_pictory.sql
supabase/migrations/004_storage.sql
supabase/migrations/005_thumbnail.sql
supabase/migrations/006_learning.sql
supabase/migrations/007_flywheel.sql
```

### 构建与部署

```bash
npm run build    # 生产构建
npm run start    # 启动生产服务
```

部署到 Vercel：把 `.env.local` 的所有变量配置到 Vercel 项目设置即可。

---

## 12. 测试体系

```bash
npm test              # 单元测试（130+）
npm run test:watch    # 监听模式
npm run test:coverage # 覆盖率报告
npm run e2e           # Playwright E2E
npm run check         # 全量检查：lint + typecheck + test
```

### 测试分布

| 目录 | 覆盖内容 |
|------|---------|
| `tests/lib/` | vista、elementConfig、imageGrid、modelRouter、credits、entitlements、providers、rate-limit、seo、email、middleware |
| `tests/api/` | checkout、credits、discounts、licenses、subscriptions、transactions、webhook |
| `tests/components/` | pricing-card、subscription-card、sign-out-button |
| `e2e/` | auth、checkout、dashboard、demo-mode、landing、pricing、webhook |

### 设计原则

- **纯函数优先**：业务逻辑从 route handler 中抽成纯函数，便于单测
- **API 路由薄**：只做认证校验、调用 SDK、写库、返回 JSON
- **失败不伪造**：缺密钥返回 503 明确报错，绝不返回假图/假数据
