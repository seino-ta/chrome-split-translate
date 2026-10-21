// E2E: 拡張機能を Playwright 同梱の Chromium（Chrome for Testing）に読み込み、
// 分割表示・翻訳・Chrome のページ翻訳との共存・スクロール同期・遷移同期を確認する。
//
//   npm test                 # 表示言語は OS の設定に従う
//   LOCALE=en npm test       # 表示言語を指定（macOS では README の手順も必要）
//   HEADED=1 npm test        # ブラウザを表示して実行
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADLESS = !process.env.HEADED;
const LOCALE = process.env.LOCALE || null;
const MIN_CHROME_MAJOR = 155; // chrome.tabs.create({ splitWithTabId }) が使えるバージョン
const NAV_ECHO_GUARD_MS = 3000; // background.js と同じ値

// ---- テスト用に拡張機能をコピーしてパッチ ----
// - host_permissions: 許可ダイアログは自動操作できないので、最初から全サイトを許可しておく
// - Translator: ヘッドレスでは翻訳モデルを使えないので、決まった形の訳文を返す偽物に差し替える
// - toggleSplit: ツールバーのボタンは押せないので、service worker から直接呼べるようにする

const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'split-translate-e2e-'));
const EXT = path.join(WORK, 'ext');
const IGNORED = new Set(['.git', 'node_modules', 'test']);
fs.cpSync(ROOT, EXT, { recursive: true, filter: (src) => !IGNORED.has(path.relative(ROOT, src).split(path.sep)[0]) });

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['<all_urls>'];
fs.writeFileSync(path.join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2));

const FAKE_TRANSLATOR = `
globalThis.Translator = {
  async availability() { return 'available'; },
  async create() {
    return { async translate(t) { await new Promise((r) => setTimeout(r, 1)); return '[ja] ' + t + ' ' + t; }, destroy() {} };
  },
};
`;
const contentJs = path.join(EXT, 'src/content.js');
fs.writeFileSync(contentJs, FAKE_TRANSLATOR + fs.readFileSync(contentJs, 'utf8'));
fs.appendFileSync(path.join(EXT, 'src/background.js'), '\nself.__toggleSplit = toggleSplit;\n');

// ---- テスト用ページ（/issue1 と /issue2 が互いにリンクしている長い英語のページ） ----

function issuePage(title, next) {
  const paras = Array.from({ length: 80 }, (_, i) =>
    `<p id="p${i}">Paragraph ${i}: The quick brown fox jumps over the lazy dog. Please review the issue and update the status.</p>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;font:16px/1.5 sans-serif">
  <header style="position:sticky;top:0;background:#eee;height:40px">Header Menu</header>
  <h1>${title}</h1><a id="next" href="${next}">Go to next issue</a>
  <input placeholder="Search issues"><textarea>Do not translate this</textarea><code>const x = 1;</code>
  <div id="dyn"></div>
  ${paras}
</body></html>`;
}

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(req.url.startsWith('/issue2') ? issuePage('Issue Two', '/issue1') : issuePage('Issue One', '/issue2'));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://localhost:${server.address().port}`;

// ---- 小さなテストランナー ----

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function skip(name, reason) {
  console.log(`SKIP ${name} — ${reason}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(100);
  }
  return null;
}

// 拡張機能が実際に使うメッセージ（Chrome は表示言語のフォルダがなければ default_locale を使う）。
function loadMessages(uiLanguage) {
  const candidates = [uiLanguage.replace('-', '_'), uiLanguage.split('-')[0], manifest.default_locale];
  const locale = candidates.find((l) => fs.existsSync(path.join(ROOT, '_locales', l, 'messages.json')));
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
  return { locale, msg: (key) => raw[key].message };
}

// 画面の 25% の高さにある段落と、その段落に対する位置。
const probe = (page) => page.evaluate(() => {
  const y = innerHeight * 0.25;
  const p = [...document.querySelectorAll('p')].find((e) => e.getBoundingClientRect().bottom > y);
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { id: p.id, top: y - r.top, height: r.height, scrollY };
});

// 同じ段落の同じ位置に来ているか（段落の高さが違っても、段落内の割合で比べる）。
function aligned(a, b) {
  if (!a || !b || a.id !== b.id) return false;
  const inside = (s) => s.top >= 0 && s.top <= s.height;
  if (inside(a) && inside(b)) return Math.abs(a.top / a.height - b.top / b.height) * Math.max(a.height, b.height) <= 4;
  return Math.abs(a.top - b.top) <= 4;
}
const fmt = (s) => (s ? `${s.id}@${Math.round(s.top)}/${Math.round(s.height)}px (scrollY=${Math.round(s.scrollY)})` : 'null');

// ---- 実行 ----

const context = await chromium.launchPersistentContext(path.join(WORK, 'profile'), {
  channel: 'chromium', // 拡張機能はヘッドレスシェルでは動かないので、同梱の Chrome for Testing を使う
  headless: HEADLESS,
  viewport: { width: 1200, height: 700 },
  ...(LOCALE && { locale: LOCALE }),
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    ...(LOCALE ? [`--lang=${LOCALE}`] : []),
  ],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const version = await sw.evaluate(() => navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '');
  console.log(`Chromium ${version}`);
  if (Number(version.split('.')[0]) < MIN_CHROME_MAJOR) {
    throw new Error(`Chrome ${MIN_CHROME_MAJOR}+ is required for the Split View API (got ${version}). Update the playwright package.`);
  }

  context.on('page', (p) => {
    p.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  });
  sw.on('console', (m) => m.type() === 'error' && console.log('  [sw]', m.text().slice(0, 300)));

  const uiLanguage = await sw.evaluate(() => chrome.i18n.getUILanguage());
  const { locale, msg } = loadMessages(uiLanguage);
  console.log(`UI language: ${uiLanguage} (extension locale: ${locale})`);
  // ツールチップに含まれるはずの言葉（en / ja 以外のロケールでは文言そのものの一致だけを見る）。
  const keyword = { en: { active: 'syncing', paused: 'paused' }, ja: { active: '同期中', paused: '一時停止中' } }[locale]
    ?? { active: '', paused: '' };
  if (LOCALE && !uiLanguage.toLowerCase().startsWith(LOCALE.toLowerCase())) {
    const hint = process.platform === 'darwin'
      ? `On macOS run: defaults write com.google.chrome.for.testing AppleLanguages '(${LOCALE})'`
      : `Chrome ignored --lang=${LOCALE}.`;
    check(`browser UI language is ${LOCALE}`, false, `got ${uiLanguage}. ${hint}`);
  }

  // ---- 設定画面 ----
  const extId = new URL(sw.url()).host;
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${extId}/src/options.html`);
  await opt.waitForFunction(() => document.getElementById('sourceLanguage').options.length > 0);
  const h1 = await opt.textContent('h1');
  const allSitesLabel = await opt.textContent('label[for=allSites]');
  check('options: shown in the browser UI language', h1 === msg('optionsTitle') && allSitesLabel === msg('optionsAllSites'),
    `${h1} / ${allSitesLabel}`);
  if (LOCALE === 'ja' || LOCALE === 'en') {
    const expected = { ja: 'Split Translate 設定', en: 'Split Translate Settings' }[LOCALE];
    check(`options: title is the ${LOCALE} string`, h1 === expected, h1);
  } else {
    skip('options: title is the requested locale string', 'set LOCALE=en or LOCALE=ja to check');
  }
  const codes = await opt.evaluate(() => [...document.getElementById('sourceLanguage').options].map((o) => o.value));
  const base = uiLanguage.split('-')[0];
  const expectedTarget = base !== 'en' && codes.includes(base) ? base : 'ja';
  const [sourceLanguage, targetLanguage] = [await opt.inputValue('#sourceLanguage'), await opt.inputValue('#targetLanguage')];
  check(`options: defaults are en → ${expectedTarget}`, sourceLanguage === 'en' && targetLanguage === expectedTarget,
    `${sourceLanguage} → ${targetLanguage}`);
  check('options: "allow on all sites" is checked', await opt.isChecked('#allSites'));
  await opt.close();

  // ---- ボタンを押す前 ----
  const plain = await context.newPage();
  await plain.goto(`${BASE}/issue1`);
  await sleep(300);
  check('nothing is injected before the button is clicked',
    !(await plain.evaluate(() => !!document.querySelector('[data-split-translate-ui]') || document.querySelector('h1').textContent !== 'Issue One')));
  await plain.close();

  // ---- 分割表示の開始 ----
  const source = await context.newPage();
  await source.goto(`${BASE}/issue1`);
  await sleep(300);

  const before = context.pages().length;
  const pagePromise = context.waitForEvent('page');
  const tabsAfterToggle = await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: url + '*' });
    await self.__toggleSplit(tab);
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ id: t.id, url: t.url || t.pendingUrl, splitViewId: t.splitViewId, index: t.index }));
  }, `${BASE}/issue1`);
  const translated = await pagePromise;
  await translated.waitForLoadState('domcontentloaded');
  const split = tabsAfterToggle.filter((t) => t.url?.startsWith(`${BASE}/issue1`)).sort((a, b) => a.index - b.index);
  check('toggle opens a tab with the same URL', split.length === 2 && context.pages().length === before + 1, JSON.stringify(split));
  check('both tabs are in the same split view',
    split.length === 2 && split[0].splitViewId !== -1 && split[0].splitViewId === split[1].splitViewId);

  const pairIds = split.map((t) => t.id);
  const actionState = () => sw.evaluate(async (ids) => Promise.all(ids.map(async (tabId) => ({
    title: await chrome.action.getTitle({ tabId }),
    badge: await chrome.action.getBadgeText({ tabId }),
  }))), pairIds);
  const active = await waitFor(async () => {
    const s = await actionState();
    return s.every((t) => t.badge === '●' && t.title === msg('actionTitleActive')) ? s : null;
  }, 3000);
  check('both tabs show the ● badge', !!active, JSON.stringify(active ?? await actionState()));
  check('tooltip says "syncing" on both tabs', !!active && active.every((t) => t.title.includes(keyword.active)));

  // ---- 翻訳 ----
  const translatedH1 = await waitFor(async () => {
    const t = await translated.textContent('h1');
    return t.startsWith('[ja]') ? t : null;
  });
  check('translated tab is translated', !!translatedH1, translatedH1 ?? '');
  check('source tab is left untouched', (await source.textContent('h1')) === 'Issue One');
  await waitFor(async () => (await translated.textContent('#p79')).startsWith('[ja]'));
  check('placeholder is translated', (await translated.getAttribute('input', 'placeholder')).startsWith('[ja]'));
  check('textarea and code are not translated',
    (await translated.inputValue('textarea')) === 'Do not translate this' && (await translated.textContent('code')) === 'const x = 1;');

  // テスト用に足す要素はすべて #dyn の中に入れる（#dyn より後ろの段落の要素パスを左右で揃えたままにする）。
  await translated.evaluate(() => { document.getElementById('dyn').textContent = 'New comment was added'; });
  const dynTranslated = await waitFor(async () => {
    const t = await translated.textContent('#dyn');
    return t.startsWith('[ja]') ? t : null;
  });
  check('text added later is translated', !!dynTranslated, dynTranslated ?? '');

  await translated.evaluate(() => {
    document.getElementById('dyn').insertAdjacentHTML('beforeend', '<div id="jp">招待が無効になったユーザー</div>');
  });
  await sleep(800);
  check('text already in Japanese is not translated', (await translated.textContent('#jp')) === '招待が無効になったユーザー');

  // ---- Chrome のページ翻訳との共存 ----
  // Chrome のページ翻訳を再現する: <html> に translated-ltr を付け、訳文を <font> で包んで入れる。
  await translated.evaluate(() => {
    document.documentElement.classList.add('translated-ltr');
    for (const p of document.querySelectorAll('p')) {
      const text = p.textContent;
      p.textContent = '';
      p.insertAdjacentHTML('beforeend',
        `<font style="vertical-align: inherit;"><font style="vertical-align: inherit;">段落: ${text.length} 文字の訳文です</font></font>`);
    }
    document.getElementById('dyn').insertAdjacentHTML('beforeend', '<div id="en-while-chrome">Added while Chrome translates</div>');
  });
  await sleep(800);
  const whileChrome = await translated.evaluate(() => ({
    p0: document.getElementById('p0').textContent,
    added: document.getElementById('en-while-chrome').textContent,
  }));
  check('Chrome page translate: extension does not re-translate its output',
    whileChrome.p0.startsWith('段落:') && !whileChrome.p0.includes('[ja]'), whileChrome.p0);
  check('Chrome page translate: new English text is left alone', whileChrome.added === 'Added while Chrome translates', whileChrome.added);
  const paused = await waitFor(async () => {
    const s = await actionState();
    return s[0].title === msg('actionTitleActive') && s[1].title === msg('actionTitlePaused') ? s : null;
  }, 3000);
  check('Chrome page translate: translated tab tooltip says "paused"',
    !!paused && paused[1].title.includes(keyword.paused), JSON.stringify(paused ?? await actionState()));

  // ---- スクロール同期（<font> が入った状態で、原文 → 翻訳 / 翻訳 → 原文） ----
  await source.bringToFront();
  await source.mouse.move(300, 400);
  for (let i = 0; i < 6; i++) { await source.mouse.wheel(0, 300); await sleep(60); }
  await sleep(600);
  const s1 = await probe(source);
  const t1 = await probe(translated);
  check('scroll sync: source → translated', s1?.scrollY > 0 && aligned(s1, t1), `source=${fmt(s1)} translated=${fmt(t1)}`);

  await translated.bringToFront();
  await translated.mouse.move(300, 400);
  for (let i = 0; i < 4; i++) { await translated.mouse.wheel(0, -300); await sleep(60); }
  await sleep(600);
  const s2 = await probe(source);
  const t2 = await probe(translated);
  check('scroll sync: translated → source', t2 && t2.id !== t1?.id && s2?.scrollY !== s1?.scrollY && aligned(s2, t2),
    `source=${fmt(s2)} translated=${fmt(t2)}`);

  // ---- Chrome のページ翻訳を解除 ----
  await translated.evaluate(() => document.documentElement.classList.remove('translated-ltr'));
  const resumed = await waitFor(async () => (await translated.textContent('#en-while-chrome')).startsWith('[ja]'));
  check('turning Chrome page translate off resumes translation', !!resumed);
  const resumedState = await waitFor(async () => {
    const s = await actionState();
    return s.every((t) => t.title === msg('actionTitleActive')) ? s : null;
  }, 3000);
  check('turning Chrome page translate off restores the "syncing" tooltip', !!resumedState, JSON.stringify(resumedState ?? await actionState()));

  // ---- 遷移同期 ----
  await source.evaluate(() => scrollTo(0, 0));
  await source.click('#next');
  const navOk = await waitFor(async () => translated.url().endsWith('/issue2') && (await translated.textContent('h1')).startsWith('[ja]'));
  check('navigation sync: source → translated, and the new page is translated', !!navOk, translated.url());
  await sleep(NAV_ECHO_GUARD_MS + 500);
  check('navigation sync does not ping-pong', source.url().endsWith('/issue2') && translated.url().endsWith('/issue2'),
    `${source.url()} / ${translated.url()}`);

  await translated.evaluate(() => document.getElementById('next').click());
  const backOk = await waitFor(async () => source.url().endsWith('/issue1'));
  check('navigation sync: translated → source', !!backOk, source.url());

  // ---- 分割表示の終了 ----
  await sleep(NAV_ECHO_GUARD_MS + 500);
  const afterToggle = await sw.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: url + '*' });
    await self.__toggleSplit(tab);
    await new Promise((r) => setTimeout(r, 300));
    const { pairs } = await chrome.storage.session.get('pairs');
    return {
      tabs: (await chrome.tabs.query({})).length,
      pairs,
      title: await chrome.action.getTitle({ tabId: tab.id }),
      badge: await chrome.action.getBadgeText({ tabId: tab.id }),
    };
  }, `${BASE}/issue1`);
  check('toggling again closes the translated tab and clears the pair',
    Object.keys(afterToggle.pairs).length === 0 && context.pages().length === before, JSON.stringify(afterToggle));
  check('toggling again resets the badge and tooltip', afterToggle.title === msg('actionTitle') && afterToggle.badge === '',
    `${afterToggle.title} / "${afterToggle.badge}"`);
} catch (e) {
  console.error(e);
  check('runs to completion without exceptions', false, e.message);
} finally {
  await context.close();
  server.close();
  fs.rmSync(WORK, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
