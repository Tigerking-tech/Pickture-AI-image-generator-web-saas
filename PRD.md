# Surepix — 产品需求文档（PRD）

> **文档用途**：本项目（Surepix 电商产品图编辑 SaaS）的完整上下文档案。下次接手前先读本文档，可避免重新踩坑。
> **最后更新**：2026-10-25 · **当前状态**：v3 已发布（客户视角全流程走查 + 8 项修复完成）
> **发布链接**：https://af77d736458a2298c.app.workbuddy.host/?sharecode=VRUDWVQGAE

---

## 1. 产品一句话

**Surepix** = 面向欧美电商团队的确定性产品图编辑工具：把色彩/裁剪/缩放/水印编译成可复现的"配方"（~40ms/张），并在交付前对 LOGO、标签、价格签等品牌资产做**逐元素保真校验**——AI 生成工具"重画logo、扭曲文字"的品类通病，用测量而不是祈祷来解决。

**定位差异**：不跟 Photoroom/Pixelcut 拼 AI 生成能力，拼的是**可验证的确定性**（deterministic + verified）。Slogan: "Product photos that stay true — every pixel, verified."

## 2. 商业模型

| 计划 | 价格 | 配额 | 核心差异 |
|---|---|---|---|
| Free | $0/月 | 50 次编辑/月 | 含水印、保真校验、社区支持 |
| Pro | $12/月 | 5,000 次/月 | 去水印、批量、PSD 母版、品牌 manifest |
| Scale | $29/月 | 无限 | API + webhooks、自定义平台预设、SSO、审计日志 |

- 支付：**Creem**（Merchant of Record，处理 190+ 国家税务），非 Stripe
- 订阅/积分/许可证密钥三件套来自 SaaSKit 模板（见 §4）
- 14 天试用，不绑卡

## 3. 技术栈（锁定版本，勿随意升级）

| 层 | 选型 | 版本/说明 |
|---|---|---|
| 框架 | Next.js App Router | **16.1.6**（注意：16 的路由/重定向行为与 14 有差异，见 §9） |
| UI | React + Tailwind CSS 4 | React 19.2.3；Tailwind 4（CSS-first 配置，无 tailwind.config.js） |
| 字体 | Manrope + JetBrains Mono | `@fontsource/*` npm 本地化（**零外网字体请求**，规避沙箱/墙问题） |
| 支付 | @creem_io/nextjs + creem | Creem SDK；`creem_test_` 前缀自动进测试模式 |
| 数据库 | Supabase（Postgres + Auth） | `@supabase/ssr`；**demo 模式有完整内存 mock**（见 §6） |
| 邮件 | Resend | 可选，无 key 时静默跳过 |
| 限流 | Upstash Redis | 可选，无 key 时禁用 |
| 图像引擎 | PhotoCraft CLI（Rust） | v0.15.1，MIT OR Apache-2.0 双许可，二进制在 `vendor/photocraft/`（67MB） |
| 图像处理 | pngjs | ^7.0.0（需配 `@types/pngjs`，否则构建报无声明文件） |
| 测试/验证 | 自研 node 脚本 + Playwright | `verify.js`（29 项断言）+ `damage-test.js`（3 项反例） |

**项目位置**：`/workspace/surepix`（从 Pickture 更名而来； Pickture-web 的完整历史在 `/workspace/pickture-web`，算法资产从那里移植）。

## 4. 架构：三层拼装

```
┌─────────────────────────────────────────────────────┐
│  SaaSKit 底座（malakhov-dmitrii/nextjs-supabase-creem-boilerplate）│
│  · 认证（Supabase Auth + OAuth + demo mock）          │
│  · 订阅/积分/许可证/交易/管理后台（dashboard 5 页）      │
│  · Creem checkout / webhook / billing-portal API     │
├─────────────────────────────────────────────────────┤
│  PhotoCraft 保真算法层（从 pickture-web 移植）          │
│  src/lib/fidelity.ts   逐元素保真校验（SSIM/边缘召回/对比度）│
│  src/lib/pc.ts         PhotoCraft CLI 封装（白名单+超时） │
│  src/lib/pipeline.ts   编辑管线（warm_up 等配方执行）     │
│  src/lib/router.ts     意图路由（确定性 vs 生成式分流）    │
│  src/lib/whitelist.ts  23 条白名单命令（安全边界）        │
├─────────────────────────────────────────────────────┤
│  Surepix 品牌层（v2/v3 重设计）                        │
│  src/components/Landing.tsx   落地页（587 行）          │
│  src/components/DemoClient.tsx 交互 demo（335 行）      │
│  src/app/globals.css   设计系统 v2（1572 行）          │
│  src/components/{Reveal,MobileNav}.tsx                 │
└─────────────────────────────────────────────────────┘
```

**目录速查**：
- `src/app/(auth)/` — login / signup / callback（v3 已重设计为 Surepix 浅色品牌风）
- `src/app/dashboard/` — page / licenses / transactions / admin（v3 令牌换肤为浅色）
- `src/app/demo/` — 在线 demo 页（真实跑管线，非 mockup）
- `src/app/api/edit/` — **核心 API**：意图 → 路由 → whitelist → PhotoCraft CLI → fidelity 校验 → 三级裁决
- `src/app/api/{checkout,subscriptions,credits,licenses,transactions,discounts,billing-portal,webhooks/creem}/` — SaaSKit 计费 API
- `src/lib/demo/` — demo 模式（store.ts 种子数据 + supabase-mock.ts 内存 Supabase）
- `public/samples/{serum,phones,coffee}.png` + `.json` — 3 个样品图 + 6 元素 manifest（brand_logo/product_body/product_label/product_logo/text_small/price_tag）
- `public/showcase/*-after.png` — 3 张真实管线输出展示图（全部 verdict PASS）
- `verify.js` / `damage-test.js` — 根目录闭环验证脚本
- `scripts/make-samples.py` — PIL 重新生成样品图（品牌字样 SUREPIX）

## 5. 核心管线：一次编辑发生了什么

```
用户意图（自然语言）
  → router.ts       意图识别：确定性模板 or 语义级（拒绝/升级生成式）
  → whitelist.ts    白名单校验（23 条命令，越界即拒）
  → pc.ts           spawn PhotoCraft CLI（Rust 二进制，30s 超时，512KB 输出上限）
  → fidelity.ts     逐元素校验：MAE / MS-SSIM / edge recall(±2px) / contrast retention
  → 三级裁决        PASS 交付 / REPAIR 降参重试（免费）/ REGENERATE 升级生成式（仅结构损伤）
```

**已实测性能**（verify.js V8 基准）：平均 460ms/次端到端（含 CLI spawn + 校验）；确定性编辑本身 ~40ms。

**Demo 页可点的 6 个意图**：warm_up / brighten / boost_saturation / resize 800×800 / sharpen / watermark。语义级意图（如背景替换）会被明确拒绝并提示需生成式路径——**这是产品卖点，不是 bug**。

## 6. Demo 模式（零配置运行）

`isDemoMode()` 判定：`NEXT_PUBLIC_SUPABASE_URL` 为空或占位符时激活。此时：
- `supabase-mock.ts` 提供全内存 Supabase（auth/from/rpc/signInWithOAuth…）
- OAuth 点击直接跳 /dashboard（mock 返回 url，组件负责 `window.location.assign`）
- 登录接受任意邮箱+密码（mock 不校验）
- 种子数据：demo@surepix.test / Pro Plan 订阅 / 4,950 credits（5000 月配额 -30 -20）
- 结账走 `/api/checkout` demo 分支 → 重定向 `/dashboard?checkout=success`

**注意**：本地 `next start` 也跑 demo 模式（无 .env），与线上发布行为一致。

## 7. 设计系统 v2（对标竞品实测标准）

**字体**：Manrope（正文/标题，400/500/600/700/800）+ JetBrains Mono（数据/指标）。**禁用** Inter/Roboto/Arial/系统字体。
**色彩**（globals.css `:root`）：
- `--bg: #fafafa`（页面底，非纯白）/ `--surface: #ffffff` / `--ink: #111118` / `--ink-2: #55565f` / `--ink-3: #6e6f7b`（v3 加深过，原 #8a8b96 对比度不达 AA）
- `--brand: #4f46e5` 实色靛蓝（CTA/强调，无渐变文字）；hover `#4338ca`
- `--ok: #15803d` / `--warn: #b45309` / `--bad: #b91c1c`（均按白底调过对比度）
- `--dark: #101017`（guarantee 深色块）
**排版**：hero h1 `clamp(44px,5.4vw,72px)/800/-0.038em`；section h2 `clamp(32px,3.6vw,48px)/780/-0.032em`；section padding 112px。
**组件**：按钮 `.btn-brand`（实色、radius 8px、**无阴影**）；卡片 1px 边框 + 柔影（`--shadow`）；`.reveal` 滚动渐入（IntersectionObserver + prefers-reduced-motion 降级 + noscript 兜底）。
**对比度**：全部文本 ≥4.5:1（v3 实测 4.76–18.01）。

**竞品实测基准**（Playwright getComputedStyle，v2 设计依据）：
- Claid：H2 56px/700/-2px；CTA #7168FA 实色、59px 高、无阴影
- Pixelcut：H1 60px/600/-1.2px
- Photoroom：hero "Sell at first sight"、01/02/03 编号块、SOC 2 信任区（官网被墙，数据经 WebFetch 通道获取）

## 8. 发布与验证机制（重要，勿绕行）

**发布**：
```bash
node /root/.codebuddy/skills/sites/scripts/publish.js --dir /workspace/surepix --port 3100 --install-cmd ""
# 输出 {"shareLink":"https://af77d736458a2298c.app.workbuddy.host/?sharecode=VRUDWVQGAE","verified":true}
```
- 发布前必须先按 PID 杀旧服务：`ss -tlnp | grep :3100` 取 pid 再 kill（**直接 pkill -f "next start" 有自匹配陷阱**）
- 本地起服务：`PORT=3100 npx next start -p 3100`（PORT 环境变量注入）
- 链接是稳定的（同 sharecode），重新发布即更新内容

**验证闭环**（每次改动后必须全跑）：
```bash
node verify.js       # 29 项断言，须 34/34（含汇总行）
node damage-test.js  # 3 项反例：LOGO 模糊→REPAIR / 涂灰→REGENERATE / 全局暖调→PASS
```
verify.js 断言覆盖：SEO（title/description/canonical/OG/Twitter/JSON-LD×2）、唯一 H1、MIT 署名（PhotoCraft 许可义务！）、6 意图全跑、3 样本一致性、上传流、反例拒绝、性能基准。

**目检**：Playwright 脚本在 `/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d54-a7bbb1e6e000/`（shoot-*.js / walk-*.js），需 `NODE_PATH=/workspace/surepix/node_modules`。截图存档在 `/workspace/surepix-预览截图/`（v2-* 为设计升级版，v3-* 为走查修复版，walk-* 为走查过程稿）。

## 9. 踩过的坑（血泪史，直接查这条）

1. **Next 16 拒绝相对 URL 重定向**：`NextResponse.redirect("/dashboard")` 报 malformed，必须 `new URL(path, request.url)`
2. **pngjs 无类型声明**：`npm i -D @types/pngjs`
3. **端口 3100 被旧服务占用**：发布/重启前按 PID 杀，勿用 pkill -f
4. **字体加载导致布局抖动**：Playwright 常规 click 会因字体换装超时（force click 正常）——Manrope 经 fontsource 本地化已缓解
5. **样品图烙旧品牌**：PICKTURE→SUREPIX 后须重跑 make-samples.py 并同步 manifest hash
6. **路由/白名单文案中文化**：面向欧美市场，router.ts 16 处 + whitelist.ts 30 处 desc/reason 已英文化（verify.js 依赖 "generative path" 错误文案，勿改）
7. **Playwright `$$` 返回 ElementHandle 无 .locator()**：用 `page.locator().nth(i)`；`page.goto` 同文档 hash 导航返回 null
8. **CSS 编辑破坏结构**：v3 改 globals.css 时曾把 @media 块截断导致孤儿规则——改完后用括号平衡脚本校验（depth 必须为 0）
9. **演示/截图整页空白**：`.reveal` 未触发时 opacity:0，全页截图前必须先渐进滚动
10. **Photoroom 官网直连超时**：竞品数据用 WebFetch 通道获取
11. **github.com git 主机不可达**（本沙箱网络只放行 api.github.com）：`git push` 报 TLS/connect 错误，但 REST API 正常。降级方案：经 Git Data API 推送——逐文件 POST `/git/blobs`（base64）→ POST `/git/trees` → POST `/git/commits`（传 author/committer/date 可复现 SHA）→ PATCH `/git/refs/heads/main`（force:true）。脚本在 artifact 目录 push-via-api.js
12. **`.github/workflows/*` 推送返回 404**：GitHub 要求 PAT 带 `workflow` scope 才能建/改 workflow 文件，否则 tree API 和 contents API 都返回迷惑性 404（其他路径同批次却成功）。解法：换带 workflow scope 的 PAT，或接受暂缺该文件
13. **API 建 commit 的 SHA 复现规则**（字节级对齐本地 git 用）：① 时间戳**保留原始时区偏移**（发 `+08:00` 就存 `+0800`，不转 UTC；但 JSON 回显归一成 `Z`，别信回显）；② 消息**原样存储**（含尾部换行，不做 git cleanup）；③ `git log --format=%B` 会在消息后多输一个记录分隔 `\n`，发给 API 前要心里有数；④ 用 `git hash-object -t commit --stdin` 手工构造对象即可在本地精确复现远端 SHA
14. **`git reset --hard` 会吞掉未提交编辑**（本会话踩了两次）：对准历史提交前，先 commit 或 stash；用 `git read-tree`+`write-tree` 从提交取 tree 时同理——工作区未提交改动不进去

## 10. 当前状态与待办

### 已完成（v3，2026-10-25）
- [x] v2 视觉重设计（Manrope/JetBrains Mono、实色 CTA、72px hero、112px 留白、真实产品图 hero + showcase 三联、滚动渐入）
- [x] 客户视角全流程走查 + 8 项修复：OAuth 卡死、移动端汉堡菜单、定价页移动端溢出、登录/注册模板文案、仪表盘深色粗野主义换肤、计划价格对齐（$0/$12/$29）、demo 邮箱/积分数据、.env.example 修正
- [x] 闭环验证 34/34 + 3/3，控制台零错误，移动端 4 页零溢出
- [x] README.md 重写为入口文档（醒目指向本 PRD）
- [x] git 仓库初始化：`.gitignore` 扩充排除 vendor/(67M)/video-proofs/(24M)/docs/(旧模板)/damage_*.png，首次提交 60f6294（135 文件 1.3M，remote 指向 Pickture 仓库）
- [x] **推送到 GitHub 完成**（2026-10-25）：`Tigerking-tech/Pickture-AI-image-generator-web-saas` main = `f9d65f1f`（134 文件；`.github/workflows/ci.yml` 因 PAT 缺 `workflow` scope 被 GitHub API 拦截未推送）。旧 Pickture 历史存档于 `pickture-archive` 分支（41af11ad）可随时恢复。因 github.com 不可达，推送经 api.github.com REST API 完成，本地 main 与远端 SHA 逐字节一致（§9 坑 11–14）

### 待办（按优先级）
1. **仪表盘产品化重构**（用户已提兴趣）：目前是 SaaSKit 计费后台换肤。可把 "Credits" 改为 "Verified edits"、许可证页融入品牌 manifest 概念、加编辑历史/质量报告视图
2. **字体换装布局抖动**：可加 `<link rel="preload">` 或 @font-face size-adjust 兜底
3. **补推 `.github/workflows/ci.yml`**：需用户提供带 `workflow` scope 的 PAT（或 GitHub 网页手动上传该文件），之后经 Contents API 推送即可与本地对齐
4. **真实 Supabase + Creem 密钥接入**：目前全程 demo 模式；上线前需建 Supabase 项目（schema 来自 SaaSKit）、Creem 产品（prod_pro/prod_scale）、配置 webhook
5. **SEO 增强**：og-cover.svg 可升级为真实产品图封面；sitemap 已含 /demo
6. **竞品复测**：Photoroom/Claid/Pixelcut 改版时重新取计算样式，保持对标

## 11. 关键文件修改热力图（常动的）

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/app/globals.css` | 1572 | 设计系统 + SaaSKit 令牌（v3 已换肤为浅色） |
| `src/components/Landing.tsx` | 587 | 落地页全量内容 |
| `src/components/DemoClient.tsx` | 335 | demo 交互（样品/动作/上传/运行） |
| `src/lib/whitelist.ts` | 362 | 23 条白名单命令 + desc 英文化 |
| `src/lib/router.ts` | 172 | 意图路由（中英文 patterns） |
| `src/lib/fidelity.ts` | 486 | 保真算法（verify/verifyElement/edgeRecall/warpToTransform） |
| `src/lib/demo/store.ts` | 174 | demo 种子数据（订阅/积分/许可证/交易） |

---

*本文档随项目演进更新。改动设计系统或发布机制后，请同步 §5/§7/§8/§9。*
