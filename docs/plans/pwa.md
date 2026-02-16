# PWA対応プラン

## Context

ホロ連珠はオフラインでも遊べる学習ゲームとして最適なPWA候補。ネットワーク依存は Google Fonts のみで、他は全てローカルアセット。CPU対戦もWeb Worker内で完結。PWA化により「ホーム画面に追加」「オフラインプレイ」「高速再読み込み」が可能になる。

## スコープ

- メインアプリ（`index.html`）のみ。エディタ（`editor.html`）は除外
- アイコン: 512x512は既存。192x192を512から生成。後日ユーザーが差し替え
- BGM(2MB): ランタイムキャッシュ（初回再生時にキャッシュ）
- SE(79KB): プリキャッシュに含める（オフラインでも石を置く音等が鳴るように）

## Phase 1: vite-plugin-pwa 導入 + 最小構成でビルド検証

### 1-1. インストール

```bash
pnpm add -D vite-plugin-pwa
```

### 1-2. 最小構成で rolldown-vite 互換性を確認

まず manifest のみの最小構成で `pnpm build` が通ることを確認する（TDD的アプローチ）。成功を確認してから Workbox 設定を追加。

### 1-3. `vite.config.ts` に VitePWA プラグイン追加

- `injectRegister: null` — エディタへの自動注入を防ぐ
- `registerType: "prompt"` — ゲーム中のリロードを防ぐため、更新はユーザーに確認してから適用

**manifest設定:**

- `name`: "ホロ連珠 - フブみこさんと学ぶ五目並べ"
- `short_name`: "ホロ連珠"
- `theme_color` / `background_color`: `#5fdeec`（ホロシアン）
- `display`: `standalone`, `orientation`: `landscape`
- icons: 192x192, 512x512（+ maskable）

**Workbox precache:**

- `globPatterns`: `["**/*.{js,css,html,png,svg,opus}"]`
- `globIgnores`: `["editor.html", "**/editor-*"]` でエディタ除外
- `maximumFileSizeToCacheInBytes`: 300_000 — BGM(2MB)をプリキャッシュから除外し、SE(各5-47KB)のみ含める
- `navigateFallback`: `"index.html"`
- `navigateFallbackDenylist`: `[/^\/editor\.html/]`

**Workbox runtimeCaching:**

| リソース           | urlPattern                                 | ストラテジー               | キャッシュ名               | 理由                                                                        |
| ------------------ | ------------------------------------------ | -------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| Google Fonts CSS   | `/^https:\/\/fonts\.googleapis\.com\/.*/i` | StaleWhileRevalidate       | `google-fonts-stylesheets` | CSS更新を取り込みつつキャッシュ提供                                         |
| Google Fonts files | `/^https:\/\/fonts\.gstatic\.com\/.*/i`    | CacheFirst                 | `google-fonts-webfonts`    | フォントファイルは不変                                                      |
| シナリオindex      | `/\/scenarios\/index\.json$/`              | StaleWhileRevalidate       | `scenario-index`           | シナリオ追加時に更新される                                                  |
| 個別シナリオ       | `/\/scenarios\/.*\.json$/`                 | CacheFirst                 | `scenario-data`            | ファイル名にID含み不変                                                      |
| BGM (opus, >300KB) | `/\.opus$/i`                               | CacheFirst + rangeRequests | `audio-cache`              | 初回再生時キャッシュ。`cacheableResponse: { statuses: [0, 200] }` で206除外 |

### 1-4. `tsconfig.app.json` の types に `"vite-plugin-pwa/client"` 追加

## Phase 2: アセットとHTMLの更新

### 2-1. 192x192 アイコン生成

```bash
sips -z 192 192 public/holorenju-logo-512.png --out public/holorenju-logo-192.png
```

### 2-2. `index.html` 更新

- `<meta name="theme-color" content="#5fdeec" />` 追加
- `<link rel="apple-touch-icon" href="/holorenju-logo-192.png">` に更新（192x192に統一）

### 2-3. `src/main.ts` に SW 手動登録

`injectRegister: null` を使うため、`main.ts` で明示的に登録する。`registerType: "prompt"` なので `onNeedRefresh` コールバックで更新確認UIを表示:

```typescript
import { registerSW } from "virtual:pwa-register";

const updateSW = registerSW({
  onNeedRefresh() {
    if (window.confirm("新しいバージョンがあります。更新しますか？")) {
      updateSW(true);
    }
  },
});
```

`window.confirm` は最小限の実装。将来的にアプリ内UIに置き換え可能。
`editor-main.ts` には一切 PWA コードが入らない。

## Phase 3: ビルド検証とテスト

### 3-1. ビルド確認

```bash
pnpm build
```

確認項目:

- `dist/sw.js` が生成されている
- `dist/manifest.webmanifest` が生成されている
- `dist/index.html` に `<link rel="manifest">` がある
- `dist/editor.html` に manifest リンクや SW 登録コードが **ない**
- SE の opus ファイルがプリキャッシュに含まれ、BGM は含まれていない

### 3-2. Playwright E2Eテスト

- `pnpm preview` でプレビューサーバー起動
- Playwright MCP でアプリの動作確認
- オフラインモードでアプリが動作すること
- `/editor.html` が通常通り動作すること

### 3-3. `pnpm check-fix` 通過確認

## 修正ファイル一覧

| ファイル                        | 変更内容                                                |
| ------------------------------- | ------------------------------------------------------- |
| `package.json`                  | `vite-plugin-pwa` devDependency 追加                    |
| `vite.config.ts`                | VitePWA プラグイン追加（manifest + workbox設定）        |
| `tsconfig.app.json`             | types に `"vite-plugin-pwa/client"` 追加                |
| `index.html`                    | `<meta name="theme-color">` 追加、apple-touch-icon 更新 |
| `src/main.ts`                   | SW 登録コード + 更新確認ダイアログ追加                  |
| `public/holorenju-logo-192.png` | 新規: 192x192 アイコン（512から生成）                   |

## 注意点

- **rolldown-vite互換性**: Phase 1-2 で最小構成ビルドを先に確認。問題が出たらバージョン調整
- **音声の Range Requests**: OPUS再生はHTTP Rangeリクエストを使う可能性あり。`rangeRequests` + `cacheableResponse({ statuses: [0, 200] })` で206部分レスポンスのキャッシュを防止
- **プリキャッシュ合計**: 約1.5MB（HTML + JS + CSS + 画像 + SVG + SE）。BGM(2MB)は除外
- **オフライン体験の制約**: 未プレイのシナリオはオフラインで開けない（ランタイムキャッシュのため）。将来的にオフライン検出バナーを追加するとよい（今回のスコープ外）
