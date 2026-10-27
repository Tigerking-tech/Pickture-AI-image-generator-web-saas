"use client";

// 语言切换器：写入 locale cookie 后刷新，根布局重新读取并切换 <html lang> 与字典。
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale, localeNames, locales } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/I18nProvider";

export function LocaleSwitcher() {
  const locale = useLocale();
  const { t } = useT();
  const router = useRouter();

  function switchTo(next: Locale) {
    // biome-ignore lint/suspicious/noDocumentCookie: 这里写的是非敏感的 UI 偏好 cookie（samesite=lax，不含凭据）
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="locale-switcher" role="group" aria-label={t("common.language")}>
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={l === locale}
          className={l === locale ? "locale-switcher__btn is-active" : "locale-switcher__btn"}
          onClick={() => switchTo(l)}
        >
          {localeNames[l]}
        </button>
      ))}
    </div>
  );
}
