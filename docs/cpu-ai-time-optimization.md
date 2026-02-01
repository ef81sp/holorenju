# CPU AI 思考時間短縮計画

このドキュメントでは、CPU AIの思考時間を短縮するための最適化手法を整理します。

## 実装状況

| 手法               | ステータス | 実装場所               |
| ------------------ | ---------- | ---------------------- |
| 動的時間配分       | ✅ 実装済  | `minimax.ts`           |
| LMR                | ✅ 実装済  | `minimaxWithTT()`      |
| Aspiration Windows | ✅ 実装済  | `findBestMoveWithTT()` |
| Futility Pruning   | 🔲 未実装  | -                      |
| Null Move Pruning  | 🔲 未実装  | -                      |

## 現状分析

### 現在の実装

`src/logic/cpuAI/minimax.ts` で Iterative Deepening + Alpha-Beta剪定 + Transposition Table + LMR + Aspiration Windows を実装済み。

| 難易度   | 探索深度 | 時間制限 | 実測値（目安） |
| -------- | -------- | -------- | -------------- |
| beginner | 2        | 1000ms   | 〜100ms        |
| easy     | 3        | 2000ms   | 〜500ms        |
| medium   | 4        | 3000ms   | 〜2000ms       |
| hard     | 5        | 5000ms   | 〜5000ms       |

### 課題

- **hard難易度**: 時間制限ギリギリまで使うことが多く、ユーザー体験を損なう
- **探索深度の限界**: 時間内に深度5を完了できないケースがある
- **計算リソース**: ブラウザのメインスレッドをブロックしないよう配慮が必要

## 最適化手法

### 1. Late Move Reductions (LMR)

**概要**: Move Orderingで後半に来る手は「悪い手」である可能性が高いため、探索深度を1〜2浅くする。

**原理**:

- Alpha-Beta探索では、最初の数手で良いalphaを確立すれば後続の手は剪定される
- 後半の手が良い手であれば、浅い探索でも高い評価が出て再探索される（fail-high）

**実装案**:

```typescript
// moveIndex が一定以上で、depth が一定以上の場合に適用
if (moveIndex >= LMR_THRESHOLD && depth >= LMR_MIN_DEPTH) {
  // 浅い探索
  score = minimaxWithTT(..., depth - 1 - LMR_REDUCTION, ...);

  // fail-high なら再探索
  if (score > alpha) {
    score = minimaxWithTT(..., depth - 1, ...);
  }
}
```

**パラメータ案**:

- `LMR_THRESHOLD`: 4（5手目以降に適用）
- `LMR_MIN_DEPTH`: 3（深度3以上で適用）
- `LMR_REDUCTION`: 1（探索深度を1浅くする）

**期待効果**: 探索ノード数 20〜40% 削減

### 2. Futility Pruning

**概要**: 静的評価が alpha を大幅に下回る局面では、その局面を探索しても無駄（futile）なのでスキップする。

**原理**:

- 残り深度が浅い（1〜2）場合、評価が大きく変動することは少ない
- 現在の静的評価 + マージン < alpha なら、探索しても alpha を超える可能性は低い

**実装案**:

```typescript
if (depth <= FUTILITY_DEPTH && !isInCheck) {
  const staticEval = evaluateBoard(board, perspective);
  const margin = FUTILITY_MARGIN[depth];

  if (staticEval + margin <= alpha) {
    return alpha; // 剪定
  }
}
```

**パラメータ案**:

- `FUTILITY_DEPTH`: 2
- `FUTILITY_MARGIN`: { 1: 200, 2: 500 }

**期待効果**: 末端ノード 10〜20% 削減

### 3. Aspiration Windows

**概要**: 前回の探索結果をもとに、alpha-beta の初期ウィンドウを狭める。

**原理**:

- Iterative Deepening では、前の深度の結果が次の深度のヒントになる
- 狭いウィンドウでの探索は剪定が発生しやすく高速
- ウィンドウ外の結果が出たら再探索（fail-low/fail-high）

**実装案**:

```typescript
let alpha = previousScore - ASPIRATION_WINDOW;
let beta = previousScore + ASPIRATION_WINDOW;

let score = minimaxWithTT(..., alpha, beta, ...);

// ウィンドウ外なら再探索
if (score <= alpha || score >= beta) {
  score = minimaxWithTT(..., -INFINITY, INFINITY, ...);
}
```

**パラメータ案**:

- `ASPIRATION_WINDOW`: 50（パターンスコア基準）

**期待効果**: 探索ノード数 10〜15% 削減（ウィンドウ内に収まる場合）

### 4. 動的時間配分

**概要**: 局面に応じて思考時間を調整する。

**ルール案**:
| 状況 | 時間配分 |
| ---- | -------- |
| 序盤（〜6手） | 基本時間 ×0.5 |
| 唯一の候補手 | 即座に返す |
| 緊急手（四対応等） | 基本時間 ×0.3 |
| 複雑な局面 | 基本時間 ×1.2 |

**実装案**:

```typescript
function calculateTimeLimit(baseTime: number, context: GameContext): number {
  if (context.forcedMove) return 0;
  if (context.moveCount <= 6) return baseTime * 0.5;
  if (context.isUrgent) return baseTime * 0.3;
  if (context.isComplex) return baseTime * 1.2;
  return baseTime;
}
```

**期待効果**: 平均思考時間 30〜50% 削減

### 5. Null Move Pruning（将来検討）

**概要**: 自分がパスしても有利なら、その枝を深く探索する必要はない。

**注意**: 連珠では効果が限定的（zugzwangが少ないため適用可能だが、恩恵は小さい）

## 実装優先度

| 優先度 | 手法               | 実装難易度 | 期待効果 | ステータス |
| ------ | ------------------ | ---------- | -------- | ---------- |
| 1      | 動的時間配分       | 低         | 高       | ✅ 完了    |
| 2      | LMR                | 中         | 高       | ✅ 完了    |
| 3      | Aspiration Windows | 中         | 中       | ✅ 完了    |
| 4      | Futility Pruning   | 中         | 中       | 🔲 未実装  |
| 5      | Null Move Pruning  | 高         | 低       | 🔲 未実装  |

## 実装ステップ

### Phase 1: 動的時間配分

1. `GameContext` インターフェースを定義
2. `calculateTimeLimit()` 関数を実装
3. `findBestMoveIterativeWithTT()` で時間配分を適用
4. ユニットテストを追加

### Phase 2: LMR

1. `LMRParams` を `types/cpu.ts` に追加
2. `minimaxWithTT()` に LMR ロジックを追加
3. 再探索ロジックを実装
4. パフォーマンス測定

### Phase 3: Aspiration Windows

1. `findBestMoveIterativeWithTT()` に Aspiration Windows を追加
2. fail-low/fail-high 時の再探索ロジック
3. パラメータチューニング

### Phase 4: Futility Pruning

1. `minimaxWithTT()` の末端ノード処理に Futility Pruning を追加
2. マージンパラメータの調整

## 効果測定方法

### ベンチマークスクリプト

```bash
pnpm bench:ai --mode=time
```

**出力項目**:

- 平均思考時間（ms）
- 探索ノード数
- 到達深度
- TTヒット率
- Beta剪定率

### テスト局面セット

以下の局面カテゴリで測定:

1. **序盤**: 標準的な珠型後の局面
2. **中盤**: 複数の脅威がある複雑な局面
3. **終盤**: 詰みを読む必要がある局面

### 目標値

| 難易度 | 現在     | 目標     |
| ------ | -------- | -------- |
| hard   | 〜5000ms | 〜2000ms |
| medium | 〜2000ms | 〜1000ms |

## 参考資料

- [Iterative Deepening - Chessprogramming wiki](https://www.chessprogramming.org/Iterative_Deepening)
- [Late Move Reductions - Chessprogramming wiki](https://www.chessprogramming.org/Late_Move_Reductions)
- [Aspiration Windows - Chessprogramming wiki](https://www.chessprogramming.org/Aspiration_Windows)
- [Futility Pruning - Chessprogramming wiki](https://www.chessprogramming.org/Futility_Pruning)
- [Alpha-Beta Pruning - Wikipedia](https://en.wikipedia.org/wiki/Alpha%E2%80%93beta_pruning)

## 関連ファイル

| ファイル                     | 変更内容                         |
| ---------------------------- | -------------------------------- |
| `src/logic/cpuAI/minimax.ts` | LMR, Futility, Aspiration の実装 |
| `src/types/cpu.ts`           | パラメータ定義                   |
| `scripts/bench-ai.ts`        | ベンチマークスクリプト（新規）   |
