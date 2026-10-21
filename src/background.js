import { loadSettings, isTranslatableUrl } from './shared.js';

const CONTENT_SCRIPT_FILE = 'src/content.js';
// こちらが遷移させたタブで起きる URL 変化（リダイレクト等）を、逆向きに伝播させない時間。
const NAV_ECHO_GUARD_MS = 3000;

// ---- ペア（原文タブ ⇄ 翻訳タブ）の管理 ----
// service worker は止まることがあるので storage.session にも保存する。

let pairs = {}; // { [sourceTabId]: translatedTabId }
const pairsReady = chrome.storage.session.get({ pairs: {} }).then((v) => {
  pairs = v.pairs;
});

async function savePairs() {
  await chrome.storage.session.set({ pairs });
}

async function findPair(tabId) {
  await pairsReady;
  for (const [source, translated] of Object.entries(pairs)) {
    if (Number(source) === tabId) return { source: tabId, translated, role: 'source', partner: translated };
    if (translated === tabId) return { source: Number(source), translated, role: 'translated', partner: Number(source) };
  }
  return null;
}

async function removePair(pair) {
  delete pairs[pair.source];
  await savePairs();
}

// ---- タブへの通知 ----

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // content script がまだ読み込まれていない。読み込まれたら hello で役割を取りに来る。
  }
}

// ツールバーのボタンに状態を出す。分割表示中は「●」を付け、ツールチップで状態と次の操作を説明する。
async function showStatus(tabId, status) {
  const title = {
    idle: 'actionTitle',
    active: 'actionTitleActive',
    paused: 'actionTitlePaused',
  }[status];
  await chrome.action.setBadgeBackgroundColor({ tabId, color: status === 'paused' ? '#6b7280' : '#2563eb' }).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: status === 'idle' ? '' : '●' }).catch(() => {});
  await chrome.action.setTitle({ tabId, title: chrome.i18n.getMessage(title) }).catch(() => {});
}

async function notifyRole(tabId, role) {
  const settings = await loadSettings();
  await sendToTab(tabId, { type: 'role', role, settings });
  await showStatus(tabId, role ? 'active' : 'idle');
}

async function notifyPair(pair) {
  await Promise.all([notifyRole(pair.source, 'source'), notifyRole(pair.translated, 'translated')]);
}

async function flashBadge(tabId, text) {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#b91c1c' });
  await chrome.action.setBadgeText({ tabId, text });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2000);
}

// ---- content script の注入 ----
// 全サイトに常駐させず、分割表示中のタブにだけ入れる。content.js 側で二重実行は防いでいる。

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT_FILE] });
    return true;
  } catch {
    // アクセス許可のないサイトや chrome:// などのページ。
    return false;
  }
}

// アクセス許可を求めるときの単位（https://example.com/*）。
function originPattern(url) {
  const { protocol, host } = new URL(url);
  return `${protocol}//${host}/*`;
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  await pairsReady;
  for (const [source, translated] of Object.entries(pairs)) {
    notifyPair({ source: Number(source), translated });
  }
});

// ---- ツールバーボタン：分割表示の開始 / 終了 ----

async function toggleSplit(tab) {
  // permissions.request はクリック直後に呼ぶ必要があるので、ほかの await より先に呼ぶ。
  // すでに許可済み（「すべてのサイトで許可」を含む）ならダイアログは出ない。
  const pairedNow = Object.entries(pairs).some(([s, t]) => Number(s) === tab.id || t === tab.id);
  const permission = !pairedNow && tab.url && isTranslatableUrl(tab.url)
    ? chrome.permissions.request({ origins: [originPattern(tab.url)] })
      // ユーザー操作として扱われなかった場合（ショートカット経由など）は、許可済みかだけ確認する。
      .catch(() => chrome.permissions.contains({ origins: [originPattern(tab.url)] }))
    : Promise.resolve(false);

  const existing = await findPair(tab.id);
  if (existing) {
    await removePair(existing);
    await notifyRole(existing.source, null);
    await chrome.tabs.remove(existing.translated).catch(() => {});
    return;
  }

  if (!(await permission)) {
    await flashBadge(tab.id, '×');
    return;
  }

  try {
    if (tab.splitViewId !== undefined && tab.splitViewId !== chrome.tabs.SPLIT_VIEW_ID_NONE) {
      await chrome.tabs.unsplit(tab.splitViewId);
    }
    await injectContentScript(tab.id);
    const created = await chrome.tabs.create({ url: tab.url, splitWithTabId: tab.id, windowId: tab.windowId });
    pairs[tab.id] = created.id;
    await savePairs();
    await notifyPair({ source: tab.id, translated: created.id });
  } catch (e) {
    console.error('[Split Translate] failed to open split view', e);
    await flashBadge(tab.id, '!');
  }
}

chrome.action.onClicked.addListener(toggleSplit);

// ---- タブの変化への追従 ----

const navGuardUntil = new Map(); // tabId → この時刻までは URL 変化を相手に伝えない

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const pair = await findPair(tabId);
  if (!pair) return;

  // ユーザーが分割表示を解除した。
  if (changeInfo.splitViewId === chrome.tabs.SPLIT_VIEW_ID_NONE) {
    await removePair(pair);
    await Promise.all([notifyRole(pair.source, null), notifyRole(pair.translated, null)]);
    return;
  }

  if (changeInfo.status === 'complete') {
    await injectContentScript(tabId);
    await notifyRole(tabId, pair.role);
  }

  if (changeInfo.url) {
    const guard = navGuardUntil.get(tabId);
    if (guard && Date.now() < guard) return;
    const settings = await loadSettings();
    if (!settings.syncNavigation || !isTranslatableUrl(changeInfo.url)) return;
    const partner = await chrome.tabs.get(pair.partner).catch(() => null);
    if (!partner || partner.url === changeInfo.url || partner.pendingUrl === changeInfo.url) return;
    navGuardUntil.set(pair.partner, Date.now() + NAV_ECHO_GUARD_MS);
    await chrome.tabs.update(pair.partner, { url: changeInfo.url });
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  navGuardUntil.delete(tabId);
  const pair = await findPair(tabId);
  if (!pair) return;
  await removePair(pair);
  if (pair.role === 'source') {
    // 原文タブを閉じたら翻訳タブも不要。
    await chrome.tabs.remove(pair.translated).catch(() => {});
  } else {
    await notifyRole(pair.source, null);
  }
});

// ---- content script とのメッセージ ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;

  if (message.type === 'hello') {
    (async () => {
      const pair = await findPair(tabId);
      sendResponse({ role: pair?.role ?? null, settings: await loadSettings() });
    })();
    return true;
  }

  // 翻訳タブで Chrome のページ翻訳が始まった / 終わった。
  if (message.type === 'chromeTranslate') {
    findPair(tabId).then((pair) => {
      if (pair) showStatus(tabId, message.active ? 'paused' : 'active');
    });
  }

  if (message.type === 'scroll') {
    findPair(tabId).then((pair) => {
      if (pair) sendToTab(pair.partner, { type: 'scroll', state: message.state });
    });
  }
  return false;
});
