import { computed } from "vue";
import {
  DEFAULT_LOCALE,
  LOCALES,
  resolveLocale,
  translate,
  preloadLocale,
} from "~/i18n";

const RTL_LOCALES = new Set(["ar", "fa", "he", "ur"]);

export const useI18n = () => {
  const locale = useCookie<string>("app_locale", {
    default: () => DEFAULT_LOCALE,
    watch: true,
    maxAge: 365 * 24 * 60 * 60, // 1 year
  });

  const setLocale = async (nextLocale: string) => {
    const resolved = resolveLocale(nextLocale) || DEFAULT_LOCALE;
    if (locale.value === resolved) return;

    // Preload the locale messages before switching
    await preloadLocale(resolved);

    locale.value = resolved;
    if (process.client) {
      document.documentElement.lang = resolved;
      document.documentElement.dir = RTL_LOCALES.has(resolved) ? "rtl" : "ltr";
      window.dispatchEvent(
        new CustomEvent("i18n:changed", { detail: { locale: resolved } }),
      );
    }
  };

  const t = (key: string, params?: Record<string, string | number>) =>
    translate(locale.value, key, params);

  const localeLabel = computed(() => {
    const current = LOCALES.find((item) => item.code === locale.value);
    return current ? current.label : locale.value;
  });

  return {
    locale,
    locales: LOCALES,
    setLocale,
    t,
    localeLabel,
  };
};
