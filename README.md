# Surepix

**Product photos that stay true — every pixel, verified.**

面向欧美电商团队的确定性产品图编辑 SaaS：把色彩/裁剪/缩放/水印编译成可复现的"配方"（~40ms/张），交付前对 LOGO、标签、价格签等品牌资产做**逐元素保真校验**（PASS / REPAIR / REGENERATE 三级裁决）。与 Photoroom/Pixelcut 的差异不在 AI 生成能力，而在**可验证的确定性**。

> **📋 完整产品文档（PRD）：[PRD.md](./PRD.md) — 接手本项目前必读**
> 含商业模型、锁定版本、三层架构、核心管线、Demo 模式机制、设计系统令牌、发布命令、10 条踩坑记录与待办清单。

## 快速开始

无需任何账号——Supabase 凭据缺失时自动进入 **Demo 模式**（全内存 mock，所有功能可用）：

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。登录页 OAuth 按钮、注册、仪表盘、Demo 编辑器全部可用（预置 demo@surepix.test / Pro 计划 / 4,950 积分）。

## 核心命令

```bash
npm run build                  # 生产构建
npm run check                  # lint + typecheck + 单测全量
node verify.js                 # 全流程闭环验证（34/34 断言，需先启动服务）
node damage-test.js            # 反例测试（LOGO 模糊→REPAIR / 涂灰→REGENERATE / 暖调→PASS）
```

`verify.js` 与 `damage-test.js` 默认打 `http://127.0.0.1:3100`，可用 `BASE` 环境变量覆盖。完整发布流程（含 PID 清理与端口坑）见 [PRD.md §8](./PRD.md)。

## 结构速查

```
src/
├── app/            # 页面 + 15 个 API 路由（checkout/webhooks/credits/licenses…）
├── components/     # Landing / DemoClient / MobileNav / Reveal / pricing-plans / dialogs…
├── lib/
│   ├── fidelity.ts       # 逐元素保真校验（SSIM/MS-SSIM/edge recall）
│   ├── router.ts         # 编辑意图路由
│   ├── whitelist.ts      # 像素白名单（只允许配方内变换）
│   ├── pipeline.ts       # 意图 → 配方 → PhotoCraft CLI → 校验编排
│   └── demo/             # Demo 模式内存 store + Supabase mock
vendor/photocraft/        # PhotoCraft CLI（MIT）+ 保真算法层移植源
verify.js / damage-test.js # 闭环验证脚本
PRD.md                    # 完整产品文档
```

## 技术栈

Next 16.1.6 · React 19.2.3 · Tailwind 4（CSS-first）· Manrope + JetBrains Mono（@fontsource 本地化，零外网字体请求）· Creem（Merchant of Record 支付）· Supabase · pngjs ^7.0.0。版本已锁定，升级前读 [PRD.md §3](./PRD.md)。

## 署名

- **PhotoCraft** — 保真算法与 CLI 来自 pickture-web 项目，MIT / Apache-2.0 双许可，源码见 `vendor/photocraft/`
- **SaaSKit 底座** — 认证/订阅/积分/许可证/Creem 三层架构的底层，已通过令牌换肤转为 Surepix 浅色品牌（见 [PRD.md §4](./PRD.md)）

## License

MIT
