# Phase 2: 評価関数統合 + 差分評価

> Phase 1 の LineTable を評価関数に統合し、`analyzeDirection` のboard走査をビットマスク参照に置き換える。
> 加えて、do/undo 連動の差分評価を導入し、全石ループを回避する。

## 期待される効果

- `analyzeDirection` の `board[r][c]` アクセスが `Uint16Array` のビット演算に置換 → 定数倍改善
- `analyzeJumpPatterns` の重複 `analyzeDirection` 排除 → 走査回数 24回/石 → 16回/石
- 差分評価により全石ループ回避 → O(石数) → O(1) per do/undo
- **総合見積もり**: `evaluateBoard` の CPU時間を 50-70% 削減（プロファイリングで検証）

## Step 2a: プリミティブ関数

> Phase 3a で使う `countLineBit`/`checkEndsBit` を先に切り出す。
> `analyzeLinePattern` はこれらの合成関数として実装する（SRP/DRY）。

### 新規ファイル

**`src/logic/cpu/lineTable/lineCounting.ts`**

Phase 2 で先に作成し、Phase 3a でも再利用するプリミティブ:

```typescript
/**
 * ビットマスク版 countLine
 * bitPos から両方向に連続する同色石の数を返す（起点含む）
 */
export function countLineBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): number;

/**
 * ビットマスク版 checkEnds
 * 連の両端の状態を返す
 */
export function checkEndsBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): { end1: EndState; end2: EndState };
```

**`src/logic/cpu/lineTable/linePatterns.ts`**

`analyzeDirection` のビットマスク版。`countLineBit` と `checkEndsBit` の合成:

```typescript
import { countLineBit, checkEndsBit } from "./lineCounting";

/**
 * analyzeDirection のビットマスク版
 * 既存の DirectionPattern 型と同一の出力を返す
 */
export function analyzeLinePattern(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): DirectionPattern {
  // countLineBit + checkEndsBit の合成
}
```

## Step 2b: アダプタ関数

> フォールバック分岐を消費者に散在させず、1箇所に集約する（LSP）。

### 新規ファイル

**`src/logic/cpu/lineTable/adapter.ts`**

```typescript
import { analyzeLinePattern } from "./linePatterns";
import { analyzeDirection } from "../evaluation/directionAnalysis";
import { CELL_LINES_FLAT } from "./lineMapping";

/**
 * 方向パターン取得のアダプタ
 * LineTable があればビット版、なければ従来版を使用
 * フォールバック判定はこの関数のみで行う
 */
export function getDirectionPattern(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: StoneColor,
  lineTable?: LineTable,
): DirectionPattern {
  if (lineTable) {
    const packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex];
    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    return analyzeLinePattern(
      lineTable.blacks,
      lineTable.whites,
      lineId,
      bitPos,
      color,
    );
  }
  const [dr, dc] = DIRECTIONS[dirIndex];
  return analyzeDirection(board, row, col, dr, dc, color);
}
```

各消費者はこのアダプタだけを呼び、`lineTable` の有無を意識しない。

## Step 2c: 評価関数への統合

### 変更ファイル

**`src/logic/cpu/search/context.ts`**

SearchContext に LineTable フィールドを追加。また、`evaluateBoard` が直接参照できるサブセット型を定義:

```typescript
/** evaluateBoard が受け取るコンテキストのサブセット */
export interface EvaluationContext {
  evaluationOptions?: LeafEvaluationOptions;
  lineTable?: LineTable;
}

export interface SearchContext extends EvaluationContext {
  tt: TranspositionTable;
  history: HistoryTable;
  killers: KillerMoves;
  stats: SearchStats;
  // ... 他の既存フィールド
}
```

**`src/logic/cpu/search/iterativeDeepening.ts`**

探索開始時に LineTable を構築:

```typescript
import { buildLineTable } from "../lineTable/lineTable";

// iterativeDeepening() 内、探索ループの前
ctx.lineTable = buildLineTable(board);
```

**`src/logic/cpu/search/minimaxCore.ts`**

do/undo フローに LineTable の差分更新を追加（L346-406 付近）:

```typescript
import { placeStone, removeStone } from "../lineTable/lineTable";

// do (applyMoveInPlace 直後)
if (ctx.lineTable) placeStone(ctx.lineTable, move.row, move.col, currentColor);

// undo (undoMove 直後)
if (ctx.lineTable) removeStone(ctx.lineTable, move.row, move.col, currentColor);
```

**`src/logic/cpu/evaluation/stonePatterns.ts`**

`evaluateStonePatternsWithBreakdown` でアダプタを使用:

```typescript
import { getDirectionPattern } from "../lineTable/adapter";

export function evaluateStonePatternsWithBreakdown(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  lineTable?: LineTable,
): StonePatternResult {
  for (let i = 0; i < DIRECTIONS.length; i++) {
    // アダプタ経由: lineTable の有無を意識しない
    const pattern = getDirectionPattern(board, row, col, i, color, lineTable);
    // ... スコア計算（変更なし）
  }
}
```

**`src/logic/cpu/evaluation/boardEvaluation.ts`**

`evaluateBoard` の引数を `EvaluationContext` サブセットで統一:

```typescript
export function evaluateBoard(
  board: BoardState,
  perspective: "black" | "white",
  evalCtx?: EvaluationContext,
): number {
  const options = evalCtx?.evaluationOptions;
  const lineTable = evalCtx?.lineTable;
  // ...
  const { score, breakdown, activeDirectionCount } =
    evaluateStonePatternsWithBreakdown(board, row, col, stone, lineTable);
  // ...
}
```

**`src/logic/cpu/evaluation/jumpPatterns.ts`**

`analyzeJumpPatterns` の重複 `analyzeDirection` 呼び出しを排除。

> この改善は LineTable に依存しないため、Phase 2 の最初に独立して実施可能。
> LineTable 統合前でも走査回数が 24回/石 → 16回/石 に削減される。

```typescript
export function analyzeJumpPatterns(
  board: BoardState, row: number, col: number, color: StoneColor,
  precomputed?: DirectionPattern[],  // 事前計算済みなら再計算不要
): JumpPatternResult {
  // ループ1: 飛び四検出
  const patterns: DirectionPattern[] = [];
  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const pattern = precomputed?.[i] ?? analyzeDirection(board, ...);
    patterns.push(pattern);
    // ... 飛び四判定
  }

  // ループ2: 連続三/飛び三検出（patterns を再利用）
  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const pattern = patterns[i]; // ← 再計算なし
    // ... 三判定
  }
}
```

## Step 2d: 差分評価（Incremental Evaluation）

> ビットマスクで `analyzeDirection` を速くしても全石ループが残る。
> do/undo と連動した差分スコア更新で全石ループを回避する。

### 設計

```typescript
/** SearchContext に追加 */
interface SearchContext {
  // ...
  evalScore?: number; // 現在の差分評価スコア
}
```

do/undo 時に、変更された石の周辺4方向のみ再評価:

```typescript
// do 時
const oldContrib = evaluateStoneContribution(board, move.row, move.col, ...);
applyMoveInPlace(board, move, currentColor);
placeStone(ctx.lineTable, move.row, move.col, currentColor);
const newContrib = evaluateStoneContribution(board, move.row, move.col, ...);
ctx.evalScore += (newContrib - oldContrib);

// undo 時: 逆操作
```

`evaluateStoneContribution` は置いた石自身 + 同ライン上の既存石への影響を計算する。全盤面をループするよりはるかに軽量（最大4方向×最大14マス = 56セル vs 225セル）。

### 注意

- 差分評価の正確性は `evaluateBoard` との完全一致テストで保証
- `scanFourThreeThreat`（全盤面スキャン）は差分化が困難。Phase 2 では従来通り全スキャンを維持

## Phase 2 完了基準

1. 全テストパス
2. LineTable ありなしで `evaluateBoard` の出力が完全一致
3. プロファイリング再計測で効果を確認
4. **フォールバック削除**: `evaluateBoard` 系の `lineTable` を必須引数に変更し、旧パスを削除

## テスト

### `src/logic/cpu/lineTable/lineCounting.test.ts`

| テストケース     | 内容                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| countLineBit一致 | ランダム盤面で `countLine` vs `countLineBit` の出力を全石×4方向で比較 |
| checkEndsBit一致 | 同上                                                                  |

### `src/logic/cpu/lineTable/linePatterns.test.ts`

| テストケース     | 内容                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| ランダム盤面一致 | 数百のランダム盤面で `analyzeDirection` vs `analyzeLinePattern` の出力を全石×4方向で比較 → 完全一致 |
| 盤端             | (0,0), (14,14) 等での端状態判定                                                                     |
| 五連・長連       | 五連/六連がある盤面での正しいカウント                                                               |
| 空盤             | 石がない位置での判定                                                                                |

### 評価関数一致テスト（既存テストの拡張）

| テストケース      | 内容                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| evaluateBoard一致 | `evaluateBoard(board, ...)` と LineTable版の出力が完全一致                    |
| do/undo一貫性     | do → evaluate → undo → evaluate の前後で同一スコア、かつ LineTable 状態が復元 |
| jumpPatterns一致  | `analyzeJumpPatterns` が precomputed ありなしで同一結果                       |
| 差分評価一致      | 差分評価スコアと全計算スコアが全ケースで一致                                  |

## 検証

```bash
pnpm vitest run src/logic/cpu/lineTable/ src/logic/cpu/evaluation/ src/logic/cpu/search/
```
