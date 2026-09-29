/**
 * Lightweight i18n — detects browser language, provides $t(key) function.
 * English is the fallback (keys are the English strings themselves).
 * Chinese translations in zh-CN.ts override matched keys.
 */
import zhCN from '@/locales/zh-CN';

// Follow the browser's *UI* language. In Firefox `navigator.language` tracks the
// "preferred language for displaying pages" setting (intl.accept_languages), which
// can disagree with the UI language the user actually changed - so read the
// extension i18n API first, and only fall back to navigator.language.
const g: any = globalThis;
const uiLanguage: string =
  (g.browser && g.browser.i18n && g.browser.i18n.getUILanguage && g.browser.i18n.getUILanguage()) ||
  (g.chrome && g.chrome.i18n && g.chrome.i18n.getUILanguage && g.chrome.i18n.getUILanguage()) ||
  (typeof navigator !== 'undefined' ? navigator.language : '');

const isZh = String(uiLanguage).toLowerCase().startsWith('zh');

// Lookups normalize the source string's whitespace (see t() below), so the
// dictionary must be normalized the same way. Without this, any entry whose key
// contains a double space (e.g. "selected.  (click") can never be matched.
const dict: Record<string, string> = {};
for (const key in zhCN) {
  dict[key.replace(/\s+/g, ' ')] = zhCN[key];
}

export function useI18n() {
  function t(key: string, ...args: any[]): string {
    // Normalize whitespace so extra spaces in source strings still match dict keys
    const normalized = key.replace(/\s+/g, ' ');
    if (isZh && dict[normalized] !== undefined) {
      let val = dict[normalized];
      for (let i = 0; i < args.length; i++) {
        val = val.replace('{' + i + '}', String(args[i]));
      }
      return val;
    }
    // Fallback: return key as-is (English)
    let val = key;
    for (let i = 0; i < args.length; i++) {
      val = val.replace('{' + i + '}', String(args[i]));
    }
    return val;
  }

  return { t, isZh };
}

export const i18n = useI18n();
