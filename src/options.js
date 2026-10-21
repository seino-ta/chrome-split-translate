import { LANGUAGE_CODES, languageName, loadSettings } from './shared.js';

const ALL_SITES = { origins: ['<all_urls>'] };
const $ = (id) => document.getElementById(id);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

// data-i18n 属性のついた要素に、表示言語のメッセージを入れる。
function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = t('optionsTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

function fillLanguageSelect(select, value) {
  for (const code of LANGUAGE_CODES) {
    select.add(new Option(`${languageName(code)} (${code})`, code, false, code === value));
  }
}

function showStatus(el, text, ok) {
  el.textContent = text;
  el.className = ok ? 'ok' : 'ng';
}

async function init() {
  localize();
  const settings = await loadSettings();
  fillLanguageSelect($('sourceLanguage'), settings.sourceLanguage);
  fillLanguageSelect($('targetLanguage'), settings.targetLanguage);
  $('syncScroll').checked = settings.syncScroll;
  $('syncNavigation').checked = settings.syncNavigation;
  $('allSites').checked = await chrome.permissions.contains(ALL_SITES);
}

// 変更はその場で保存する。
async function saveSettings() {
  const sourceLanguage = $('sourceLanguage').value;
  const targetLanguage = $('targetLanguage').value;
  if (sourceLanguage === targetLanguage) {
    showStatus($('status'), t('statusSameLanguage'), false);
    return;
  }
  await chrome.storage.sync.set({
    sourceLanguage,
    targetLanguage,
    syncScroll: $('syncScroll').checked,
    syncNavigation: $('syncNavigation').checked,
  });
  showStatus($('status'), t('statusSaved'), true);
}

function toggleAllSites() {
  const checkbox = $('allSites');
  // permissions.request はユーザー操作の直後に呼ぶ必要があるため、await より前に呼ぶ。
  const change = checkbox.checked ? chrome.permissions.request(ALL_SITES) : chrome.permissions.remove(ALL_SITES);
  change.then(async () => {
    checkbox.checked = await chrome.permissions.contains(ALL_SITES);
    showStatus($('status'), t(checkbox.checked ? 'statusAllSitesOn' : 'statusAllSitesOff'), true);
  });
}

async function prepareModel() {
  const status = $('modelStatus');
  if (!('Translator' in self)) {
    showStatus(status, t('statusNoTranslator'), false);
    return;
  }
  const options = { sourceLanguage: $('sourceLanguage').value, targetLanguage: $('targetLanguage').value };
  try {
    const availability = await Translator.availability(options);
    if (availability === 'unavailable') {
      showStatus(status, t('statusPairUnsupported'), false);
      return;
    }
    showStatus(status, t('statusPreparing'), true);
    const translator = await Translator.create({
      ...options,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          showStatus(status, t('statusDownloading', Math.round(e.loaded * 100)), true);
        });
      },
    });
    const sample = await translator.translate(options.sourceLanguage === 'en' ? 'Hello' : 'OK');
    translator.destroy();
    showStatus(status, t('statusModelReady', sample), true);
  } catch (e) {
    showStatus(status, t('statusFailed', e.message), false);
  }
}

for (const id of ['sourceLanguage', 'targetLanguage', 'syncScroll', 'syncNavigation']) {
  $(id).addEventListener('change', saveSettings);
}
$('allSites').addEventListener('change', toggleAllSites);
$('prepareModel').addEventListener('click', prepareModel);
init();
