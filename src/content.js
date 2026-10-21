// 原文タブ・翻訳タブの両方で動く content script。
// - 翻訳タブ: ページ内のテキストノードを Translator API で置き換える（DOM 構造は変えない）
// - 両方: ユーザーのスクロールを相手タブへ送り、相手から来たスクロールを再現する
(() => {
  if (window.__splitTranslate) return;
  window.__splitTranslate = true;

  const UI_ATTR = 'data-split-translate-ui';
  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'textarea', 'select', 'option',
    'code', 'pre', 'kbd', 'samp', 'svg', 'math',
    '[contenteditable=""]', '[contenteditable="true"]', '[translate="no"]', '.notranslate', `[${UI_ATTR}]`,
  ].join(',');
  const TRANSLATED_ATTRS = ['placeholder', 'title'];

  // 言語ごとの文字。chars はその言語で使う文字、marker はその言語らしさを判定する文字。
  // 原文の言語の文字を含まないテキスト（Chrome の翻訳で日本語になった部分など）を翻訳しないために使う。
  const LATIN = /\p{Script=Latin}/gu;
  const SCRIPTS = {
    ja: { chars: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu, marker: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu },
    zh: { chars: /\p{Script=Han}/gu, marker: /\p{Script=Han}/gu },
    'zh-Hant': { chars: /\p{Script=Han}/gu, marker: /\p{Script=Han}/gu },
    ko: { chars: /\p{Script=Hangul}/gu, marker: /\p{Script=Hangul}/gu },
    th: { chars: /\p{Script=Thai}/gu, marker: /\p{Script=Thai}/gu },
    hi: { chars: /\p{Script=Devanagari}/gu, marker: /\p{Script=Devanagari}/gu },
    bn: { chars: /\p{Script=Bengali}/gu, marker: /\p{Script=Bengali}/gu },
    ar: { chars: /\p{Script=Arabic}/gu, marker: /\p{Script=Arabic}/gu },
    ru: { chars: /\p{Script=Cyrillic}/gu, marker: /\p{Script=Cyrillic}/gu },
    uk: { chars: /\p{Script=Cyrillic}/gu, marker: /\p{Script=Cyrillic}/gu },
  };
  const scriptOf = (lang) => SCRIPTS[lang] ?? { chars: LATIN, marker: LATIN };
  const count = (text, re) => text.match(re)?.length ?? 0;

  // 原文の言語で書かれていそうなテキストか。
  function isInSourceLanguage(text, { sourceLanguage, targetLanguage }) {
    const source = scriptOf(sourceLanguage);
    const target = scriptOf(targetLanguage);
    if (count(text, source.chars) === 0) return false;
    // 英語→フランス語のように同じ文字を使う組み合わせは、文字では見分けられない。
    if (source.marker.source === target.marker.source) return true;
    return count(text, target.marker) < count(text, source.marker);
  }

  // Chrome のページ翻訳は、訳文を <font style="vertical-align: inherit;"> で包んで挿入する。
  function isChromeTranslateWrapper(el) {
    return el.tagName === 'FONT' && el.style.verticalAlign === 'inherit';
  }

  function isChromeTranslateActive() {
    const { classList } = document.documentElement;
    return classList.contains('translated-ltr') || classList.contains('translated-rtl');
  }

  let role = null;
  let settings = null;
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String));

  // ================= 状態表示（翻訳タブ右下の小さなバナー） =================

  const banner = (() => {
    let host = null;
    let textEl = null;
    let buttonEl = null;
    let hideTimer = null;

    function ensure() {
      if (host) return;
      host = document.createElement('div');
      host.setAttribute(UI_ATTR, '');
      // body 直下に置くとスクロール同期用の要素パスがずれるので <html> 直下に置く。
      document.documentElement.appendChild(host);
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          .box { position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; display: flex; gap: 8px; align-items: center;
                 font: 12px/1.4 system-ui, sans-serif; color: #fff; background: rgba(17, 24, 39, .88);
                 padding: 6px 10px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
          button { font: inherit; color: #111827; background: #fff; border: 0; border-radius: 4px; padding: 3px 8px; cursor: pointer; }
          button[hidden] { display: none; }
        </style>
        <div class="box"><span></span><button hidden></button></div>`;
      textEl = root.querySelector('span');
      buttonEl = root.querySelector('button');
    }

    return {
      show(text, { button, onClick, autoHideMs } = {}) {
        ensure();
        clearTimeout(hideTimer);
        host.hidden = false;
        textEl.textContent = text;
        buttonEl.hidden = !button;
        buttonEl.textContent = button ?? '';
        buttonEl.onclick = onClick ?? null;
        if (autoHideMs) hideTimer = setTimeout(() => (host.hidden = true), autoHideMs);
      },
      hide() {
        if (host) host.hidden = true;
      },
    };
  })();

  // ================= 翻訳 =================

  const translation = (() => {
    let translator = null;
    let languageKey = null;
    let observer = null;
    let generation = 0; // 言語を切り替えたら古い処理を捨てるためのカウンタ
    const cache = new Map(); // 原文 → 訳文
    const textRecords = new Map(); // Text → { original, translated }
    const attrRecords = new Map(); // Element → { [attr]: { original, translated } }
    const queue = { visible: [], rest: [] };
    let languages = null;
    let pausedForChrome = false;
    let running = false;
    let done = 0;
    let initialPassDone = false;

    function isSkipped(el) {
      return !el || el.closest(SKIP_SELECTOR) !== null || el.isContentEditable;
    }

    function isVisible(el) {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.width > 0;
    }

    function needsText(node) {
      const value = node.nodeValue;
      if (!value || !isInSourceLanguage(value, languages)) return false;
      const record = textRecords.get(node);
      if (record && record.translated === value) return false; // 自分で書き換えたもの
      return !isSkipped(node.parentElement);
    }

    function needsAttr(el, attr) {
      const value = el.getAttribute(attr);
      if (!value || !isInSourceLanguage(value, languages)) return false;
      const record = attrRecords.get(el)?.[attr];
      if (record && record.translated === value) return false;
      return !isSkipped(el);
    }

    function enqueue(job) {
      const el = job.node.nodeType === Node.TEXT_NODE ? job.node.parentElement : job.node;
      (el && isVisible(el) ? queue.visible : queue.rest).push(job);
    }

    function scan(root) {
      if (pausedForChrome) return;
      if (root.nodeType === Node.TEXT_NODE) {
        if (needsText(root)) enqueue({ node: root });
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE || isSkipped(root)) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (needsText(n)) enqueue({ node: n });
      }
      const selector = TRANSLATED_ATTRS.map((a) => `[${a}]`).join(',');
      const elements = root.matches(selector) ? [root, ...root.querySelectorAll(selector)] : root.querySelectorAll(selector);
      for (const el of elements) {
        for (const attr of TRANSLATED_ATTRS) {
          if (el.hasAttribute(attr) && needsAttr(el, attr)) enqueue({ node: el, attr });
        }
      }
      kick();
    }

    async function translateText(text) {
      const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
      const [, lead, core, trail] = match;
      let translated = cache.get(core);
      if (translated === undefined) {
        translated = await translator.translate(core);
        cache.set(core, translated);
      }
      return lead + translated + trail;
    }

    async function runJob(job) {
      const { node, attr } = job;
      if (!node.isConnected || pausedForChrome) return;
      if (attr) {
        if (!needsAttr(node, attr)) return;
        const original = node.getAttribute(attr);
        const translated = await translateText(original);
        if (node.getAttribute(attr) !== original || pausedForChrome) return; // 翻訳中にページ側で変わった
        const records = attrRecords.get(node) ?? {};
        records[attr] = { original, translated };
        attrRecords.set(node, records);
        node.setAttribute(attr, translated);
      } else {
        if (!needsText(node)) return;
        const original = node.nodeValue;
        const translated = await translateText(original);
        if (node.nodeValue !== original || pausedForChrome) return;
        textRecords.set(node, { original, translated });
        node.nodeValue = translated;
      }
    }

    async function kick() {
      if (running || !translator) return;
      running = true;
      const myGeneration = generation;
      try {
        while (myGeneration === generation) {
          const job = queue.visible.shift() ?? queue.rest.shift();
          if (!job) break;
          try {
            await runJob(job);
          } catch (e) {
            console.debug('[Split Translate] translation failed', e);
          }
          done += 1;
          const remaining = queue.visible.length + queue.rest.length;
          if (remaining > 0 && done % 10 === 0) banner.show(t('bannerRemaining', remaining));
        }
      } finally {
        running = false;
      }
      if (myGeneration !== generation) {
        // 言語の切り替えで止めた。新しい言語の処理を始める。
        kick();
        return;
      }
      if (!initialPassDone) {
        initialPassDone = true;
        banner.show(t('bannerDone'), { autoHideMs: 1500 });
      }
      pruneRecords();
    }

    function pruneRecords() {
      for (const node of textRecords.keys()) if (!node.isConnected) textRecords.delete(node);
      for (const el of attrRecords.keys()) if (!el.isConnected) attrRecords.delete(el);
    }

    function restoreOriginals() {
      for (const [node, { original, translated }] of textRecords) {
        if (node.isConnected && node.nodeValue === translated) node.nodeValue = original;
      }
      for (const [el, records] of attrRecords) {
        for (const [attr, { original, translated }] of Object.entries(records)) {
          if (el.isConnected && el.getAttribute(attr) === translated) el.setAttribute(attr, original);
        }
      }
      textRecords.clear();
      attrRecords.clear();
    }

    // Chrome のページ翻訳（右クリック →「日本語に翻訳」など）が動いている間は、こちらの翻訳を止める。
    // 止めないと、Chrome が入れた訳文をこちらがもう一度翻訳し、それを Chrome がまた翻訳する、という繰り返しになる。
    function syncWithChromeTranslate() {
      const active = isChromeTranslateActive();
      if (active === pausedForChrome) return;
      pausedForChrome = active;
      chrome.runtime.sendMessage({ type: 'chromeTranslate', active }).catch(() => {});
      if (active) {
        queue.visible.length = 0;
        queue.rest.length = 0;
        banner.show(t('bannerPausedForChrome'), { autoHideMs: 4000 });
      } else if (translator) {
        scan(document.body);
      }
    }

    function observe() {
      if (observer) return;
      new MutationObserver(syncWithChromeTranslate).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      });
      syncWithChromeTranslate();
      observer = new MutationObserver((mutations) => {
        if (pausedForChrome) return;
        for (const m of mutations) {
          if (m.type === 'childList') {
            for (const n of m.addedNodes) scan(n);
          } else if (m.type === 'characterData') {
            scan(m.target);
          } else if (m.type === 'attributes' && needsAttr(m.target, m.attributeName)) {
            enqueue({ node: m.target, attr: m.attributeName });
          }
        }
        kick();
      });
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATED_ATTRS,
      });
    }

    async function createTranslator(options) {
      return Translator.create({
        ...options,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            banner.show(t('bannerDownloading', Math.round(e.loaded * 100)));
          });
        },
      });
    }

    async function start({ sourceLanguage, targetLanguage }) {
      const key = `${sourceLanguage}>${targetLanguage}`;
      if (key === languageKey) return;

      generation += 1;
      languageKey = key;
      languages = { sourceLanguage, targetLanguage };
      initialPassDone = false;
      queue.visible.length = 0;
      queue.rest.length = 0;
      cache.clear();
      restoreOriginals();
      translator?.destroy();
      translator = null;

      if (!('Translator' in self)) {
        banner.show(t('bannerNoTranslator'));
        return;
      }
      const options = { sourceLanguage, targetLanguage };
      const availability = await Translator.availability(options);
      if (availability === 'unavailable') {
        banner.show(t('bannerPairUnsupported', sourceLanguage, targetLanguage));
        return;
      }

      const myGeneration = generation;
      const begin = (created) => {
        if (myGeneration !== generation) return created.destroy();
        translator = created;
        banner.show(t('bannerTranslating'));
        observe();
        scan(document.body);
      };

      try {
        begin(await createTranslator(options));
      } catch {
        // モデルのダウンロードが必要な場合、create() にはこのページでのユーザー操作が要る。
        banner.show(t('bannerClickToStart'), {
          button: t('bannerStartButton'),
          onClick: async () => {
            try {
              begin(await createTranslator(options));
            } catch (e) {
              banner.show(t('bannerStartFailed', e.message));
            }
          },
        });
      }
    }

    return { start };
  })();

  // ================= スクロール同期 =================
  // 翻訳タブはテキストを置き換えただけで DOM 構造が同じなので、
  // 「画面の 25% の高さにある要素」とその要素内の位置を相手に送れば、ページの高さが違っても位置を合わせられる。

  const scrollSync = (() => {
    const PROBE = 0.25;
    const PROBE_OFFSETS = [0, 8, -8, 16, -16, 32, -32, 64, -64];
    const USER_INPUT_WINDOW_MS = 1000;
    const SEND_INTERVAL_MS = 40;
    let lastUserInput = 0;
    let pointerDown = false;
    let suppressUntil = 0;
    let pendingTarget = null;

    const markInput = () => (lastUserInput = performance.now());
    for (const type of ['wheel', 'touchmove', 'keydown']) {
      addEventListener(type, markInput, { capture: true, passive: true });
    }
    addEventListener('pointerdown', () => { pointerDown = true; markInput(); }, true);
    addEventListener('pointerup', () => { pointerDown = false; markInput(); }, true);

    function scrollerOf(target) {
      return target === document || target === document.documentElement || target === document.body
        ? document.scrollingElement
        : target;
    }

    function viewportOf(scroller) {
      if (scroller === document.scrollingElement) return { top: 0, left: 0, width: innerWidth, height: innerHeight };
      const r = scroller.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const left = Math.max(r.left, 0);
      return { top, left, width: Math.min(r.right, innerWidth) - left, height: Math.min(r.bottom, innerHeight) - top };
    }

    // body から各階層の「何番目の子要素か」とタグ名を並べたもの。拡張機能の UI 要素は数えない。
    // Chrome の翻訳が入れた <font> は、中身を親の子として数える（翻訳前と同じ並びにする）。
    function childrenOf(parent) {
      const result = [];
      for (const c of parent.children) {
        if (c.hasAttribute(UI_ATTR)) continue;
        if (isChromeTranslateWrapper(c)) result.push(...childrenOf(c));
        else result.push(c);
      }
      return result;
    }

    function parentOf(el) {
      let p = el.parentElement;
      while (p && isChromeTranslateWrapper(p)) p = p.parentElement;
      return p;
    }

    function pathOf(el) {
      if (el === document.scrollingElement) return 'root';
      while (el && isChromeTranslateWrapper(el)) el = el.parentElement;
      const path = [];
      for (let n = el; n !== document.body; n = parentOf(n)) {
        const parent = n && parentOf(n);
        if (!parent) return null;
        path.unshift([childrenOf(parent).indexOf(n), n.tagName]);
      }
      return path;
    }

    function resolve(path) {
      if (path === 'root') return document.scrollingElement;
      if (!Array.isArray(path)) return null;
      let n = document.body;
      for (const [index, tag] of path) {
        n = childrenOf(n)[index];
        if (!n || n.tagName !== tag) return null;
      }
      return n;
    }

    // fixed / sticky のヘッダーなどはスクロールしても動かないので基準にしない。
    function isPinned(el, scroller) {
      for (let n = el; n && n !== scroller; n = n.parentElement) {
        const { position } = getComputedStyle(n);
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    }

    function scrollFraction(scroller) {
      const max = scroller.scrollHeight - scroller.clientHeight;
      return max > 0 ? scroller.scrollTop / max : 0;
    }

    function capture(scroller) {
      const vp = viewportOf(scroller);
      const probeY = vp.top + vp.height * PROBE;
      const state = { scroller: pathOf(scroller), probe: PROBE, fraction: scrollFraction(scroller), anchor: null, offset: null };
      if (!state.scroller) return null;
      // 基準点が段落の間の余白などに当たったときは、少しずつ上下にずらして要素を探す。
      for (const dy of PROBE_OFFSETS) {
        for (const fx of [0.5, 0.3, 0.7]) {
          const anchor = document.elementsFromPoint(vp.left + vp.width * fx, probeY + dy).find(
            (el) => el !== scroller && el !== document.documentElement && el !== document.body &&
              scroller.contains(el) && !el.closest(`[${UI_ATTR}]`) && !isPinned(el, scroller),
          );
          if (!anchor) continue;
          const path = pathOf(anchor);
          if (!path) continue;
          const r = anchor.getBoundingClientRect();
          state.anchor = path;
          // 基準点が要素の中なら要素内の割合で、外（余白）なら要素の端からのピクセル数で位置を表す。
          if (probeY < r.top) state.offset = { edge: 'top', px: probeY - r.top };
          else if (probeY > r.bottom) state.offset = { edge: 'bottom', px: probeY - r.bottom };
          else state.offset = { edge: 'inside', ratio: r.height > 0 ? (probeY - r.top) / r.height : 0 };
          return state;
        }
      }
      return state;
    }

    function send() {
      const target = pendingTarget;
      pendingTarget = null;
      const scroller = scrollerOf(target);
      if (!scroller) return;
      const state = capture(scroller);
      if (state) chrome.runtime.sendMessage({ type: 'scroll', state }).catch(() => {});
    }

    document.addEventListener('scroll', (e) => {
      if (!role || !settings?.syncScroll) return;
      const now = performance.now();
      if (now < suppressUntil) return;
      if (!pointerDown && now - lastUserInput > USER_INPUT_WINDOW_MS) return; // 自分で動かしたスクロールだけ送る
      if (pendingTarget === null) setTimeout(send, SEND_INTERVAL_MS);
      pendingTarget = e.target;
    }, { capture: true, passive: true });

    function apply(state) {
      if (!settings?.syncScroll) return;
      const scroller = resolve(state.scroller);
      if (!scroller) return;
      // 相手から来たスクロールをこちらから送り返さない。
      lastUserInput = 0;
      suppressUntil = performance.now() + 200;
      const anchor = state.anchor && resolve(state.anchor);
      if (anchor && scroller.contains(anchor)) {
        const vp = viewportOf(scroller);
        const r = anchor.getBoundingClientRect();
        const { edge, px, ratio } = state.offset;
        const point = edge === 'top' ? r.top + px : edge === 'bottom' ? r.bottom + px : r.top + r.height * ratio;
        const delta = point - (vp.top + vp.height * state.probe);
        scroller.scrollBy({ top: delta, behavior: 'instant' });
      } else {
        const max = scroller.scrollHeight - scroller.clientHeight;
        scroller.scrollTo({ top: max * state.fraction, behavior: 'instant' });
      }
    }

    return { apply };
  })();

  // ================= background とのやりとり =================

  function applyRole(newRole, newSettings) {
    role = newRole;
    settings = newSettings;
    if (role === 'translated') translation.start(settings);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'role') applyRole(message.role, message.settings);
    else if (message.type === 'scroll' && role) scrollSync.apply(message.state);
  });

  chrome.runtime.sendMessage({ type: 'hello' })
    .then((res) => res && applyRole(res.role, res.settings))
    .catch(() => {});
})();
