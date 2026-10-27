const PLACEHOLDER_URLS = ["", "https://your-project.supabase.co", "your-supabase-url"];

/**
 * Demo 模式的开关判定。
 *
 * 旧实现只看 NEXT_PUBLIC_SUPABASE_URL 是不是占位符，是 **fail-open** 的：
 * 生产环境只要环境变量拼错一个字符、或平台没把变量注入到某个环境，
 * 站点就会「看起来一切正常」地跑在 demo 模式 —— 结账返回成功、订阅不落库、
 * 数据写进进程内存（多实例互不可见），而页面上没有任何提示。
 *
 * 现在支持显式开关，优先级：
 *   DEMO_MODE=false → 强制真实模式（即使 URL 仍是占位符，相关调用会显式报错而不是静默降级）
 *   DEMO_MODE=true  → 强制 demo（本地演示 / 录屏）
 *   未设置           → 沿用占位符推断，保留「clone 下来不配任何东西就能跑」的开发体验
 *
 * 生产部署请在 Vercel 环境变量里显式设置 DEMO_MODE=false。
 */
export function isDemoMode(): boolean {
  const forced = process.env.DEMO_MODE?.trim().toLowerCase();
  if (forced === "true") return true;
  if (forced === "false") return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return PLACEHOLDER_URLS.includes(url);
}
