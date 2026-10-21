// background / options の両方から使う設定。

// Translator API が対応している主な言語（BCP 47）。
export const LANGUAGE_CODES = [
  'en', 'ja', 'zh', 'zh-Hant', 'ko', 'vi', 'th', 'id', 'hi', 'bn',
  'fr', 'de', 'es', 'pt', 'it', 'nl', 'pl', 'ru', 'tr', 'uk', 'ar',
];

// 翻訳先の既定はブラウザの表示言語。英語環境や未対応の言語なら日本語にする。
function defaultTargetLanguage() {
  const ui = chrome.i18n.getUILanguage();
  if (/^zh-(TW|HK|MO|Hant)/i.test(ui)) return 'zh-Hant';
  const base = ui.split('-')[0];
  return base !== 'en' && LANGUAGE_CODES.includes(base) ? base : 'ja';
}

export const DEFAULT_SETTINGS = {
  sourceLanguage: 'en',
  targetLanguage: defaultTargetLanguage(),
  syncScroll: true,
  syncNavigation: true,
};

// 言語名はブラウザの表示言語で出す（例: ja 環境なら「英語」、en 環境なら「English」）。
export function languageName(code) {
  try {
    return new Intl.DisplayNames([chrome.i18n.getUILanguage()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

// content script を入れられるページか（chrome:// や Chrome ウェブストアなどは不可）。
export function isTranslatableUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === 'https:' || protocol === 'http:') && hostname !== 'chromewebstore.google.com';
  } catch {
    return false;
  }
}

export async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}
