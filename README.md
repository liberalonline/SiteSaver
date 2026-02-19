# サイトセーバー

今開いているタブのページを ZIP 1ファイルにまとめて Downloads に保存する Chrome 拡張（Manifest V3）。
ネットワーク記録やHAR、ストレージ情報なども保存可能な、主に解析用での目的を想定。

https://chromewebstore.google.com/detail/sitesaver/kpdnopeigbkmfmldnpcdipdfnchnkakm


## できること

ZIP 内のディレクトリ構成:

```
<host>_<YYYYMMDD_HHMMSS>.zip
  └─ <host>/<YYYYMMDD_HHMMSS>/
       ├─ html/
       │   ├─ index.html          … DOM の outerHTML（表示中の状態）
       │   └─ assets/             … JS / CSS / 画像などの実ファイル
       └─ data/
            ├─ meta.json           … URL・保存時刻・オプション
            ├─ network.json        … ネットワーク記録 (performance entries)
            ├─ har.json            … HAR 1.2
            ├─ har_meta.json       … HAR 生成メタ情報
            ├─ storage.json        … localStorage / sessionStorage
            ├─ cookies.json        … Cookie 一覧（要許可）
            └─ report.json         … リソースダウンロード結果レポート
```

各 data ファイルは UI のチェックボックスで ON/OFF できます。

## オプション

| チェックボックス | デフォルト | 説明 |
|---|---|---|
| ページの実ファイル(JS/CSS/画像)も保存 | ✅ | `assets/` にダウンロード |
| ネットワーク記録(performance)を保存 | ✅ | `network.json` |
| HARを保存 | ✅ | `har.json` + `har_meta.json` |
| debuggerで高精度キャプチャ(再読み込み) | ☐ | ページを再読み込みして debugger API でリクエスト/レスポンス本文を取得 |
| 同一オリジンのみ | ✅ | リソース取得・HAR body キャプチャを同一オリジンに限定 |
| CookieをJSONで保存(要許可) | ☐ | `cookies.json`（cookies 権限を別途許可） |
| local/sessionStorageをJSONで保存 | ✅ | `storage.json`（MAIN world で取得） |

## インストール

以下からchromeにインストールしてください。
https://chromewebstore.google.com/detail/sitesaver/kpdnopeigbkmfmldnpcdipdfnchnkakm

### ソースからインストール
1. Chrome で `chrome://extensions/` を開く
2. 右上の「デベロッパーモード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択
4. 保存したいページを開いて拡張機能アイコンをクリック →「このタブを保存」

## ファイル構成

```
repo root/
  ├─ manifest.json     … 拡張定義
  ├─ shared.js         … sw.js / popup.js / offscreen.js 共通ユーティリティ
  ├─ sw.js             … Service Worker（メインロジック）
  ├─ content.js        … ページ注入スクリプト（DOM/resources/network 収集）
  ├─ offscreen.js      … Offscreen Document（ZIP 構築 / リソース fetch）
  ├─ offscreen.html    … Offscreen Document の HTML
  ├─ popup.html        … ポップアップ UI
  └─ popup.js          … ポップアップのロジック
```

## 権限

| 権限 | 種別 | 用途 |
|---|---|---|
| `activeTab` | 必須 | 現在のタブにスクリプト注入 |
| `scripting` | 必須 | `chrome.scripting.executeScript` |
| `downloads` | 必須 | ZIP ファイルの保存 |
| `offscreen` | 必須 | Blob URL 生成・ZIP 構築 |
| `debugger` | 必須 | HAR 高精度キャプチャ |
| `cookies` | オプション | Cookie 取得（UI でオン時にリクエスト） |
| `http/https` | オプション（host） | リソース取得・Cookie 取得（UI でオン時にリクエスト） |

## 制約・注意

- `index.html` 内の URL を書き換えていないので、オフラインで完全再現できるとは限りません。
- 認証が絡むリソースは SameSite などの制約でダウンロードに失敗することがあります。`debugger` キャプチャでは HAR 側にレスポンス本文を残せる場合があります。
- IndexedDB / Cache Storage / Service Worker のキャッシュ等は未対応です。
- `cookies.json` はセッショントークンを含み得ます。取り扱い注意。
- ZIP はメモリ上で組み立てます。リソースが多い/巨大なページだと失敗する可能性があります。
- `debugger` キャプチャ ON 時はページを再読み込みするため、フォーム状態や一時 UI 状態が変わる可能性があります。
