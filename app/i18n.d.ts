export {};

declare global {
  interface Window {
    __i18n?: {
      locale: string;
      t: (key: string, params?: Record<string, string | number>) => string;
      setLocale: (locale: string) => Promise<void>;
      locales: Array<{ code: string; label: string }>;
    };
    __t?: (key: string, params?: Record<string, string | number>) => string;
  }
}
