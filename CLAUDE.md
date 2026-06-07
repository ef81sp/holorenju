# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリのコードを扱う際のガイダンスを提供します。

## プロジェクト概要

連珠（五目並べ/Gomoku）学習ゲーム：

- **デモモード**: キャラクター（VTuber フブキ＆ミコ）が対話形式で連珠の戦略を解説
- **問題モード**: プレイヤーが即座にフィードバックを受けながら着手を練習
- **シナリオエディタ**: 学習シナリオを作成するための内蔵エディタ

## コマンド

```bash
pnpm check-fix     # 型チェック + フォーマット + lint（個別コマンドではなくこれを使う）
pnpm dev           # 開発サーバー（通常は起動済み）
pnpm build         # 本番ビルド
```

### Git

- `git -C` は使わないこと。必要なら `pwd` で確認する。

### ワークツリー（サブエージェント）

- ワークツリーでコミットするには、先に **WASM ビルド** (`cd zig && zig build`) と **`pnpm install --frozen-lockfile --ignore-scripts`** が必要。lefthook の pre-commit フックがテストを走らせるため。
- `--ignore-scripts` は必須（lefthook の prepare が worktree で失敗するため）。
- コミットメッセージを作るのにはシンプルに `-m` を使用。パイプや `$()` は禁止。

## 計画

- TDDで進める
- 何でも質問すること。ボスはアホなので指示に見落としがある。
- `/review` スキル（ユーザースキル）を使ってサブエージェントでプランや実装をレビューする。
- プラン実行後考慮漏れや誤りに気づいた場合、そこで作業を止め、判明した事象を踏まえてプランを練り直す。場当たり的な実装を避ける。

## アーキテクチャ

### 状態管理（Pinia stores: `src/stores/`）

- **appStore**: ナビゲーション状態（scenes: menu → difficulty → scenarioList → scenarioPlay/editor）
- **boardStore**: 盤面状態、石、マーク、ラインとアニメーションコールバック
- **dialogStore**: キャラクター対話の表示状態
- **progressStore**: 学習進捗の追跡
- **preferencesStore**: ユーザー設定（文字サイズなど）

### コアゲームロジック（`src/logic/`）

- **renjuRules.ts**: 連珠ルール（黒石の禁手：三三、四四、長連を含む）
- **boardParser.ts**: 文字列表記から盤面状態をパース
- **scenarioParser.ts**: シナリオJSONファイルをパース

### コンポーネント構成

- **ScenarioPlayer**（`src/components/scenarios/ScenarioPlayer/`）: メインのゲームプレイコンポーネント。ナビゲーション、キーボード入力、問題解答、カットイン表示のcomposableを持つ
- **RenjuBoard**（`src/components/game/RenjuBoard/`）: Vue Konvaベースの盤面。レイアウト、インタラクション、アニメーションのcomposableを持つ
- **Editor**（`src/editor/`）: File System Access API統合を備えたシナリオ編集スイート

### 型システム（`src/types/`）

- **scenario.ts**: コア型 - Scenario, DemoSection, QuestionSection, BoardAction, SuccessCondition
- **game.ts**: BoardState（15×15グリッド）, Position, StoneColor
- **character.ts**: CharacterType, EmotionId
- **text.ts**: TextNode（ルビ注釈付きリッチテキスト用）

## 開発ガイドライン

### 計画

- SSoT, DRY, SOLID, t-wada TDD を実践する
- フェーズごとにコミット
- exitPlanMode の前に /review でプランをレビュー

### パッケージマネージャ / スクリプト

- パッケージ管理には `pnpm` を使用
- `npx` は使わない。スクリプトは `pnpm <script>` で実行する。
- 非自明なロジックを持つコンポーネントやモジュールの近くにREADMEを書く。
- **`rm` コマンドを直接使わない** — 確認プロンプトが出る。`git clean` を使うかユーザーに確認する。

### Vue/TypeScript

- `<script setup lang="ts">` とジェネリック形式の defineProps を使用
- モーダルには `<dialog>` 要素を使用（既存コンポーネントを参照）
- ref 経由でコンポーネントメソッドを参照する際はオプショナルチェイニング（`ref?.method()`）を使用
- SFC は約400行以内に収める。composable を抽出するかコンポーネントを分割する
- union型を扱う際は if-else チェーンではなく、型ガードまたは switch 文を使用
- スクリプト開発時は `ts-node` や `tsx` ではなく `node --experimental-strip-types` を使用

### CSS

- **固定 960×540 ビューポート**: `style.css` の CSS変数を使用（例: `--size-16`, `--size-24`）
- **レイアウトに rem/px を使わない** — `--size-*` 変数と clamp() を使用
- カラー: `:root` 変数を使用（例: `--color-fubuki-primary`, `--color-text-primary`）
- フォントウェイト: normal=300, bold=500
- スコープ付きスタイルはコンポーネント境界を超えて継承されない。ユーティリティは `style.css` に置く
- `<dialog>` や popover 要素に `display` を直接設定しない

### アイコン

- すべてのUIアイコンに **Material Symbols Outlined**（weight 400）を使用（Apache-2.0）
- SVGファイルは `src/assets/icons/` に `fill="currentColor"` で配置
- コンポーネントとしてインポート: `import InfoIcon from "@/assets/icons/info.svg?component"`
- テンプレートで使用: `<InfoIcon />`
- ソース: https://github.com/google/material-design-icons/tree/master/symbols/web
- 新しいアイコンを追加するには `/download-icon` スキルを使用

### Konva

- Vue Konva コンポーネント（`v-stage`, `v-layer`, `v-circle` 等）を使用
- 盤面レンダリングはレイアウト計算とアニメーション用のcomposableを使用

### テスト

- E2Eテスト用に Playwright MCP が利用可能
- ブラウザビューポート: 960×540（固定）
- テスト中のスクリーンショットは最小限に（コンテキスト制限）
- ヘッドレスブラウザテストには `pnpm test:browser:headless` を使用（エージェント/CI向け）

### コミット前

- `pnpm check-fix` を実行して型チェック、フォーマット、lintをパスさせる
- サブエージェントで `/review` を実行する

## タスク計画

- `docs/` で実装プランやTODOを確認する
- 学びをAGENTS.mdに一般化する

## 連珠の知識

- **連珠ルール（禁手・パターン判定）は TS (`src/logic/renjuRules/`) と Zig (`zig/src/forbidden.zig`, `jump_patterns.zig`) に二重実装されている。どちらかを変更したら必ず両方を直し、`renjuParity.test.ts`（TS⇄Zig パリティテスト）が緑か確認すること。**
- 連珠は15×15の盤で行う
- 黒が先手で、禁手あり（三三、四四、長連）
- 勝利条件: 横・縦・斜めに先に5つ石を並べること
- 座標表記: 左下が原点。例: 15A, 1O
- 棋譜の例:
  - H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11
