// 服务端取翻译：供 Server Component 使用（客户端请用 I18nProvider 的 useT）。
import { getLocale } from "./get-locale";
import { messages, type Messages } from "./messages";
import type { Locale } from "./config";

export async function getT(): Promise<{
  locale: Locale;
  t: (key: keyof Messages) => string;
}> {
  const locale = await getLocale();
  const dict = messages[locale];
  const t = (key: keyof Messages): string =>
    dict[key] ?? messages.en[key] ?? String(key);
  return { locale, t };
}
