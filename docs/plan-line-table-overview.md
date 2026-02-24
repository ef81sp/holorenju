# ビットボード方式ラインテーブル導入 — 概要

## 背景

現在、盤面のパターン判定（連続石数・端状態・飛びパターン）は毎回 `board[r][c]` を走査して計算している。同じライン情報を複数の消費者（評価関数、禁手判定、VCF/VCT探索）が独立に再計算しており非効率。

### 最大のボトルネック

`evaluateStonePatternsWithBreakdown` が1石あたり `analyzeDirection` を12回（本体4回 + `analyzeJumpPatterns`内8回）呼び、各回で `countInDirection` を2回実行。

- 1石あたり 24回の board 走査
- 20石盤面で毎回 ~480回の走査
- 探索1手ごとに数千〜数万回の `evaluateBoard` 呼び出し

**注意**: 上記は静的分析に基づく見積もり。Phase 0 でプロファイリングによる定量的検証を行う。

## 解決方針

15×15盤面の72本のライン（横15 + 縦15 + 斜め↘21 + 斜め↗21）を `uint16` のビットマスクで管理し、石の配置/除去時に O(1)×4 で差分更新する。消費者はビットマスクからパターンを抽出する。

```
lineId 番号体系:
  0~14  : 横（row 0~14）
  15~29 : 縦（col 0~14）
  30~50 : 斜め↘（row-col = -10..+10 の21本、長さ5~15）
  51~71 : 斜め↗（row+col = 4..24 の21本、長さ5~15）
```

## フェーズ構成

| Phase       | 内容                    | 影響範囲                                       | 詳細                                                     |
| ----------- | ----------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| **Phase 0** | プロファイリング        | なし（計測のみ）                               | 本ファイル下部                                           |
| **Phase 1** | LineTable 基盤          | 新規モジュールのみ（既存変更なし）             | [plan-line-table-phase1.md](./plan-line-table-phase1.md) |
| **Phase 2** | 評価関数統合 + 差分評価 | `evaluation/`, `search/context`, `minimaxCore` | [plan-line-table-phase2.md](./plan-line-table-phase2.md) |
| **Phase 3** | 他の消費者への展開      | `lineAnalysis`, VCF/VCT, 禁手判定(CPU専用)     | [plan-line-table-phase3.md](./plan-line-table-phase3.md) |

## 設計原則

- **SoA レイアウト**: `Uint16Array` ベースの Structure of Arrays でキャッシュ効率を確保（後から変更しにくいため Phase 1 で確定）
- **ライン長は静的テーブル**: 盤面サイズ15×15は固定。各ラインの長さは `lineMapping.ts` の `LINE_LENGTHS` 定数で管理
- **アダプタによるフォールバック集約**: ビット版/従来版の分岐は消費者に散在させず、`lineTable/adapter.ts` のアダプタ関数1箇所に集約（LSP）
- **フォールバックは移行期のみ**: 各Phase完了時に旧パスを削除し、最終的に `lineTable` は `SearchContext` の必須フィールドとする
- **renjuRules は変更しない**: UI側からも使われるため。CPU専用のビットマスク版は `lineTable/` に配置
- **JS のビット演算は32bit int**: 15ビットマスクは問題なし。`|`, `&`, `~`, `<<` を使用
- **ESLint `no-bitwise`**: `zobrist.ts` と同様に `eslint-disable` で個別無効化
- **インクリメンタル更新**: 探索の do/undo と同期し、Zobristハッシュと同じパターンで差分更新

## Phase 0: プロファイリング

実装に着手する前に、ボトルネックが本当に board 走査にあることを定量的に確認する。

### 計測手順

1. 代表的な盤面（序盤10石、中盤20石、終盤30石）を用意
2. Iterative Deepening を depth 4-6 で走らせる
3. `performance.now()` で関数別のCPU時間占有率を計測

### 計測対象

| 関数                                    | 計測項目                                   |
| --------------------------------------- | ------------------------------------------ |
| `evaluateBoard`                         | 呼び出し回数、総CPU時間、1回あたり平均時間 |
| `analyzeDirection` / `countInDirection` | 呼び出し回数                               |
| `findFourMoves`                         | 呼び出し回数、総CPU時間                    |
| `findThreatMoves`                       | 呼び出し回数、総CPU時間                    |
| `checkForbiddenMove`                    | 呼び出し回数、総CPU時間                    |
| Zobrist BigInt XOR                      | CPU時間占有率（別ボトルネックの可能性）    |
| TT ヒット率                             | evaluateBoard 呼び出し削減効果の参考       |

### 判断基準

- `evaluateBoard` + board走査系がCPU時間の30%以上を占める → Phase 1 以降に進む
- 占有率が低い場合 → 別のボトルネック（BigInt Zobrist等）を先に対処

### 計測結果（2026-02-24）

テストファイル: `src/logic/cpu/profiling/phase0-profiling.test.ts`

#### 探索統計

| 指標               | 序盤 (6手) | 中盤 (16手) |
| ------------------ | ---------- | ----------- |
| 探索総時間         | 1,501ms    | 3,009ms     |
| 完了深度           | 3          | 4           |
| 探索ノード         | 11,313     | 21,406      |
| evaluateBoard 呼出 | 7,456      | 12,568      |
| 評価/ノード比      | 65.9%      | 58.7%       |
| TTヒット率         | 12.6%      | 25.1%       |
| 禁手判定呼出       | 9,765      | 35,750      |
| 脅威検出呼出       | 519        | 773         |

#### evaluateBoard マイクロベンチマーク

| 指標      | 序盤 (6手) | 中盤 (16手) | 終盤 (26手) |
| --------- | ---------- | ----------- | ----------- |
| 1回あたり | 0.020ms    | 0.169ms     | 0.244ms     |
| 1秒あたり | 50,563回   | 5,929回     | 4,092回     |

#### 時間占有率推定（中盤 16手）

| 項目                         | 値        |
| ---------------------------- | --------- |
| 探索総時間                   | 3,009ms   |
| evaluateBoard 推定時間       | 2,164ms   |
| **evaluateBoard 推定占有率** | **71.9%** |
| 残り（探索オーバーヘッド等） | 28.1%     |

### 判断

**evaluateBoard が探索時間の 72% を占めており、30% の閾値を大幅に超過。Phase 1 以降に進む。**

中盤では石数増加に伴い `evaluateBoard` の単体コストが 0.169ms と序盤の8倍に膨張。
また `evaluatePosition` は 0.010ms/回と `evaluateBoard` の 1/17 であり、差分評価（Phase 2d）への転換効果が大きいと推定される。

## 消費者と走査頻度

| 消費者     | 主要関数                              | 走査パターン                | 頻度                       |
| ---------- | ------------------------------------- | --------------------------- | -------------------------- |
| 評価関数   | `evaluateStonePatternsWithBreakdown`  | 1石×12回 `analyzeDirection` | 超高頻度（毎末端ノード）   |
| VCF探索    | `findFourMoves`, `findWinningMove`    | 全盤面スキャン              | 超高頻度（毎VCFノード）    |
| VCT探索    | `findThreatMoves`, `hasOpenThree`     | 全盤面スキャン              | 高頻度（毎VCTノード）      |
| 禁手判定   | `checkDoubleThree`, `checkDoubleFour` | 4方向パターン判定           | 中頻度（黒番のみ）         |
| ライン解析 | `countLine`, `checkEnds`              | 両方向ステップ走査          | 極高頻度（全消費者の基盤） |

## 検証コマンド

```bash
# Phase 1
pnpm vitest run src/logic/cpu/lineTable/

# Phase 2
pnpm vitest run src/logic/cpu/lineTable/ src/logic/cpu/evaluation/ src/logic/cpu/search/

# Phase 3
pnpm vitest run src/logic/cpu/

# 全体
pnpm check-fix
```
