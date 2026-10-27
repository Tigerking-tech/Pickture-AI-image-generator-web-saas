// 服务端取当前语言：优先读 cookie，其次按 Accept-Language 推断，最后回退默认语言。
import { cookies } from "next/headers";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const cookie = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  return defaultLocale;
}

/** 从 Accept-Language 头推断语言（取第一个匹配的语言前缀） */
export function localeFromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  const preferred = header.split(",").map((part) => part.split(";")[0].trim().split("-")[0]);
  for (const p of preferred) {
    if (isLocale(p)) return p;
  }
  return defaultLocale;
}
