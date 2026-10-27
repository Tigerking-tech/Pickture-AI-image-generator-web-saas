// 消息聚合：按语言索引，供服务端/客户端统一取用。
import en, { type Messages } from "./en";
import zh from "./zh";
import type { Locale } from "../config";

export const messages: Record<Locale, Messages> = {
  en,
  zh,
};

export type { Messages };
