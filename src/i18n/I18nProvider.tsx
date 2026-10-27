"use client";

// 客户端 i18n 上下文：由根布局把当前语言 + 字典注入，组件用 useT() 取文案。
import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "./config";
import { messages, type Messages } from "./messages";

type I18nContextValue = {
  locale: Locale;
  t: (key: keyof Messages) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  messages: dictOverride,
  children,
}: {
  locale: Locale;
  messages?: Messages;
  children: ReactNode;
}) {
  const dict = dictOverride ?? messages[locale];
  const t = (key: keyof Messages): string =>
    dict[key] ?? messages.en[key] ?? String(key);
  return (
    <I18nContext.Provider value={{ locale, t }}>{children}</I18nContext.Provider>
  );
}

/** 客户端组件取翻译函数与当前语言 */
export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT() must be used within <I18nProvider>");
  return ctx;
}

export function useLocale(): Locale {
  return useT().locale;
}
