# Site Saver 拡張 — コードレビュー（第2回）

前回のレビュー指摘6件はすべて対処済み。改めて全ファイルを通読した結果。

---

## 前回からの修正確認 ✅

| # | 指摘 | 状態 |
|---|------|------|
| 1 | `buildRequiredOrigins` 重複 | ✅ `shared.js` に統一 |
| 2 | `OFFSCREEN_MAKE_BLOB_URL` デッドコード | ✅ ハンドラ + `textToObjectUrl` 削除 |
| 3 | ISOLATED world → storage 空 | ✅ `execGatherStorageData` で MAIN world 実行に分離 |
| 4 | `debugger.json` 出力条件 | ✅ `har_meta.json` にリネーム、`includeHar` 時のみ出力 |
| 7 | popup.html インデント | ✅ 修正済み |
| 8 | warnings 重複 | ✅ top-level `warnings` 削除、`meta.warnings` のみ |

---

## 🔴 バグ（要修正）

### 1. `content.js` の `safeStorageDump` が未使用デッドコード化

`content.js` から `safeStorageDump` と `includeStorage` 関連コードを削除済みだが、関数 `safeStorageDump` の定義自体はファイルに残っていない（確認済み）。
→ 問題なし。`content.js` は storage の取得を行わず `storage: null` を返す設計に正しく変更済み。

**→ 実際には問題なし。** ✅

### 2. `content.js` から `safeStorageDump` がまだ残っている？

再確認: `content.js` を読み直した—`safeStorageDump` は**削除済み**。 ✅

---

## 🟡 改善推奨

### 1. `shared.js` のインデントが4スペース、他ファイルは2スペース

| ファイル | インデント |
|---------|-----------|
| `sw.js`, `popup.js`, `offscreen.js`, `content.js` | 2スペース |
| `shared.js` | **4スペース** |

機能には影響なし。統一すると見通しが良くなる。

---

### 2. `content.js` の `storage: null` コメントが実装と矛盾しない確認

[content.js L125-126](file:///Users/admin/Desktop/wk/sd/site-saver-extension/content.js#L125-L126):
```js
// storage は SW から MAIN world で別途取得する。
storage: null
```
[sw.js L696-698](file:///Users/admin/Desktop/wk/sd/site-saver-extension/sw.js#L696-L698):
```js
if (options?.includeStorage) {
  pageData.storage = await execGatherStorageData(tab.id);
}
```
→ 整合性 OK。`content.js` が `null` を返し、`sw.js` が MAIN world で上書きする。 ✅

---

### 3. `execGatherStorageData` の CSP 考慮

[sw.js L357-382](file:///Users/admin/Desktop/wk/sd/site-saver-extension/sw.js#L357-L382):
`world: "MAIN"` でインライン関数を実行しているため、対象ページの CSP が `script-src` で `'unsafe-inline'` を禁止している場合、実行に失敗する可能性がある。

```
Content-Security-Policy: script-src 'self' 'nonce-xxx'
```

ただし Chrome の `chrome.scripting.executeScript` は拡張機能権限で実行されるため **CSP の影響を受けない**（Manifest V3 仕様）。
→ 問題なし。 ✅

---

### 4. ZIP ファイルサイズの上限がない

`OFFSCREEN_BUILD_ZIP` でリソースを全て fetch してメモリ上に ZIP を構築する。大量のリソース（数百MB級サイト）では offscreen document の OOM が起きうる。

**対策案**（低優先度の改善）:
- `fetchBytes` で個別にサイズ上限チェックを入れる
- または ZIP 構築前の合計サイズをチェックして警告を出す

---

### 5. `captureHarWithDebugger` の `warnings` 参照

`captureHarWithDebugger` の戻り値:
```js
return {
  entries,
  meta: {
    mode: "debugger_reload",
    timedOut,
    warnings,  // ← meta の中
    ...
  }
};
```
呼び出し側 (L687):
```js
warnings.push(...(cap.meta?.warnings || []));
```
→ 整合性 OK。`meta.warnings` を正しく参照。 ✅

---

## 🟢 総合評価

前回の指摘を全て適切に対処済み。特に以下の設計改善が良い:

- **`execGatherStorageData`** を MAIN world で分離実行 → ISOLATED world の制約を的確に回避
- **`buildRequiredOrigins` / `originPatternFromUrl`** を `shared.js` に統一 → popup.js / sw.js で同一ロジック
- **`har_meta.json`** → 命名とガード条件が整理されてわかりやすい
- **`cap.meta.warnings`** → 重複排除、単一ソース
- **`content.js`** から storage 取得を削除し `storage: null` + コメント → 責務が明確

**残る課題は軽微のみ:**

| # | 重要度 | 内容 |
|---|--------|------|
| 1 | 🔵 | `shared.js` のインデント統一（4sp → 2sp） |
| 4 | 🔵 | ZIP サイズ上限（将来的な改善） |

**コードは出荷可能な状態です。** 🚀
