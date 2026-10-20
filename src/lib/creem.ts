import { Creem } from "creem";

/**
 * 判定 Creem 环境：test key → 沙箱，其余 → 生产。
 * 保留 0|1 语义（0=prod, 1=test），脚手架既有单测依赖此返回值。
 */
export function getServerIdx(apiKey: string): 0 | 1 {
  return apiKey.startsWith("creem_test_") ? 1 : 0;
}

/**
 * creem SDK >= 1.13 将 `serverIdx: 0 | 1` 改为 `server: "prod" | "test"`（见
 * creem/src/lib/config.ts 的 SDKOptions）。此处做语义映射，保持行为不变。
 */
export function getServer(apiKey: string): "prod" | "test" {
  return getServerIdx(apiKey) === 1 ? "test" : "prod";
}

const apiKey = process.env.CREEM_API_KEY ?? "";

export const creem = new Creem({
  apiKey: apiKey || "placeholder",
  server: getServer(apiKey),
});
