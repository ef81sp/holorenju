## プロジェクト概要
- 連珠学習用ゲーム
- 画面サイズは固定のため、レイアウトには相対値を使用。style.cssにsize変数あり。

## パッケージマネージャ

- pnpm

## Vue

- 最新の 3.x を使用。記法に注意。公式ドキュメント参照。
- script setup lang="ts" を使用。
- 単一責任の原則に従い、コンポーネントを細分化。

## Konva

- Vue Konva を使用。公式ドキュメント参照。

## 開発手順

- docs 配下の markdown に計画と TODO があり、それに従う
- pnpm check 必須
- 開発サーバーの起動(pnpm dev)はユーザーが行うので**不要**
- pnpm check-fix を使用

## 動作確認

- Playwright MCPが使える
- コンテキスト削減のため、ウィンドウサイズはh540\*w960に固定
