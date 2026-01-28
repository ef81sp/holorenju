# CPU対戦機能 実装計画

## 概要

連珠学習ゲーム「holorenju」にCPU対戦機能を追加する。

**機能範囲**:

- CPU対戦（4段階難易度）
- キャラクター演出（フブキ/ミコの勝敗コメント、思考中セリフ）
- 対戦記録機能（勝敗履歴、統計表示）

## 技術選定

| 項目           | 選定                     | 理由                               |
| -------------- | ------------------------ | ---------------------------------- |
| AIアルゴリズム | Minimax + Alpha-Beta剪定 | 実装が明確、難易度調整しやすい     |
| 非同期処理     | Web Workers              | UIブロッキング回避、Viteで簡単統合 |
| 探索手法       | Iterative Deepening      | 時間制限内で最善手を返却可能       |

### Minimax + Alpha-Beta剪定とは

**Minimax**: 「相手は最善手を打つ」と仮定し、数手先を読んで最良の手を選ぶアルゴリズム

- 自分のターン → 評価値が最大の手を選ぶ（Max）
- 相手のターン → 評価値が最小の手を選ぶ（Min）

**Alpha-Beta剪定**: 結果が変わらない分岐をスキップする最適化。探索を数倍〜数十倍高速化。

**Iterative Deepening**: 深さ1から徐々に深く探索。時間制限内で最善手を返却できる。

## ファイル構成

既存プロジェクト構造に合わせた配置:

```
src/
├── components/
│   └── cpu/                           # CPU対戦用コンポーネント
│       ├── CpuGamePlayer.vue          # 対戦画面（ScenarioPlayerと同じGridレイアウト）
│       ├── CpuSetupPage.vue           # 設定画面（難易度・先後手選択）
│       ├── CpuGameStatus.vue          # 状態表示（手数、思考中インジケータ）
│       ├── CpuCharacterPanel.vue      # キャラクター表示・セリフ
│       ├── CpuRecordDialog.vue        # 対戦記録ダイアログ
│       └── composables/               # ScenarioPlayerと同じパターン
│           ├── useCpuGame.ts          # ゲームロジック（状態管理、勝敗判定）
│           ├── useCpuPlayer.ts        # Worker通信（着手リクエスト・レスポンス）
│           └── useCpuDialogue.ts      # セリフ管理（dialogStoreと統合）
├── logic/
│   └── cpuAI/                         # AIロジック
│       ├── types.ts                   # AI関連の型定義
│       ├── evaluation.ts              # 盤面評価関数
│       ├── minimax.ts                 # Minimax + Alpha-Beta
│       ├── moveGenerator.ts           # 候補手生成
│       └── renjuAI.worker.ts          # Web Worker
├── stores/
│   ├── cpuGameStore.ts                # CPU対戦用ストア（新規）
│   └── cpuRecordStore.ts              # 対戦記録ストア（新規・localStorage永続化）
└── types/
    └── cpu.ts                         # 型定義（新規）
```

## 既存コードの再利用

### 再利用ファイル一覧

| ファイル                          | 再利用内容                                                        |
| --------------------------------- | ----------------------------------------------------------------- |
| `src/logic/renjuRules.ts`         | `checkForbiddenMove`, `checkWin`, `recognizePattern`, `copyBoard` |
| `src/stores/boardStore.ts`        | 盤面状態管理（SSoT）                                              |
| `src/stores/appStore.ts`          | シーン遷移（`cpu`モードのスタブが既存）                           |
| `src/stores/dialogStore.ts`       | セリフ表示管理                                                    |
| `src/components/game/RenjuBoard/` | 盤面UIコンポーネント                                              |
| `src/components/common/`          | CutinOverlay, ConfirmDialog, BackButton等                         |

### renjuRules.tsの関数活用

| 関数名               | 行番号 | 用途                           | 評価関数での使い方         |
| -------------------- | ------ | ------------------------------ | -------------------------- |
| `checkForbiddenMove` | 867    | 禁手判定                       | 黒番の候補手フィルタリング |
| `checkWin`           | 885    | 勝利判定                       | 終端ノード判定             |
| `checkFive`          | 109    | 五連チェック                   | 勝利条件の評価             |
| `recognizePattern`   | 897    | パターン認識（活三・活四など） | 評価スコアの計算           |
| `copyBoard`          | 978    | 盤面コピー                     | Minimax探索用の盤面複製    |
| `createEmptyBoard`   | 970    | 空盤面生成                     | 初期盤面作成               |
| `isValidPosition`    | 52     | 位置の有効性チェック           | 候補手生成時の境界チェック |

### 評価関数の設計方針

評価関数では`recognizePattern`を活用してパターンベースのスコアリングを行う。各空きマスについて自分と相手のパターンを認識し、五連・活四・活三などに応じたスコアを加減算する。

白番の場合は`checkForbiddenMove`で禁手マスを特定し、黒を禁手に誘導できる形にボーナスを与える。

候補手生成では、既存石の周囲2マスのみを探索対象とし、黒番の場合は`checkForbiddenMove`で禁手となるマスを除外する（ただし五連成立時は除く）。

## 型定義

### `src/types/cpu.ts`

**CpuDifficulty**: 難易度を表す文字列リテラル型（`"beginner"` | `"easy"` | `"medium"` | `"hard"`）

**DifficultyParams**: 難易度ごとのパラメータ

- `depth`: 探索深度
- `timeLimit`: 時間制限（ミリ秒）
- `randomFactor`: ランダム要素（0-1、0で完全決定論的）

**AIRequest/AIResponse**: Worker通信用のメッセージ型

- リクエスト: 盤面、石色、難易度を送信
- レスポンス: 着手位置、評価スコア、思考時間、探索深度を返却

**CpuBattleRecord**: 対戦記録（ID、日時、難易度、先後手、結果、手数）

**CpuBattleStats**: 難易度別統計（勝敗数、勝率）

## 統合ポイント

### appStore.ts の修正

**Scene型の拡張**: `"cpuSetup"` と `"cpuPlay"` を追加

**AppState型の拡張**: `cpuDifficulty`（選択中の難易度）と`playerFirst`（先手かどうか）を追加

**selectModeアクションの修正**: `mode === "cpu"` の場合、現在の空returnを削除し、`cpuSetup`シーンへ遷移するよう実装

**新規アクション追加**:

- `startCpuGame(difficulty, playerFirst)`: CPU対戦を開始し`cpuPlay`シーンへ遷移
- `goToCpuSetup()`: CPU設定画面に戻る

### MainView.vue の修正

**インポート追加**: `CpuSetupPage`と`CpuGamePlayer`コンポーネント

**条件分岐追加**: `currentScene === 'cpuSetup'`と`currentScene === 'cpuPlay'`のケースを追加

**戻る確認の拡張**: `cpuPlay`シーンでも`scenarioPlay`と同様に確認ダイアログを表示

### MenuPage.vue の修正

CPU対戦ボタンから以下を変更:

- `:disabled="true"` を削除
- `badge`要素（「未実装」ラベル）を削除
- 説明文を「今後実装予定」から「AIと対局して腕を磨こう」に変更

## コンポーネント設計

### CpuGamePlayer.vue

ScenarioPlayerと同じCSS Gridレイアウト（`grid-template-columns: 4fr 7fr 5fr`、`grid-template-rows: 7fr 2fr`）を採用。

**操作セクション（左上）**: BackButton、SettingsControl、CpuGameStatus（手数・ターン・思考中表示）

**盤面セクション（中央）**: RenjuBoard（既存コンポーネント再利用）、CutinOverlay（勝敗時のカットイン）

**情報セクション（右側）**: CpuCharacterPanel（キャラクター立ち絵・表情）、ゲームコントロール（待った、対戦記録、もう一度）

**セリフ部（左下）**: DialogSection（既存コンポーネント再利用）

### Composablesパターン

ScenarioPlayerと同様に、ロジックをcomposablesに分離:

**useCpuGame.ts**: ゲームの状態管理

- プレイヤー/CPUの石色管理
- ターン判定
- 着手処理（禁手チェック含む）
- 勝利判定
- 待った機能（2手戻し）
- ゲームリセット

**useCpuPlayer.ts**: AIとのWorker通信

- Workerの初期化・終了
- 着手リクエストの送信
- 思考中状態の管理
- レスポンスの受信処理

**useCpuDialogue.ts**: キャラクターセリフ管理

- CPUキャラクターのランダム選択（フブキ/ミコ）
- シチュエーション別セリフの選択・表示
- dialogStoreとの連携
- 表情（EmotionId）の管理

## ストア設計

### cpuGameStore.ts

Options API形式のPiniaストア。

**State**: 難易度、先後手、着手履歴、ゲーム開始/終了フラグ、勝者

**Getters**: 手数、現在ターン、プレイヤー石色、CPU石色

**Actions**: ゲーム開始、着手追加、待った（指定手数戻す）、ゲーム終了、リセット

### cpuRecordStore.ts

Composition API形式のPiniaストア。localStorage永続化。

**State**: 対戦記録の配列（最大100件）

**初期化**: localStorageから読み込み

**自動保存**: `watch`で記録変更時にlocalStorageへ保存

**Actions**: 記録追加（古い記録は自動削除）

**Getters**: 難易度別統計の算出、全難易度統計、直近10件の記録

## キャラクター演出

### セリフパターン

以下のシチュエーションごとに複数のセリフを用意し、ランダムに選択:

| シチュエーション | 例                              | 表情      |
| ---------------- | ------------------------------- | --------- |
| CPU思考中        | 「うーん、どこに置こうかな...」 | thinking  |
| プレイヤー好手   | 「おっ、いい手だね！」          | surprised |
| CPU優勢          | 「ふふっ、見えてるよ～」        | smug      |
| プレイヤー勝利   | 「わぁ、負けちゃった...」       | sad       |
| CPU勝利          | 「やったー！勝っちゃった！」    | excited   |
| ゲーム開始       | 「よろしくお願いします！」      | happy     |

### dialogStoreとの統合

`useCpuDialogue`から`dialogStore.showMessage()`を呼び出し、`DialogMessage`形式でセリフを表示。キャラクター、表情、テキストを指定。

## 難易度設定

| 難易度     | 探索深度 | 時間制限 | ランダム要素                  |
| ---------- | -------- | -------- | ----------------------------- |
| `beginner` | 2        | 1秒      | あり（最善手以外も30%の確率） |
| `easy`     | 3        | 2秒      | 少し（15%）                   |
| `medium`   | 4        | 3秒      | なし                          |
| `hard`     | 5        | 5秒      | なし                          |

## 評価関数の評価要素

| パターン           | スコア  |
| ------------------ | ------- |
| 五連（勝利）       | +100000 |
| 活四               | +5000   |
| 止め四             | +500    |
| 活三               | +300    |
| 止め三             | +50     |
| 活二               | +10     |
| 中央寄り           | +5      |
| 禁じ手誘導（白番） | +100    |

**連珠特有の考慮点**:

- 黒番AI: 禁じ手となるマスは候補から除外（五連成立時を除く）
- 白番AI: 黒を禁じ手に誘導する戦略にボーナス

## 実装フェーズ

### Phase 1: 基本実装

**目標**: 最小限動作するCPU対戦

1. **型定義とストア**: `cpu.ts`で型定義、`cpuGameStore.ts`でゲーム状態管理
2. **シンプルなAI（深さ2-3）**: 評価関数、候補手生成、Alpha-Beta剪定の基本実装
3. **UIコンポーネント**: 設定画面、対戦画面、appStoreのシーン追加

### Phase 2: 強化・改善

**目標**: 実用的なAI強度とUX

1. **Web Worker化**: AIをメインスレッドから分離、Worker通信Composable実装
2. **Iterative Deepening**: 時間制限内で可能な限り深く探索
3. **UX改善**: 思考中インジケータ、待った機能、キーボード操作

### Phase 3: キャラクター演出・対戦記録

**目標**: ゲーム体験の向上

1. **キャラクター演出**: キャラクターパネル、セリフパターン、表情切り替え
2. **対戦記録**: localStorage永続化、難易度別統計、記録ダイアログUI

### Phase 4: 最適化（オプション）

- Transposition Table（同一局面キャッシュ）
- Move Ordering（脅威優先ソート）
- WebAssembly高速化 (Rapfi)

## 検証方法

1. **単体テスト**: 評価関数の正確性、禁じ手の候補除外
2. **手動テスト**: 全難易度で1ゲーム完走、先手/後手両方でプレイ、待った機能の動作
3. **E2Eテスト（Playwright）**: メニュー → CPU対戦設定 → プレイ → 終了のフロー

## 主要ファイル

- `src/logic/renjuRules.ts` - 禁じ手・勝利判定（再利用）
- `src/stores/boardStore.ts` - 盤面状態（再利用）
- `src/stores/dialogStore.ts` - セリフ表示（再利用）
- `src/stores/appStore.ts` - シーン遷移（修正）
- `src/components/game/RenjuBoard/RenjuBoard.vue` - 盤面UI（再利用）
