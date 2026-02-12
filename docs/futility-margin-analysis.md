# Futility Pruning マージン分析

## 概要

Futility Pruning は、浅い探索深度で「明らかに有望でない手」をスキップする枝刈り技法。各深度のマージン値が探索精度と速度のトレードオフを決定する。

本ドキュメントは、実測データに基づいてマージン値を検証・改善するための調査記録。

## Futility Pruning の仕組み

```typescript
// minimax.ts の Futility Pruning 判定
if (depth >= 1 && depth <= 3 && /* 非戦術手 */) {
  const margin = FUTILITY_MARGINS[depth];
  const staticEval = evaluatePosition(board, move, color);

  // Maximizing: staticEval + margin <= alpha → skip
  // Minimizing: staticEval - margin >= beta → skip
}
```

- **margin が大きい** → スキップ条件を満たしにくい → 探索が多い → 遅いが正確
- **margin が小さい** → スキップ条件を満たしやすい → 探索が少ない → 速いが見落としリスク

margin は「残りの探索で静的評価からどれだけスコアが改善しうるか」の上限見積もり。

## depth と手番の関係

**重要**: depth（残り探索深度）は maxDepth に応じて自分/相手の手番が入れ替わる。

### maxDepth=4（hard）の場合

```
Root (depth=4): 自分（maximizing）  ← findBestMoveIterativeWithTT が処理
  └ depth=3: 相手（minimizing）
      └ depth=2: 自分（maximizing）
          └ depth=1: 相手（minimizing）
              └ depth=0: 葉ノード評価
```

| depth | 手番 | 残り探索 |
| ----- | ---- | -------- |
| 3     | 相手 | 2手+葉   |
| 2     | 自分 | 1手+葉   |
| 1     | 相手 | 葉のみ   |

### maxDepth=3（medium）の場合

```
Root (depth=3): 自分（maximizing）
  └ depth=2: 相手（minimizing）
      └ depth=1: 自分（maximizing）
          └ depth=0: 葉ノード評価
```

| depth | 手番 | 残り探索 |
| ----- | ---- | -------- |
| 2     | 相手 | 1手+葉   |
| 1     | 自分 | 葉のみ   |

**同じ depth でも maxDepth が変わると手番が逆転する。** これが depth のみに基づくマージン設定の問題点。

## 実測データ（2026-02-12）

### 計測条件

- hard vs hard 10局、Futility Pruning 無効、timeLimit=30s、ノード制限なし
- 計測スクリプト: `scripts/measure-futility-margins.ts`
- 対象: 非戦術手（四を作る手を除外）、勝ち/負け確定でないノード
- gain = max(0, 探索スコア - 静的評価)（改善方向のみ計測）
- 外れ値（gain >= 50000、VCF/FIVE 発見によるもの）を除外

### maxDepth=4（hard）での計測結果

外れ値（gain >= 50000、VCF/FIVE 発見）を除外した filtered データ:

| depth | 手番 | サンプル数 | 非ゼロ率 | P90 | P95  | P99  | Max   |
| ----- | ---- | ---------- | -------- | --- | ---- | ---- | ----- |
| 1     | 相手 | ~196k      | 42%      | 668 | 3797 | 5144 | 49941 |
| 2     | 自分 | ~155k      | 8%       | 0   | 67   | 303  | 9730  |
| 3     | 相手 | ~15k       | 36%      | 806 | 2857 | 4570 | 15703 |

### maxDepth=3（medium）での計測結果

| depth | 手番 | サンプル数 | 非ゼロ率 | P90 | P95  | P99  | Max   |
| ----- | ---- | ---------- | -------- | --- | ---- | ---- | ----- |
| 1     | 自分 | ~75k       | 21%      | 112 | 914  | 2185 | 12814 |
| 2     | 相手 | ~12k       | 17%      | 387 | 1085 | 1973 | 49682 |

### 手番別統合ビュー

**自分の手:**

| depth | maxDepth | サンプル数 | P90 | P95 | P99  |
| ----- | -------- | ---------- | --- | --- | ---- |
| 1     | 3        | ~75k       | 112 | 914 | 2185 |
| 2     | 4        | ~155k      | 0   | 67  | 303  |

**相手の手:**

| depth | maxDepth | サンプル数 | P90 | P95  | P99  |
| ----- | -------- | ---------- | --- | ---- | ---- |
| 1     | 4        | ~196k      | 668 | 3797 | 5144 |
| 2     | 3        | ~12k       | 387 | 1085 | 1973 |
| 3     | 4        | ~15k       | 806 | 2857 | 4570 |

### 発見

1. **自分の手の gain は一貫して小さい**
   - P95: 67-914、P99: 303-2185
   - 静的評価が正確で、探索してもスコアがほとんど変わらない
   - 自分の脅威（四、活三など）は静的評価で既に捉えられている

2. **相手の手の gain は一貫して大きい**
   - P95: 1085-3797、P99: 1973-5144
   - 相手の防御手・カウンター脅威は静的評価では見えず、探索で初めて判明する

3. **手番が同じなら depth/maxDepth が異なっても特性は一貫**
   - 「自分の手は gain が小さく、相手の手は gain が大きい」という傾向は depth に依存しない
   - これは `isMaximizing` に基づくマージン分離が有効であることを示す

4. **現行マージンとのギャップ**

| depth | 手番(d=4) | 現行マージン | P95  | P99  | 評価                             |
| ----- | --------- | ------------ | ---- | ---- | -------------------------------- |
| 1     | 相手      | 500          | 3797 | 5144 | 小さすぎる（P90=668 でギリギリ） |
| 2     | 自分      | 1500         | 67   | 303  | 大きすぎる（ほぼ発動しない）     |
| 3     | 相手      | 3000         | 2857 | 4570 | P95付近。2-3%の手を不正に刈る    |

## 黒勝率への影響

### 切り分けベンチマーク結果（hard vs hard 50局）

| 構成                                   | 黒勝率  | 平均思考時間 |
| -------------------------------------- | ------- | ------------ |
| ベースライン（Futility depth 2 まで）  | 58%     | 1743ms       |
| Phase 2a+2b（Futility depth 3、LMR=3） | 40%     | 745ms        |
| **2a 戻し**（Futility depth 2、LMR=3） | **54%** | ~560ms       |
| **2b 戻し**（Futility depth 3、LMR=4） | **48%** | ~735ms       |

- **Phase 2a（Futility depth 3）が黒勝率低下の主因**
- Depth 3 のマージン 3000 が相手の防御手を過剰に刈り、AI が相手の反撃を過小評価
- 結果として「通らない攻め」を選択し、黒が負けるパターンが増加

## 改善案

### 案: isMaximizing による手番別マージン

depth だけでなく `isMaximizing`（手番）も条件に加え、自分の手と相手の手で異なるマージンを適用する。

```typescript
// 現行: depth のみ
const FUTILITY_MARGINS = [0, 500, 1500, 3000];

// 改善案: 手番別（P95-P99 ベース）
const FUTILITY_MARGINS_SELF = [0, 900, 300, 900]; // 自分の手: 小さくてOK
const FUTILITY_MARGINS_OPPONENT = [0, 5000, 2000, 4500]; // 相手の手: 大きく必要
```

実測根拠:

| 手番 | depth | P95  | P99  | 提案マージン | 根拠               |
| ---- | ----- | ---- | ---- | ------------ | ------------------ |
| 自分 | 1     | 914  | 2185 | 900          | P95 ベース         |
| 自分 | 2     | 67   | 303  | 300          | P99 ベース         |
| 自分 | 3     | —    | —    | 900          | depth 1 の値を流用 |
| 相手 | 1     | 3797 | 5144 | 5000         | P95-P99 の間       |
| 相手 | 2     | 1085 | 1973 | 2000         | P99 ベース         |
| 相手 | 3     | 2857 | 4570 | 4500         | P95-P99 の間       |

### 未計測事項

- 黒番/白番での gain 分布の差異（禁手の影響で非対称の可能性）
- 手番別マージン適用後のベンチマークによる効果検証

## 計測ツール

### `scripts/measure-futility-margins.ts`

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --import ./scripts/register-loader.mjs scripts/measure-futility-margins.ts \
  [--games=N]
```

- `src/logic/cpu/search/futilityMeasurement.ts` のモジュールレベルコレクターを使用
- `minimax.ts` に計測ロジックを組み込み済み（`isMeasuringFutility()` で制御）
- Futility Pruning 無効・時間制限緩和で全手を探索し、staticEval と searchScore の差を記録
