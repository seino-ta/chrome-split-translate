# Privacy Policy

*Last updated: October 20, 2026*

[日本語版はこちら](#プライバシーポリシー)

Split Translate does not collect, transmit, sell, or share any personal data or browsing data.

## What the extension processes

- **Page text**: The text of the pages you choose to translate is translated on your device by Chrome's built-in Translator API. It is never sent to the developer or to any third-party server.
- **Settings**: Your language choices and sync preferences are stored with `chrome.storage.sync`. If Chrome Sync is turned on, Chrome syncs them across your signed-in browsers under Google's privacy policy. The developer has no access to them.
- **Tab state**: The IDs of the original and translated tabs are kept in `chrome.storage.session` while the split view is open and are cleared when the browser closes.

## Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab` | Read the URL of the current tab when you click the toolbar button, so the same page can open in the split view |
| `scripting` | Insert the translation and scroll-sync script into the two tabs of the split view only |
| `storage` | Save your settings and the current split view pair |
| Site access (optional) | Requested per site the first time you use the extension there, or for all sites if you turn on "Allow on all sites". You can revoke it at any time from `chrome://extensions` |

## Contact

If you have questions about this policy, please open an issue in the project's repository.

---

# プライバシーポリシー

*最終更新日: 2026年10月20日*

Split Translate は、個人データや閲覧データを収集・送信・販売・共有しません。

## 拡張機能が扱うもの

- **ページのテキスト**: 翻訳するページのテキストは、Chrome 内蔵の Translator API で端末内で翻訳します。開発者や第三者のサーバーには送信しません。
- **設定**: 言語と同期の設定は `chrome.storage.sync` に保存します。Chrome の同期がオンの場合、Google のプライバシーポリシーに従って、同じアカウントでログインしている Chrome 間で同期されます。開発者がこの設定を見ることはできません。
- **タブの状態**: 分割表示中の原文タブと翻訳タブの ID を `chrome.storage.session` に保存します。ブラウザを閉じると消えます。

## 権限

| 権限 | 用途 |
|---|---|
| `activeTab` | ツールバーのボタンを押したときに開いているタブの URL を読み取り、同じページを分割表示で開くため |
| `scripting` | 翻訳とスクロール同期のスクリプトを、分割表示中の 2 つのタブにだけ読み込ませるため |
| `storage` | 設定と、分割表示中のタブの組み合わせを保存するため |
| サイトへのアクセス（任意） | サイトごとに、初めて使うときに許可を求めます。設定で「すべてのサイトで許可する」をオンにした場合は、すべてのサイトが対象です。許可は `chrome://extensions` からいつでも取り消せます |

## お問い合わせ

このポリシーについての質問は、プロジェクトのリポジトリで Issue を作成してください。
