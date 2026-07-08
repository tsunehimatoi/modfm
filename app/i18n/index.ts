import { reactive } from "vue";

// ── Static imports ────────────────────────────────────────────────────
import en from "./locales/en.json";
import manifest from "./manifest.json";

// ── Vite glob: lazy-load all locale JSON files ────────────────────────
const localeModules = import.meta.glob(["./locales/*.json", "!./locales/en.json"], {
  import: "default",
});

// ── Constants ─────────────────────────────────────────────────────────
export const DEFAULT_LOCALE = "en";

export const LOCALES: Array<{ code: string; label: string }> = manifest;

const LOCALE_ALIASES: Record<string, string> = {
  "en-us": "en",
  "en-gb": "en",
  "pt-br": "pt-BR",
  "pt-pt": "pt-PT",
  "zh-hans": "zh-CN",
  "zh-hant": "zh-TW",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
  "es-419": "es",
  "zh-yue": "yue",
  "zh-hk": "yue",
  "srd": "scn",
  "arz": "ar",
  "ary": "ar",
  "apc": "ar",
  "pes": "fa",
  "prs": "prs",
  "kur": "kmr",
  "ckb": "ckb",
  "uzb": "uz",
  "kaz": "kk",
  "kir": "ky",
  "tuk": "tk",
  "aze": "az",
  "tgk": "tg",
  "mon": "mn",
  "bak": "ba",
  "tat": "tt",
  "uig": "ug",
  "ben": "bn",
  "mar": "mr",
  "tel": "te",
  "tam": "ta",
  "guj": "gu",
  "kan": "kn",
  "pan": "pa",
  "mal": "ml",
  "nep": "ne",
  "sin": "si",
  "asm": "as",
  "san": "sa",
  "lao": "lo",
  "msa": "ms",
  "tgl": "tl",
  "fil": "tl",
  "jav": "jv",
  "sun": "su",
  "swa": "sw",
  "hau": "ha",
  "amh": "am",
  "ibo": "ig",
  "wol": "wo",
  "xho": "xh",
  "zul": "zu",
  "afr": "af",
  "orm": "om",
  "sot": "st",
  "tsn": "tn",
  "tso": "ts",
  "mlg": "mg",
  "lin": "ln",
  "hat": "ht",
  "que": "qu",
  "aym": "ay",
  "grn": "gn",
  "mao": "mi",
  "mri": "mi",
  "nob": "nb",
  "nno": "nb",
  "sqi": "sq",
  "alb": "sq",
  "arm": "hy",
  "hye": "hy",
  "geo": "ka",
  "kat": "ka",
  "ice": "is",
  "isl": "is",
  "mac": "mk",
  "mkd": "mk",
  "bur": "my",
  "mya": "my",
  "wel": "cy",
  "cym": "cy",
  "gle": "ga",
  "baq": "eu",
  "eus": "eu",
  "yid": "yi",
  "ltz": "lb",
  "oci": "oc",
  "arg": "an",
  "epo": "eo",
  "bre": "br",
  "glg": "gl",
  "bos": "bs",
  "hrv": "hr",
  "srp": "sr",
  "slv": "sl",
  "lav": "lv",
  "est": "et",
  "lit": "lt",
  "mlt": "mt",
  "bel": "be",
  "bul": "bg",
  "ces": "cs",
  "cze": "cs",
  "dan": "da",
  "deu": "de",
  "ger": "de",
  "ell": "el",
  "gre": "el",
  "fin": "fi",
  "fra": "fr",
  "fre": "fr",
  "hun": "hu",
  "ita": "it",
  "jpn": "ja",
  "kor": "ko",
  "nld": "nl",
  "dut": "nl",
  "pol": "pl",
  "por": "pt-PT",
  "ron": "ro",
  "rum": "ro",
  "rus": "ru",
  "spa": "es",
  "swe": "sv",
  "ukr": "uk",
  "vie": "vi",
};

const LOCALE_FALLBACKS: Record<string, string> = {
  "zh-TW": "zh-CN",
  "pt-BR": "pt-PT",
  "yue": "zh-CN",
};

// ── Reactive message cache ────────────────────────────────────────────
const messagesCache: Record<string, any> = { en };
const loadedLocales = new Set<string>(["en"]);

/** Vue-reactive MESSAGES object for InfoDrawer.vue compatibility */
export const MESSAGES = reactive(messagesCache);

// ── Helpers ───────────────────────────────────────────────────────────
const hasOwn = (obj: any, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

const getMessageValue = (source: any, path: string): any => {
  if (!source) return undefined;
  const parts = path.split(".");
  let current = source;
  for (const part of parts) {
    if (current == null) return undefined;
    if (!hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
};

const formatMessage = (message: any, params?: Record<string, any>): string => {
  if (message == null) return "";
  const text = String(message);
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (!hasOwn(params, key)) return match;
    const value = params[key];
    return value == null ? "" : String(value);
  });
};

// ── Lazy loading ──────────────────────────────────────────────────────

/**
 * Preload a locale's messages into the cache.
 * Call this before switching locales to ensure translate() returns
 * values for the new locale on first render.
 */
export async function preloadLocale(code: string): Promise<void> {
  if (loadedLocales.has(code)) return;

  const modulePath = `./locales/${code}.json`;
  const loader = localeModules[modulePath];

  if (!loader) {
    // Locale file doesn't exist — cache the English fallback
    loadedLocales.add(code);
    messagesCache[code] = en;
    return;
  }

  try {
    const messages = await loader();
    messagesCache[code] = messages;
    loadedLocales.add(code);
  } catch {
    loadedLocales.add(code);
    messagesCache[code] = en;
  }
}

// ── Locale resolution ─────────────────────────────────────────────────

export const resolveLocale = (input: any): string | null => {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (hasOwn(LOCALE_ALIASES, lower)) {
    return LOCALE_ALIASES[lower] ?? null;
  }
  const exact = LOCALES.find(
    (locale) => locale.code.toLowerCase() === lower,
  );
  if (exact) return exact.code;
  const base = lower.split(/[-_]/)[0];
  if (!base) return null;
  const baseMatch = LOCALES.find(
    (locale) => locale.code.toLowerCase() === base,
  );
  return baseMatch ? baseMatch.code : null;
};

// ── Translation ───────────────────────────────────────────────────────

export const translate = (
  locale: string | null | undefined,
  key: string,
  params?: Record<string, any>,
): string => {
  const tried = new Set<string>();

  const resolveFromLocale = (loc: string): any => {
    if (!loc || tried.has(loc)) return undefined;
    tried.add(loc);
    const message = getMessageValue(messagesCache[loc], key);
    if (message !== undefined) return message;
    if (hasOwn(LOCALE_FALLBACKS, loc)) {
      const fallback = LOCALE_FALLBACKS[loc];
      if (fallback) return resolveFromLocale(fallback);
    }
    return undefined;
  };

  let message = locale ? resolveFromLocale(locale) : undefined;
  if (message === undefined && locale !== DEFAULT_LOCALE) {
    message = resolveFromLocale(DEFAULT_LOCALE);
  }
  if (message === undefined) return formatMessage(key, params);
  return formatMessage(message, params);
};
