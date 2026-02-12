---
name: analyze-bench
description: ベンチマーク結果を分析して戦術的洞察を提供
allowed-tools:
  - Bash(pnpm analyze:bench:*)
  - Bash(pnpm analyze:deep:*)
  - Bash(node --eval:*)
  - Bash(ls:*)
  - Write(docs/bench-reports/*.md)
---

# 対局分析スキル

## 概要

`bench-results/` のベンチマーク結果JSONを分析し、AIの強さや傾向を戦術的・アルゴリズム的観点から洞察を提供する。

## 前提知識

- 人間が見る座標は、左下が原点。左上が15A, 右下が1Oの形式。
- row/colは0始まりインデックス。これは左上が原点（例: 15A = row0, col0）

## 使用方法

```
/analyze-bench                     # 最新ファイルを分析
/analyze-bench <filename.json>     # 特定ファイルを分析
```

## MoveRecordに記録される情報

各着手（MoveRecord）には以下の情報が記録される:

| フィールド      | 型                   | 説明                                       |
| --------------- | -------------------- | ------------------------------------------ |
| row, col        | number               | 着手位置                                   |
| time            | number               | 思考時間（ms）                             |
| isOpening       | boolean              | 開局定石かどうか                           |
| depth           | number?              | 到達探索深度（開局時は undefined）         |
| score           | number?              | 選択された手の探索スコア                   |
| stats           | SearchStatsRecord?   | 探索統計（nodes, ttHits, etc.）            |
| candidates      | CandidateMove[]?     | 上位5候補手（詳細情報付き）                |
| selectedRank    | number?              | 選択された手の順位（1始まり）              |
| randomSelection | RandomSelectionInfo? | ランダム選択情報                           |
| depthHistory    | DepthResult[]?       | 深度別最善手履歴                           |
| forcedForbidden | boolean?             | 禁手追い込みで勝った場合true（最終手のみ） |

### SearchStatsRecord（探索統計）

| フィールド           | 型      | 説明                               |
| -------------------- | ------- | ---------------------------------- |
| nodes                | number  | 探索ノード数                       |
| ttHits               | number  | TTヒット数                         |
| ttCutoffs            | number  | TTカットオフ数                     |
| betaCutoffs          | number  | Beta剪定数                         |
| maxDepth             | number  | 設定された最大探索深度             |
| completedDepth       | number  | 実際に到達した探索深度             |
| interrupted          | boolean | 中断されたか                       |
| forbiddenCheckCalls  | number  | 禁手判定回数                       |
| boardCopies          | number  | 盤面コピー回数                     |
| threatDetectionCalls | number  | 脅威検出回数                       |
| evaluationCalls      | number  | 評価関数呼び出し回数               |
| nullMoveCutoffs      | number? | Null Move Pruning によるカットオフ |
| futilityPrunes       | number? | Futility Pruning によるスキップ    |

### CandidateMove（候補手）

| フィールド         | 説明                                      |
| ------------------ | ----------------------------------------- |
| position           | 着手位置                                  |
| score              | 即時評価スコア（内訳の合計）              |
| searchScore        | 探索スコア（順位の根拠）                  |
| rank               | 順位（1始まり）                           |
| breakdown          | スコア内訳（攻撃/防御パターン、ボーナス） |
| principalVariation | 予想手順（PV）                            |
| leafEvaluation     | 探索末端での評価内訳                      |

### ScoreBreakdown（スコア内訳）の構造

```
breakdown: {
  pattern: {         // 攻撃パターン
    five, openFour, four, openThree, three, openTwo, two
    // 各要素: { base, diagonalBonus, final }
  },
  defense: {         // 防御パターン
    five, openFour, four, openThree, three, openTwo, two
    // 各要素: { base, diagonalBonus, final, preMultiplier, multiplier }
  },
  fourThree,         // 四三ボーナス
  fukumi,            // フクミ手ボーナス
  mise,              // ミセ手ボーナス
  center,            // 中央ボーナス
  multiThreat,       // 複数脅威ボーナス
  singleFourPenalty, // 単発四ペナルティ
  forbiddenTrap      // 禁手追い込みボーナス（白番のみ）
}
```

### LeafEvaluation（末端評価）の構造

```
leafEvaluation: {
  myScore,           // 自分のスコア合計
  opponentScore,     // 相手のスコア合計
  total,             // 最終スコア (myScore - opponentScore)
  myBreakdown,       // 自分のパターン内訳
  opponentBreakdown  // 相手のパターン内訳
}
```

## ゲームデータ構造

ベンチマークJSONのゲーム構造:

```
games[]: {
  playerA: string,        // 難易度名 (beginner, easy, medium, hard)
  playerB: string,        // 難易度名
  isABlack: boolean,      // playerAが黒番(先手)かどうか
  winner: "A" | "B" | "draw",
  reason: "five" | "forbidden" | "draw" | "move_limit",
  moves: number,          // 総手数
  duration: number,       // 対局時間(ms)
  moveHistory: MoveRecord[]
}
```

## レポート出力

分析結果は `docs/bench-reports/` にMarkdownファイルとして保存する。

### ファイル命名規則

```
docs/bench-reports/bench-report-YYYY-MM-DD-N.md
```

- `N` は同日の通し番号（1から開始）
- 例: `bench-report-2026-02-04-1.md`, `bench-report-2026-02-04-2.md`

既存ファイルを確認して次の番号を決定:

```bash
ls docs/bench-reports/bench-report-2026-02-04-*.md 2>/dev/null | wc -l
```

### レポート構成

すべての項目を難易度ごとに出力する。

1. タイトル（日付-通し番号とベンチマークファイル名）
2. 変更概要（パラメータ調整があれば）
3. 難易度別レーティング結果（前回との比較があれば差分も）
4. レーティング差（隣接難易度間）
5. 先手(黒)/後手(白)勝率・同難易度バランス
6. 勝利理由（five/forbidden/move_limit）
7. 難易度別探索統計（着手数、平均ノード、最大ノード、到達深度、設定深度、中断率）
8. 深度分布
9. 難易度別探索効率（TTヒット率、Beta cutoff率）
10. 難易度別詳細プロファイリング（禁手判定、盤面コピー、脅威検出、評価関数、NMP、Futility）
11. 難易度別選択順位分布（R1:xxx, R2:xxx...、候補外）
12. 難易度別ランダム悪手（スコア差500以上）
13. 難易度別禁手負け・禁手負け詳細（禁手追い込み/自滅の区別）
14. ゲーム長統計（平均/最短/最長）
15. 単発四ペナルティ
16. 深度変化（最善手の安定性）
17. 難易度別思考時間（平均、p50、p90、p95、p99、max、timeLimit超過）
18. 問題点・改善提案
19. 結論

### 注意事項

- 分析完了後、必ずレポートをmdファイルに出力すること
- 前回のベンチマークとの比較がある場合は差分を明記
- 改善提案は具体的なパラメータ値を含めること

## 分析手順

### 重要: ツール呼び出しの最小化

`pnpm analyze:bench` が全統計を1パスで出力するため、追加コマンドは基本的に不要。
特定ゲームの深掘り分析が必要な場合のみ、Nodeワンショットスクリプトで個別データを取得する。

### 1. ファイル取得と全統計取得（1コマンドで完了）

```bash
pnpm analyze:bench <file>  # 引数なしで最新ファイルを自動選択
```

このコマンドで以下の全セクションが出力される:

- 基本情報（日時、ゲーム数、プレイヤー、マッチアップ数）
- レーティング結果・レーティング差
- マッチアップ結果・先手/後手勝敗表（黒/白それぞれ）
- 先手(黒)/後手(白)勝率・同難易度バランス（難易度別内訳付き）
- 勝利理由
- 難易度別探索統計・深度分布・探索効率
- 難易度別詳細プロファイリング（禁手判定、盤面コピー、脅威検出、評価関数、NMPカットオフ、Futilityスキップ）
- 選択順位分布・ランダム悪手・禁手負け詳細（禁手追い込み/自滅の区別付き）
- ゲーム長統計（平均/最短/最長）
- 異難易度対戦の先手/後手勝率
- 単発四ペナルティ数
- 深度変化（最善手の安定性）
- 難易度別思考時間（平均、p50、p90、p95、p99、max、timeLimit超過の詳細上位5件）

### 2. 深掘り分析（`pnpm analyze:deep`）

blunder分布、advantage-squandered詳細、time-pressure-error詳細、特定ゲームの手順表示を行う。

```bash
pnpm analyze:deep                         # 最新ファイルの全分析
pnpm analyze:deep --blunders              # blunder分布のみ
pnpm analyze:deep --squandered            # advantage-squanderedのみ
pnpm analyze:deep --tpe                   # time-pressure-errorのみ
pnpm analyze:deep --game=35               # 特定ゲームの手順表示
pnpm analyze:deep --file=<file.json>      # 特定ファイル指定
```

出力内容:

- **blunder分布**: 深度別内訳（d0強制手/d3中断/d4評価失敗）、スコア差範囲、真の評価失敗数、Top 10
- **advantage-squandered**: ピークスコア、VCFフラグ、ピーク後のスコア推移、中断回数
- **time-pressure-error**: depthHistory全体、スコア悪化幅でソート
- **game手順**: 全手のscore/depth/top candidate/フラグ（INT/FALLBACK/FORCED）

### 3. 特定ゲームの更に詳細な調査（必要な場合のみ）

`pnpm analyze:deep` で気になるゲームが見つかった場合、`node --eval` でJSONを直接読み込んで候補手のbreakdownやPVを調査する。

### 3. 戦術的観点からの洞察

| 分析項目          | 観点                            | 正常範囲           | 参照ドキュメント                       |
| ----------------- | ------------------------------- | ------------------ | -------------------------------------- |
| 探索効率          | 中断率、TT利用率、深度到達率    | 中断率30%以下      | `docs/cpu-ai-algorithm.md`             |
| 難易度バランス    | レーティング差の適切さ          | 隣接難易度差50-150 | `docs/cpu-ai-algorithm.md`             |
| 先手/後手バランス | 黒勝率                          | 55-65%             | `docs/renju-tactics-and-evaluation.md` |
| 勝利パターン      | five/forbidden/move_limitの比率 | forbidden < 5%     | `docs/renju-tactics-and-evaluation.md` |
| 評価関数の安定性  | 深度による最善手変化率          | 変化率20%以下      | `docs/renju-tactics-and-evaluation.md` |
| 思考時間          | timeLimit超過率、パーセンタイル | 超過率5%以下       | `docs/cpu-ai-algorithm.md`             |

### 4. 改善提案生成

分析結果に基づいて具体的な改善ポイントを提示:

- **中断率が高い場合**: timeLimit増加を検討
- **TT利用率が低い場合**: TTサイズ増加を検討
- **禁手負けが多い場合**: 禁手検出の改善が必要
- **ランダム悪手が多い場合**: randomFactorの調整を検討
- **先手勝率が偏っている場合**: 評価関数のバランス調整を検討
- **深度による最善手変化が多い場合**: 評価関数の horizon effect を検討
- **単発四ペナルティが頻発する場合**: singleFourPenaltyMultiplierの調整を検討
- **timeLimit超過が多い場合**: timeLimitの増加、または枝刈りの強化を検討
- **禁手追い込み率が低い場合**: forbiddenTrapボーナスの調整を検討

## 出力フォーマット例

```
## ベンチマーク分析: bench-2026-02-02T15-13-14-895Z.json

### 基本統計
（pnpm analyze:bench の出力を整形）

### 探索効率分析
- 中断率: beginner 0%, easy 0%, medium 0%, hard 4%
- TTヒット率: beginner 30%, easy 30%, medium 25%, hard 17%
- Beta cutoff率: beginner 0%, easy 22%, medium 32%, hard 31%
- 評価: hard の中断率は低く正常

### 難易度バランス分析
- レーティング差: hard-medium +346, medium-easy +234, easy-beginner +186
- 評価: 差が大きめ、mediumとeasyの間が広い

### 戦術的傾向
- 先手勝率: 47%（やや低め）
- 勝利理由: five 859, forbidden 126, move_limit 15
- ランダム選択による悪手: 0回
- 深度変化による最善手変更: 0回 (0%)
- 単発四ペナルティ発生: 4204回
- 禁手追い込み成功: 126/126件 (100%)
- 評価: 禁手追い込みが完全に機能

### 思考時間分析
- hard: p95 5856ms, timeLimit超過 201回
- medium: p95 1275ms, timeLimit超過 10回
- 評価: hard の超過が多いため timeLimit 増加を検討

### 改善提案
1. hardのtimeLimit超過201回 → timeLimit: 8000 → 10000 を検討
2. 先手勝率47%がやや低い → 黒番の評価バランス確認
```

## 関連ファイル

| ファイル                               | 役割                                    |
| -------------------------------------- | --------------------------------------- |
| `scripts/analyze-bench.ts`             | 基本統計CLI                             |
| `scripts/analyze-bench-deep.ts`        | 深掘り分析CLI（blunder/squandered/TPE） |
| `scripts/lib/benchStatistics.ts`       | 統計計算・フォーマットライブラリ        |
| `scripts/lib/benchDeepDive.ts`         | 深掘り分析ライブラリ                    |
| `src/logic/cpu/benchmark/headless.ts`  | MoveRecord型定義                        |
| `src/types/cpu.ts`                     | CandidateMove, ScoreBreakdown等         |
| `docs/renju-tactics-and-evaluation.md` | 戦術知識                                |
| `docs/cpu-ai-algorithm.md`             | アルゴリズム知識                        |
