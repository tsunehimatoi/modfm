import { watch } from "vue";
import { DEFAULT_LOCALE, resolveLocale, preloadLocale } from "~/i18n";

export default defineNuxtPlugin(async (nuxtApp) => {
  const { locale, locales, setLocale, t } = useI18n();

  // SSR initialization
  if (import.meta.server) {
    if (!locale.value) {
      locale.value = DEFAULT_LOCALE;
    }
    await preloadLocale(locale.value);
  }

  // Client-side initialization & logic
  if (import.meta.client) {
    // If no cookie is set, try browser locale
    const cookieValue = useCookie("app_locale").value;
    if (!cookieValue) {
      const browserLocale = navigator.language || "";
      const initial = resolveLocale(browserLocale) || DEFAULT_LOCALE;
      await setLocale(initial);
    } else {
      // Ensure the locale messages are loaded
      await preloadLocale(locale.value);
      document.documentElement.lang = locale.value;
    }

    const i18nApi = {
      get locale() {
        return locale.value;
      },
      set locale(nextLocale: string) {
        setLocale(nextLocale);
      },
      t,
      setLocale,
      locales,
    };

    window.__i18n = i18nApi;
    window.__t = t;

    watch(
      locale,
      (value) => {
        document.documentElement.lang = value;
        if (import.meta.client) {
          window.dispatchEvent(
            new CustomEvent("app:locale-changed", { detail: { locale: value } }),
          );
        }
      },
      { immediate: false },
    );
  }
});
