# 対局分析スキル

## 概要

`bench-results/` のベンチマーク結果JSONを分析し、AIの強さや傾向を戦術的・アルゴリズム的観点から洞察を提供する。

## 使用方法

```
/analyze-bench                     # 最新ファイルを分析
/analyze-bench <filename.json>     # 特定ファイルを分析
/analyze-bench --compare 5         # 最新5件を比較
/analyze-bench --game <n>          # 特定ゲームの棋譜を詳細分析
```

## MoveRecordに記録される情報

各着手（MoveRecord）には以下の情報が記録される:

| フィールド       | 型                | 説明                                   |
| ---------------- | ----------------- | -------------------------------------- |
| row, col         | number            | 着手位置                               |
| time             | number            | 思考時間（ms）                         |
| isOpening        | boolean           | 開局定石かどうか                       |
| depth            | number            | 到達探索深度                           |
| score            | number            | 選択された手の探索スコア               |
| stats            | SearchStatsRecord | 探索統計（nodes, ttHits, etc.）        |
| candidates       | CandidateMove[]   | 上位5候補手（詳細情報付き）            |
| selectedRank     | number            | 選択された手の順位                     |
| randomSelection  | RandomSelectionInfo | ランダム選択情報                     |
| depthHistory     | DepthResult[]     | 深度別最善手履歴                       |

### CandidateMove（候補手）に含まれる詳細情報

| フィールド         | 説明                                       |
| ------------------ | ------------------------------------------ |
| position           | 着手位置                                   |
| score              | 即時評価スコア（内訳の合計）               |
| searchScore        | 探索スコア（順位の根拠）                   |
| rank               | 順位（1始まり）                            |
| breakdown          | スコア内訳（攻撃/防御パターン、ボーナス）  |
| principalVariation | 予想手順（PV）                             |
| leafEvaluation     | 探索末端での評価内訳                       |

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
  singleFourPenalty  // 単発四ペナルティ
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

## 分析手順

### 1. ファイル取得

```bash
# 最新ファイルを取得
ls -t bench-results/*.json | head -1

# または指定ファイルを使用
```

### 2. 基本統計の取得

既存スクリプトを実行して基本統計を取得:

```bash
./scripts/analyze-bench.sh <file>
```

出力内容:
- レーティング結果
- マッチアップ結果
- 先手/後手勝敗表
- 先手(黒)/後手(白)勝率
- 勝利理由
- 難易度別探索統計
- 深度分布

### 3. 詳細分析（jqで追加抽出）

以下の追加分析を行う:

```bash
# 中断率の確認
jq -r '
  [.games[].moveHistory[] | select(.stats) |
   {interrupted: .stats.interrupted}
  ] | group_by(.interrupted) |
  map({key: .[0].interrupted, count: length}) |
  "中断率: \(([.[] | select(.key == true)] | .[0].count // 0) * 100 / (map(.count) | add))%"
' "$FILE"

# TTヒット率
jq -r '
  [.games[].moveHistory[] | select(.stats)] |
  "平均TTヒット率: \(([.[].stats.ttHits] | add) * 100 / ([.[].stats.nodes] | add) | floor)%"
' "$FILE"

# Beta cutoff率
jq -r '
  [.games[].moveHistory[] | select(.stats)] |
  "平均Beta cutoff率: \(([.[].stats.betaCutoffs] | add) * 100 / ([.[].stats.nodes] | add) | floor)%"
' "$FILE"
```

### 4. 棋譜分析（問題パターン検出）

拡張されたMoveRecordを使って問題のある着手を検出:

#### 検出対象パターン

| 問題パターン           | 検出方法                                        | 戦術的意味         |
| ---------------------- | ----------------------------------------------- | ------------------ |
| ランダム選択による悪手 | `randomSelection.wasRandom=true` かつスコア差大 | 難易度調整の副作用 |
| 深度依存の判断変化     | `depthHistory`で深度ごとに最善手が変化          | 評価関数の問題発見 |
| スコア逆転局面         | 連続する手でスコアが大きく変動                  | 致命的なミス       |
| 候補手との乖離         | `selectedRank > 1` で上位手とのスコア差大       | 意図せぬ悪手       |
| 単発四の乱用           | `breakdown.singleFourPenalty`が頻繁に発生       | 戦術的問題         |

#### 分析コード例

```bash
# ランダム選択で悪手を打った回数（スコア差500以上）
jq -r '
  [.games[].moveHistory[] |
   select(.randomSelection.wasRandom == true) |
   select(.candidates and (.candidates | length) > 1) |
   select((.candidates[0].searchScore - .score) > 500)
  ] | length as $count |
  "ランダム選択による悪手: \($count)回"
' "$FILE"

# 上位手を選ばなかった回数（selectedRank > 1）
jq -r '
  [.games[].moveHistory[] |
   select(.selectedRank and .selectedRank > 1)
  ] | length as $count |
  "非最善手選択: \($count)回"
' "$FILE"

# 深度で最善手が変わった回数（depthHistory確認）
jq -r '
  [.games[].moveHistory[] |
   select(.depthHistory and (.depthHistory | length) > 1) |
   .depthHistory |
   [range(1; length) as $i |
    select(.[$i].position != .[($i-1)].position)
   ] | length
  ] | add as $count |
  "深度変化による最善手変更: \($count)回"
' "$FILE"

# 単発四ペナルティが発生した着手
jq -r '
  [.games[].moveHistory[] |
   select(.candidates) |
   .candidates[] |
   select(.breakdown.singleFourPenalty > 0)
  ] | length as $count |
  "単発四ペナルティ発生: \($count)回"
' "$FILE"
```

### 5. 詳細な候補手分析

```bash
# 候補手のスコア内訳を確認（特定の手）
jq '.games[0].moveHistory[5].candidates[0].breakdown' "$FILE"

# 予想手順（PV）を確認
jq '.games[0].moveHistory | map(select(.candidates)) | .[0].candidates[0].principalVariation' "$FILE"

# 末端評価の内訳を確認
jq '.games[0].moveHistory | map(select(.candidates)) | .[0].candidates[0].leafEvaluation' "$FILE"

# 深度履歴を確認（最善手が変わった着手を特定）
jq '.games[0].moveHistory | map(select(.depthHistory and (.depthHistory | length) > 1)) | .[0].depthHistory' "$FILE"
```

### 6. 戦術的観点からの洞察

| 分析項目          | 観点                         | 正常範囲           | 参照ドキュメント                       |
| ----------------- | ---------------------------- | ------------------ | -------------------------------------- |
| 探索効率          | 中断率、TT利用率、深度到達率 | 中断率30%以下      | `docs/cpu-ai-algorithm.md`             |
| 難易度バランス    | レーティング差の適切さ       | 隣接難易度差50-150 | `docs/cpu-ai-algorithm.md`             |
| 先手/後手バランス | 黒勝率                       | 55-65%             | `docs/renju-tactics-and-evaluation.md` |
| 勝利パターン      | five/forbidden/drawの比率    | forbidden < 5%     | `docs/renju-tactics-and-evaluation.md` |
| 評価関数の安定性  | 深度による最善手変化率       | 変化率20%以下      | `docs/renju-tactics-and-evaluation.md` |

### 7. 改善提案生成

分析結果に基づいて具体的な改善ポイントを提示:

- **中断率が高い場合**: timeLimit増加を検討
- **TT利用率が低い場合**: TTサイズ増加を検討
- **禁手負けが多い場合**: 禁手検出の改善が必要
- **ランダム悪手が多い場合**: randomFactorの調整を検討
- **先手勝率が偏っている場合**: 評価関数のバランス調整を検討
- **深度による最善手変化が多い場合**: 評価関数の horizon effect を検討
- **単発四ペナルティが頻発する場合**: singleFourPenaltyMultiplierの調整を検討

## 出力フォーマット例

```
## ベンチマーク分析: bench-2026-02-02T15-13-14-895Z.json

### 基本統計
（analyze-bench.shの出力を整形）

### 探索効率分析
- 中断率: beginner 5%, easy 12%, medium 25%, hard 35%
- TTヒット率: 平均42%
- Beta cutoff率: 平均18%
- 評価: hard の中断率が高め → timeLimit増加を検討

### 難易度バランス分析
- レーティング差: beginner→easy +80, easy→medium +100, medium→hard +60
- 評価: 適切な難易度階層

### 戦術的傾向
- 先手勝率: 58%（正常範囲）
- 勝利理由: five 95%, forbidden 3%, draw 2%
- ランダム選択による悪手: 12回
- 深度変化による最善手変更: 8回
- 単発四ペナルティ発生: 45回
- 評価: 正常

### 改善提案
1. hardの探索中断率を下げるため timeLimit: 5000 → 6000 を検討
2. beginnerのランダム悪手を減らすため randomFactor: 0.3 → 0.25 を検討
```

## 特定ゲームの詳細分析

`--game <n>` オプションで特定のゲームを詳細分析:

```bash
# ゲーム番号nの棋譜を取得
jq -r ".games[$n]" "$FILE"

# 特定ゲームの全着手の候補手情報
jq '.games[0].moveHistory | map(select(.candidates)) | map({
  move: "\(.row),\(.col)",
  score: .score,
  selectedRank: .selectedRank,
  topCandidate: .candidates[0] | {pos: "\(.position.row),\(.position.col)", searchScore, score},
  depthChanges: (.depthHistory | if . then length else 0 end)
})' "$FILE"
```

出力内容:
- 対局情報（プレイヤー、勝敗、手数）
- 全着手の詳細（位置、スコア、候補手、内訳）
- 問題のある着手のハイライト
- 各着手の予想手順（PV）と末端評価

## 関連ファイル

| ファイル                               | 役割                            |
| -------------------------------------- | ------------------------------- |
| `scripts/analyze-bench.sh`             | 基本統計スクリプト              |
| `src/logic/cpu/benchmark/headless.ts`  | MoveRecord型定義                |
| `src/types/cpu.ts`                     | CandidateMove, ScoreBreakdown等 |
| `docs/renju-tactics-and-evaluation.md` | 戦術知識                        |
| `docs/cpu-ai-algorithm.md`             | アルゴリズム知識                |
