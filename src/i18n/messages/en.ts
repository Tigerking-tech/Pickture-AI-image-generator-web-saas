// 英文消息字典（作为 Messages 类型的来源，其他语言需对齐这里的 key）。
// 这是脚手架的种子集：先覆盖导航/常用 CTA，后续把组件里约 102 处硬编码字符串逐步迁过来即可。
const en = {
  "nav.features": "Features",
  "nav.whyVerified": "Why verified",
  "nav.pricing": "Pricing",
  "nav.faq": "FAQ",
  "nav.signIn": "Sign in",
  "nav.tryDemo": "Try the demo",
  "common.language": "Language",
  "common.getStarted": "Get started",
  "common.free": "Free",
  "common.remaining": "remaining",
  "common.trialsLeft": "free AI trials left",
};

export default en;

/** 消息键的联合类型，来自英文字典，保证多语言 key 不会写错 */
export type Messages = typeof en;
