/**
 * 上游（生图 / 拆句）报错的人话翻译
 *
 * 为什么需要：实测（2026-10-23 阿里真实报错）限流与额度耗尽会把
 *   {"code":"Throttling.RateQuota",...}
 *   {"code":"AllocationQuota.FreeTierOnly","message":"Free quota exhausted..."}
 * 这类英文技术串原样透给用户。客户既看不懂，也不知道下一步该做什么。
 * 这里统一翻译成可执行的提示，同时保留原始 detail 供排查。
 *
 * ⚠️ 文案里承诺的"不会扣费"必须与实际计费顺序一致 —— 见 generate/route.ts：
 *    先校验余额 → 再生图 → **成功才扣分**，任何失败路径都不会扣分。
 */
export function friendlyUpstreamMessage(
  status: number,
  detail: string | undefined,
  kind: "image" | "text" = "image",
): string {
  const d = detail ?? "";
  const what = kind === "image" ? "image generation" : "decomposition";

  if (status === 429 || /Throttling|RateQuota|rate limit/i.test(d)) {
    return `The ${what} service is busy right now and refused the request. Please wait about a minute and try again — nothing was charged.`;
  }

  if (
    status === 402 ||
    status === 403 ||
    /FreeTierOnly|AllocationQuota|quota|InsufficientBalance|arrearage|postpaid/i.test(d)
  ) {
    return `Your ${what} quota is used up, or billing is not enabled for this model. Please top up / enable postpaid billing, or switch to a model that still has quota (e.g. set ALIYUN_IMAGE_MODEL=wan2.7-image).`;
  }

  return `The ${what} service failed unexpectedly. Please try again — nothing was charged.`;
}
