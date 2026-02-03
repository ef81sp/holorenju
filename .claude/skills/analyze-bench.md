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

| 問題パターン | 検出方法 | 戦術的意味 |
|-------------|----------|-----------|
| ランダム選択による悪手 | `randomSelection.wasRandom=true` かつスコア差大 | 難易度調整の副作用 |
| 深度依存の判断変化 | 異なる深度で最善手が変化 | 評価関数の問題発見 |
| スコア逆転局面 | 連続する手でスコアが大きく変動 | 致命的なミス |
| 候補手との乖離 | `selectedRank > 1` で上位手とのスコア差大 | 意図せぬ悪手 |

#### 分析コード例

```bash
# ランダム選択で悪手を打った回数（スコア差500以上）
jq -r '
  [.games[].moveHistory[] |
   select(.randomSelection.wasRandom == true) |
   select(.candidates | length > 1) |
   select((.candidates[0].searchScore - .score) > 500)
  ] | length as $count |
  "ランダム選択による悪手: \($count)回"
' "$FILE"

# 上位手を選ばなかった回数（selectedRank > 1）
jq -r '
  [.games[].moveHistory[] |
   select(.selectedRank != null and .selectedRank > 1)
  ] | length as $count |
  "非最善手選択: \($count)回"
' "$FILE"
```

### 5. 戦術的観点からの洞察

| 分析項目 | 観点 | 正常範囲 | 参照ドキュメント |
|----------|------|----------|------------------|
| 探索効率 | 中断率、TT利用率、深度到達率 | 中断率30%以下 | `docs/cpu-ai-algorithm.md` |
| 難易度バランス | レーティング差の適切さ | 隣接難易度差50-150 | `docs/cpu-ai-algorithm.md` |
| 先手/後手バランス | 黒勝率 | 55-65% | `docs/renju-tactics-and-evaluation.md` |
| 勝利パターン | five/forbidden/drawの比率 | forbidden < 5% | `docs/renju-tactics-and-evaluation.md` |

### 6. 改善提案生成

分析結果に基づいて具体的な改善ポイントを提示:

- **中断率が高い場合**: timeLimit増加を検討
- **TT利用率が低い場合**: TTサイズ増加を検討
- **禁手負けが多い場合**: 禁手検出の改善が必要
- **ランダム悪手が多い場合**: randomFactorの調整を検討
- **先手勝率が偏っている場合**: 評価関数のバランス調整を検討

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
```

出力内容:
- 対局情報（プレイヤー、勝敗、手数）
- 全着手の詳細（位置、スコア、候補手）
- 問題のある着手のハイライト

## 関連ファイル

| ファイル | 役割 |
|----------|------|
| `scripts/analyze-bench.sh` | 基本統計スクリプト |
| `src/logic/cpu/benchmark/headless.ts` | MoveRecord型定義 |
| `src/types/cpu.ts` | CpuResponse型定義 |
| `docs/renju-tactics-and-evaluation.md` | 戦術知識 |
| `docs/cpu-ai-algorithm.md` | アルゴリズム知識 |
