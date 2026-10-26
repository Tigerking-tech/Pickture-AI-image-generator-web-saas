# 方案 A 部署指南：Vercel 前端 + Render 引擎

> 目标：网站（Next.js 前端 + 业务逻辑）跑在 **Vercel**，图像处理引擎（photocraft-cli）常驻在 **Render**。
> 这样 Vercel 的 serverless 也能用（它无法本地跑二进制），全球用户首屏更快，重活在常驻主机上并发处理。

## 架构

```
浏览器 → Vercel (Next.js 前端 + /api/edit 业务逻辑)
               │  PC_API 设了就走 HTTP
               ▼
        Render (engine/server.mjs)  →  本地 photocraft-cli  (serve 模式调用)
```

代码层面：`src/lib/pc.ts` 在检测到 `PC_API` 环境变量时，会把 `runChain / convertFile / docInfo` 改走
`src/lib/pc-http.ts`（HTTP 客户端），不再本地 spawn 二进制。`pipeline.ts` / `/api/edit` 等上层**完全不用改**。

## 一、部署引擎到 Render

1. 在 Render 新建 **Web Service**，关联本仓库。
2. 关键设置：
   - **Root Directory**: `engine`
   - **Build Command**: `npm install`（会自动下载 photocraft-cli 到 `vendor/`）
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/pc/healthz`
   - **Plan**: 至少 `starter`（常驻，不休眠）。free 档会休眠导致首次请求很慢。
3. 设置环境变量：
   - `PC_TOKEN` = 一段随机密钥（如 `openssl rand -hex 32`）
   - `PC_VERSION` = `0.15.1`
   - `NODE_ENV` = `production`
   - `PORT` 由 Render 自动注入，不要手填。
4. 部署后记录服务地址，例如 `https://surepix-engine.onrender.com`。
5. 验证：`curl https://<你的地址>/api/pc/healthz` 应返回 `{"ok":true,...}`。

> 不想手动配？根目录已提供 `render.yaml`，可在 Render 用 "Blueprint" 方式一键导入。

## 二、部署前端到 Vercel

1. 在 Vercel 导入本仓库（正常部署 Next.js）。
2. 设置环境变量（在你原有的 Supabase / Creem 等变量之外，新增）：
   - `PC_API` = `https://surepix-engine.onrender.com`（上面 Render 的地址）
   - `PC_API_TOKEN` = **与 Render 的 `PC_TOKEN` 完全相同**的密钥
3. 部署即可。此后所有图像处理请求都会经 HTTP 转发到 Render 引擎。

## 三、本地开发

- 不设置 `PC_API` 时，`pc.ts` 走本地二进制（和你之前一样），无需引擎服务。
- 想本地联调引擎服务：在 `engine/` 目录 `PC_TOKEN=test PORT=3939 npm start`，然后在本仓库根设
  `PC_API=http://localhost:3939 PC_API_TOKEN=test`，即可让前端走本地引擎服务。

## 四、升级 PhotoCraft（"自动盯梢"）

两种用法：

- **手动**：`npm run watch` 查看上游是否有新版本及升级建议。
- **自动**：`.github/workflows/watch-photocraft.yml` 每天检查一次，有新版本就在本仓库开 Issue 通知你。
  收到通知后，告诉 AI 助手「评估官方 vX.Y.Z 是否升级」，它会：读发布说明 → 改 `PC_VERSION` 与
  `vendor-checksums/` 校验和 → 跑校验 → 重新部署 Render 与 Vercel。

## 五、生产注意

- **大文件**：生产环境建议让前端把图传到对象存储（如 R2/S3）拿到 URL，再传给引擎，并传 `resultPutUrl`
  （预签名 URL）让引擎直接 PUT 结果，避免在 JSON 里以 base64 来回传大图。
- **鉴权**：引擎仅用 `Bearer <PC_TOKEN>` 一层简单鉴权，务必用强随机密钥，且不要提交到代码库。
- **并发**：当前每个请求 spawn 一个 photocraft-cli 子进程，由 Node 并发调度；更高吞吐可提升 Render 套餐或开多实例。
- **冷启动**：Render free 档会休眠，首次请求需等待唤醒（几十秒），生产请用常驻套餐或定时 ping 保活。
