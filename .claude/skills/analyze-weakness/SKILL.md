---
name: analyze-weakness
description: ベンチマーク対局の弱点パターンを分析し改善提案を提供
allowed-tools:
  - Bash(pnpm analyze:weakness:*)
  - Bash(node --eval:*)
  - Bash(ls:*)
  - Write(docs/bench-reports/*.md)
---

# 弱点パターン分析スキル

## 概要

`bench-results/` のベンチマーク対局結果から弱点パターン（blunder、missed-VCF、advantage-squandered等）を自動検出し、改善提案を提供する。

## 前提知識

- 人間が見る座標は、左下が原点。左上が15A, 右下が1Oの形式。
- row/colは0始まりインデックス。これは左上が原点（例: 15A = row0, col0）

## 使用方法

```
/analyze-weakness                          # 最新ベンチ結果を分析
/analyze-weakness <filename.json>          # 特定ファイルを分析
/analyze-weakness --run --games=20         # 対局してから分析
```

## 検出する弱点パターン

| 弱点タイプ              | 検出方法                                                     |
| ----------------------- | ------------------------------------------------------------ |
| blunder                 | 前手との評価スコア差 >= 2000                                 |
| missed-vcf              | 負けた側の局面で `findVCFMove` を再実行し、未検出のVCFを発見 |
| advantage-squandered    | スコア +3000以上 → 最終的に負け                              |
| depth-disagreement      | `depthHistory` で深度間の最善手が不一致                      |
| forbidden-vulnerability | 禁手負けゲームを逆算し、禁手追い込みが成立した局面を特定     |
| time-pressure-error     | `stats.interrupted=true` かつ前深度の最善手より悪い手を選択  |

## WeaknessReport の構造

```typescript
interface WeaknessReport {
  timestamp: string;
  sourceFile: string;
  totalGames: number;
  weaknesses: WeaknessInstance[]; // 弱点インスタンス一覧
  patterns: WeaknessPatternSummary[]; // パターン別集計
  suggestions: ImprovementSuggestion[]; // 改善提案
}
```

### WeaknessInstance の共通フィールド

| フィールド  | 型               | 説明                         |
| ----------- | ---------------- | ---------------------------- |
| type        | WeaknessType     | 弱点タイプ                   |
| gameIndex   | number           | 対局インデックス（0始まり）  |
| moveNumber  | number           | 手番号（1始まり）            |
| color       | "black"\|"white" | 弱点が発生したプレイヤーの色 |
| position    | Position         | 着手位置                     |
| description | string           | 説明                         |

### 各タイプ固有フィールド

**blunder**: `previousScore`, `currentScore`, `scoreDrop`
**missed-vcf**: `vcfMove`, `actualMove`
**advantage-squandered**: `peakScore`, `peakMoveNumber`, `finalResult`
**depth-disagreement**: `depthHistory[]` (depth, position, score)
**forbidden-vulnerability**: `trapMoveNumber`
**time-pressure-error**: `previousDepthScore`, `previousDepthMove`, `finalScore`, `completedDepth`, `maxDepth`

## レポート出力

分析結果は `docs/bench-reports/` にMarkdownファイルとして保存する。

### ファイル命名規則

```
docs/bench-reports/weakness-report-YYYY-MM-DD-N.md
```

- `N` は同日の通し番号（1から開始）
- 既存ファイルを確認して次の番号を決定

### レポート構成

1. タイトル（日付とベンチマークファイル名）
2. 変更概要（直前のコード変更があれば）
3. パターン別集計テーブル（件数、率、黒/白内訳）
4. 弱点インスタンスの詳細
   - 各タイプごとにグループ化
   - 重要なものは具体的な盤面状況を解説
5. 特筆すべきゲームの深掘り分析
   - スコア推移
   - VCFの誤判定/見逃しの原因分析
   - 候補手のスコア内訳
6. 改善提案（優先度付き）
7. 前回レポートとの比較（あれば）

## 分析手順

### 1. `pnpm analyze:weakness` で基本分析（1コマンドで完了）

```bash
pnpm analyze:weakness                     # 最新ファイルを自動選択
pnpm analyze:weakness --file=<file>       # 特定ファイル指定
```

このコマンドで出力される内容:

- パターン別集計
- 弱点インスタンス一覧（タイプ別、最大10件ずつ）
- 改善提案
- JSON保存先（`weakness-reports/weakness-*.json`）

### 2. 特定ゲームの深掘り分析（必要な場合のみ）

`pnpm analyze:weakness` の出力で気になるゲームがあれば、`node --eval` でベンチマークJSONを直接読み込んで詳細調査する。

調査対象例:

- blunderが発生した手の候補手スコア内訳
- missed-vcfの盤面でなぜVCFが見逃されたか
- advantage-squanderedのスコア推移とターニングポイント
- 禁手追い込みの手順

```bash
node --eval "
const data = require('./bench-results/<file>.json');
const game = data.games[<gameIndex>];
// 特定の手の候補手や PV を確認
const move = game.moveHistory[<moveIndex>];
console.log(JSON.stringify(move.candidates, null, 2));
"
```

### 3. 弱点の根本原因を特定

| 弱点パターン            | 主な原因                                   | 調査方法                             |
| ----------------------- | ------------------------------------------ | ------------------------------------ |
| blunder                 | 探索深度不足、評価関数の盲点               | 候補手のsearchScoreとbreakdownを比較 |
| missed-vcf              | VCF探索の深度/時間制限、カウンターフォー等 | 盤面再構築してVCF探索を再実行        |
| advantage-squandered    | 防御評価の欠陥、VCF誤判定                  | スコア推移のターニングポイントを特定 |
| depth-disagreement      | 評価関数の horizon effect                  | depthHistoryの各深度のPVを比較       |
| forbidden-vulnerability | 禁手回避ロジックの不備                     | 禁手追い込み手順の再現               |
| time-pressure-error     | 探索時間不足、枝刈り効率                   | interrupted=trueの手の統計           |

### 4. 改善提案の具体化

分析結果から具体的なパラメータ調整案や修正方針を提示:

- **blunder多発**: 探索深度増加、評価パターンの重み調整
- **missed-vcf**: VCF_MAX_DEPTH/VCF_TIME_LIMITの増加
- **advantage-squandered**: VCF誤判定の修正（カウンターフォー等）、防御評価の強化
- **depth-disagreement多発**: 評価関数の安定性改善、aspiration windowの調整
- **forbidden-vulnerability**: 禁手脆弱性評価の強化
- **time-pressure-error**: timeLimit増加、NMP/Futilityの調整

## 関連ファイル

| ファイル                               | 役割                          |
| -------------------------------------- | ----------------------------- |
| `scripts/analyze-weakness.ts`          | CLI エントリポイント          |
| `scripts/lib/weaknessAnalyzer.ts`      | 弱点分析ロジック              |
| `scripts/types/weakness.ts`            | 弱点関連の型定義              |
| `src/logic/cpu/benchmark/headless.ts`  | MoveRecord型定義              |
| `src/logic/cpu/search/vcf.ts`          | VCF探索（missed-vcf再検証用） |
| `docs/renju-tactics-and-evaluation.md` | 戦術知識                      |
| `docs/cpu-ai-algorithm.md`             | アルゴリズム知識              |
