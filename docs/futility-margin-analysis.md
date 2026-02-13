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

## 実測データ

### 初回計測（2026-02-12、FOUR=1000）

#### 計測条件

- hard vs hard 10局、Futility Pruning 無効、timeLimit=30s、ノード制限なし
- 計測スクリプト: `scripts/measure-futility-margins.ts`
- 対象: 非戦術手（四を作る手を除外）、勝ち/負け確定でないノード
- gain = max(0, 探索スコア - 静的評価)（改善方向のみ計測）
- 外れ値（gain >= 50000、VCF/FIVE 発見によるもの）を除外

#### maxDepth=4（hard）での計測結果

| depth | 手番 | サンプル数 | 非ゼロ率 | P90 | P95  | P99  | Max   |
| ----- | ---- | ---------- | -------- | --- | ---- | ---- | ----- |
| 1     | 相手 | ~196k      | 42%      | 668 | 3797 | 5144 | 49941 |
| 2     | 自分 | ~155k      | 8%       | 0   | 67   | 303  | 9730  |
| 3     | 相手 | ~15k       | 36%      | 806 | 2857 | 4570 | 15703 |

#### maxDepth=3（medium）での計測結果

| depth | 手番 | サンプル数 | 非ゼロ率 | P90 | P95  | P99  | Max   |
| ----- | ---- | ---------- | -------- | --- | ---- | ---- | ----- |
| 1     | 自分 | ~75k       | 21%      | 112 | 914  | 2185 | 12814 |
| 2     | 相手 | ~12k       | 17%      | 387 | 1085 | 1973 | 49682 |

#### 適用マージン（v1）

```typescript
FUTILITY_MARGINS_SELF = [0, 900, 300, 900]; // P95ベース
FUTILITY_MARGINS_OPPONENT = [0, 3500, 1200, 3000]; // P95付近
```

### 再計測（2026-02-13、FOUR=1500）

FOUR 1000→1500、CONNECTIVITY_BONUS 30、防御倍率分化 の変更後に再計測。

#### 計測条件

- hard vs hard / medium vs medium 各20局
- その他の条件は初回と同じ

#### maxDepth=4（hard）での計測結果

| depth | 手番 | サンプル数 | 非ゼロ率 | P90  | P95  | P99  | Max   |
| ----- | ---- | ---------- | -------- | ---- | ---- | ---- | ----- |
| 1     | 相手 | ~373k      | 42%      | 1702 | 4099 | 8387 | 19776 |
| 2     | 自分 | ~318k      | 9%       | 0    | 108  | 636  | 13718 |
| 3     | 相手 | ~27k       | 39%      | 1389 | 2899 | 5177 | 38885 |

#### maxDepth=3（medium）での計測結果

| depth | 手番 | サンプル数 | 非ゼロ率 | P90 | P95  | P99  | Max   |
| ----- | ---- | ---------- | -------- | --- | ---- | ---- | ----- |
| 1     | 自分 | ~104k      | 20%      | 154 | 987  | 2291 | 14957 |
| 2     | 相手 | ~18k       | 14%      | 477 | 1207 | 3077 | 11760 |

#### 手番別統合ビュー

**自分の手:**

| depth | maxDepth | サンプル数 | P90 | P95 | P99  |
| ----- | -------- | ---------- | --- | --- | ---- |
| 1     | 3        | ~104k      | 154 | 987 | 2291 |
| 2     | 4        | ~318k      | 0   | 108 | 636  |

**相手の手:**

| depth | maxDepth | サンプル数 | P90  | P95  | P99  |
| ----- | -------- | ---------- | ---- | ---- | ---- |
| 1     | 4        | ~373k      | 1702 | 4099 | 8387 |
| 2     | 3        | ~18k       | 477  | 1207 | 3077 |
| 3     | 4        | ~27k       | 1389 | 2899 | 5177 |

#### 適用マージン（v2）

```typescript
FUTILITY_MARGINS_SELF = [0, 1000, 200, 1000]; // P95ベース
FUTILITY_MARGINS_OPPONENT = [0, 4100, 1300, 3000]; // P95付近
```

| 手番 | depth | P95  | P99  | v1マージン | v2マージン | 根拠               |
| ---- | ----- | ---- | ---- | ---------- | ---------- | ------------------ |
| 自分 | 1     | 987  | 2291 | 900        | 1000       | P95ベース          |
| 自分 | 2     | 108  | 636  | 300        | 200        | P95-P99間          |
| 自分 | 3     | —    | —    | 900        | 1000       | depth 1 の値を流用 |
| 相手 | 1     | 4099 | 8387 | 3500       | 4100       | P95ベース          |
| 相手 | 2     | 1207 | 3077 | 1200       | 1300       | P95付近            |
| 相手 | 3     | 2899 | 5177 | 3000       | 3000       | P95付近（維持）    |

### 発見

1. **FOUR=1500 でもself/opponentの特性は一貫**
   - 自分: P95=108-987（小さい）、相手: P95=1207-4099（大きい）
   - スコアスケールが変わっても手番による非対称性は保存

2. **相手の手の gain がスケーリング**
   - depth 1: 3797→4099（+8%）、FOUR比率 50%増に対して穏やか
   - depth 3: 2857→2899（ほぼ変化なし）
   - FOUR 増加の影響は主に depth 1 の浅い探索で顕現

3. **自分の手の gain はほぼ不変**
   - depth 2: 67→108（微増）
   - 自分の脅威は静的評価で正確に捉えられる特性は維持

## 黒勝率への影響

### 切り分けベンチマーク結果（hard vs hard 50局、FOUR=1000時）

| 構成                                   | 黒勝率  | 平均思考時間 |
| -------------------------------------- | ------- | ------------ |
| ベースライン（Futility depth 2 まで）  | 58%     | 1743ms       |
| Phase 2a+2b（Futility depth 3、LMR=3） | 40%     | 745ms        |
| **2a 戻し**（Futility depth 2、LMR=3） | **54%** | ~560ms       |
| **2b 戻し**（Futility depth 3、LMR=4） | **48%** | ~735ms       |

- **Phase 2a（Futility depth 3）が黒勝率低下の主因**
- Depth 3 のマージン 3000 が相手の防御手を過剰に刈り、AI が相手の反撃を過小評価
- 結果として「通らない攻め」を選択し、黒が負けるパターンが増加

## 計測ツール

### `scripts/measure-futility-margins.ts`

```bash
node --experimental-strip-types --disable-warning=ExperimentalWarning \
  --import ./scripts/register-loader.mjs scripts/measure-futility-margins.ts \
  [--games=N] [--depth=N]
```

- `src/logic/cpu/search/futilityMeasurement.ts` のモジュールレベルコレクターを使用
- `minimax.ts` に計測ロジックを組み込み済み（`isMeasuringFutility()` で制御）
- Futility Pruning 無効・時間制限緩和で全手を探索し、staticEval と searchScore の差を記録
