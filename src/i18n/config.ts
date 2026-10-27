// i18n 配置：当前支持的语言与默认语言。
// 以后加语言只需在 locales 里加一项 + 在 messages/ 下加一个字典文件，无需改动其他代码。
export const locales = ["en", "zh"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** 存语言偏好的 cookie 名（LocaleSwitcher 写入，layout 读取） */
export const LOCALE_COOKIE = "locale";

/** 各语言在切换器里展示的名称 */
export const localeNames: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

/** 类型安全的语言判定 */
export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
