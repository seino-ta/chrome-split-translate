# Chrome ウェブストアの入力内容

Developer Dashboard の各タブに入力する内容です。英語の掲載情報と日本語の掲載情報は、「ストアの掲載情報」タブの「編集中の言語」で切り替えて、それぞれ入力します。プライバシー・テスト手順のタブは言語ごとに分かれていないので、審査担当者が読む英語で入力します。

## ストアの掲載情報

### 説明（English - en）

```text
Split Translate opens the page you are viewing in Chrome's split view, with the original on the left and a translation on the right. Scroll either side and the other follows to the same paragraph. Open a link on either side and the other side opens the same page. You can keep using the site on either side while you compare.

HOW TO USE
1. Click the Split Translate button on the page you want to translate.
2. The same page opens on the right and is translated.
3. Click the button again to close the translated tab.

FEATURES
• Translates on your device with Chrome's built-in Translator API. Page content is never sent to an external server.
• Synced scrolling lines up the same paragraph on both sides, even when the translation is longer or shorter than the original.
• Synced navigation: when one side opens another page, the other side follows.
• Clicks and typing are not mirrored, so nothing is submitted twice.
• Input fields and code blocks are left untranslated.
• Works alongside Chrome's own page translation. If you turn on Chrome's translation, the extension pauses until you turn it off.
• About 20 languages. By default, English is translated into your browser's language.
• Site access is requested per site the first time you use it there. You can also allow all sites in the settings.

REQUIREMENTS
• Chrome 155 or later (desktop)
• The first time you use a language pair, Chrome downloads a translation model.

PRIVACY
The extension collects no data. The source code is available at https://github.com/seino-ta/chrome-split-translate
```

### 説明（日本語 - ja）

```text
Split Translate は、今見ているページを Chrome の分割表示で開き、左に原文、右に翻訳を並べる拡張機能です。どちらかをスクロールすると、もう片方も同じ段落まで移動します。どちらかでリンクを開くと、もう片方も同じページを開きます。見比べながら、どちらのタブでもそのままサイトを操作できます。

使い方
1. 翻訳したいページで Split Translate のボタンを押します。
2. 右側に同じページが開き、翻訳されます。
3. もう一度ボタンを押すと、翻訳タブが閉じます。

できること
• Chrome 内蔵の Translator API を使い、端末内で翻訳します。ページの内容は外部のサーバーに送信されません。
• 翻訳で文章の長さが変わっても、左右で同じ段落が同じ高さに来るようにスクロールを合わせます。
• 片方で別のページを開くと、もう片方も同じページを開きます。
• クリックや入力は同期しないので、二重に送信されることはありません。
• 入力欄とコードは翻訳しません。
• Chrome の翻訳機能と一緒に使えます。Chrome の翻訳をオンにしている間は、この拡張機能の翻訳は止まります。
• 約 20 の言語に対応しています。既定では、英語をブラウザの表示言語に翻訳します。
• サイトへのアクセスは、各サイトで初めて使うときに許可を求めます。設定で、すべてのサイトを許可することもできます。

必要なもの
• Chrome 155 以降（デスクトップ版）
• 言語の組み合わせごとに、初回だけ翻訳モデルのダウンロードが必要です。

プライバシー
この拡張機能はデータを一切収集しません。ソースコードは https://github.com/seino-ta/chrome-split-translate で公開しています。
```

### その他の項目（すべての言語で共通）

| 項目 | 入力内容 |
|---|---|
| カテゴリ | 仕事効率化 › ツール（Productivity › Tools）。なければ「ツール」 |
| ショップ アイコン | `icons/icon128.png` |
| スクリーンショット（en） | `store/screenshot-en-1-split-view.png`、`store/screenshot-en-2-settings.png` |
| スクリーンショット（ja） | `store/screenshot-ja-1-split-view.png`、`store/screenshot-ja-2-settings.png` |
| プロモーション用タイル（小） | `store/promo-small-440x280.png` |
| マーキー プロモーション用タイル | 空欄のまま（任意） |
| 公式 URL | 空欄のまま（Search Console で所有確認したサイトが必要なため） |
| ホームページ URL | `https://github.com/seino-ta/chrome-split-translate` |
| サポート URL | `https://github.com/seino-ta/chrome-split-translate/issues` |
| 成人向けコンテンツ | オフ |

## プライバシー

### 単一用途の説明

```text
Shows the page the user is viewing side by side with its translation in Chrome's split view, keeping scrolling and navigation in sync between the two tabs.
```

### 権限が必要な理由

**activeTab**

```text
When the user clicks the toolbar button, the extension reads the URL of the current tab so it can open the same page next to it in split view. It does not access tabs the user has not clicked the button on.
```

**scripting**

```text
Injects the extension's own content script, which is bundled in the package, into the two tabs of the split view only. The script translates the right-hand tab and keeps scrolling in sync. No code is fetched from a remote server.
```

**storage**

```text
Saves the user's settings (language pair and sync options) with chrome.storage.sync, and the IDs of the two tabs in the current split view with chrome.storage.session.
```

**ホスト権限**（`optional_host_permissions: <all_urls>`）

```text
The user can translate any page they choose, so the content script must be able to run on any site. Host access is optional: it is requested for one site at a time, at the moment the user first uses the extension on that site. Users can instead opt in to all sites on the settings page. The script runs only in the two tabs of a split view that the user started.
```

### リモートコード

「いいえ、リモートコードを使用していません」を選びます。

### データの使用

- 収集するデータの種類：**どれにもチェックを入れない**（ユーザーデータは収集しない）
- 3 つの宣誓（データを販売しない、目的外に使わない、信用評価に使わない）：**すべてにチェックを入れる**
- プライバシー ポリシーの URL：

```text
https://github.com/seino-ta/chrome-split-translate/blob/main/PRIVACY.md
```

## 販売地域

| 項目 | 選択 |
|---|---|
| 支払い | 無料 |
| 公開設定 | 一般公開（先に自分で試したい場合は「限定公開」） |
| 地域 | すべての地域 |

## テスト手順

審査担当者向けの説明です。ログイン情報は不要です。

```text
No account or sign-in is needed.

Requirements: Chrome 155 or later on desktop (the extension uses the Split View API and the built-in Translator API).

1. Open any English web page, for example https://developer.chrome.com/docs/extensions
2. Click the Split Translate toolbar button. Allow site access when Chrome asks.
3. The same page opens on the right in split view and is translated. The default target language is the browser's UI language, or Japanese if the UI is English. You can change it on the Options page.
4. If a "Start" button appears at the bottom right of the translated tab, click it. Chrome then downloads the on-device translation model, which is needed once per language pair.
5. Scroll either side: the other side scrolls to the same paragraph. Click a link on either side: the other side opens the same page.
6. Click the toolbar button again to close the translated tab.
```
