# Phase 3: 他の消費者への展開

> LineTable を評価関数以外の消費者（ライン解析、VCF/VCT探索、禁手判定）に展開する。
> UI層の `renjuRules/` は変更せず、CPU専用のビットマスク版を `lineTable/` に配置する。
> アダプタパターン（Phase 2 で導入済み）を拡張し、フォールバック分岐を集約する。

## Phase 3a: VCF/VCT のライン解析置き換え

### 対象

`src/logic/cpu/core/lineAnalysis.ts` の3関数を、Phase 2 で作成済みの `lineCounting.ts` のプリミティブで置き換え:

| 関数          | 走査パターン       | 呼び出し頻度 | 対応するビット版                     |
| ------------- | ------------------ | ------------ | ------------------------------------ |
| `countLine`   | 両方向ステップ走査 | 極高頻度     | `countLineBit`（Phase 2 で作成済み） |
| `checkEnds`   | 端点検出（両方向） | 高頻度       | `checkEndsBit`（Phase 2 で作成済み） |
| `getLineEnds` | 端点位置の取得     | 中頻度       | `getLineEndsBit`（新規追加）         |

### 新規追加（lineCounting.ts に追加）

```typescript
/**
 * ビットマスク版 getLineEnds
 * 連の端にある空き位置をビット位置で返す（座標変換は呼び出し元で行う）
 */
export function getLineEndsBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): { end1Pos: number | null; end2Pos: number | null };
```

### アダプタ拡張（adapter.ts に追加）

```typescript
export function getLineCount(..., lineTable?: LineTable): number {
  if (lineTable) return countLineBit(...);
  return countLine(...);
}

export function getLineEndState(..., lineTable?: LineTable): { end1Open; end2Open } {
  if (lineTable) return checkEndsBit(...);
  return checkEnds(...);
}
```

### 変更ファイル

**`src/logic/cpu/search/threatPatterns.ts`**

- `createsFour` 内の `countLine` → アダプタ経由
- `getFourDefensePosition` 内の `getLineEnds` → アダプタ経由 + 座標逆変換
- `checkDefenseCounterThreat` 内の `countLine` + `checkEnds` → アダプタ経由

**`src/logic/cpu/search/vctHelpers.ts`**

- `hasOpenThree` 内の `countLine` → アダプタ経由
- `findThreatMoves` 内の `classifyThreat` → アダプタ経由
- `getThreatDefensePositions` 内の `getLineEnds` → アダプタ経由

### テスト

`src/logic/cpu/lineTable/lineCounting.test.ts`（Phase 2 のテストを拡張）:

| テストケース    | 内容                                   |
| --------------- | -------------------------------------- |
| getLineEnds一致 | 端点位置の座標逆変換が正しいことを確認 |
| 盤端            | 短いラインでの正しい境界判定           |

### Phase 3a 完了基準

1. 全テストパス
2. **フォールバック削除**: `countLine`/`checkEnds`/`getLineEnds` を直接呼んでいるCPU側コードをすべてアダプタ経由に変更し、旧パスを削除

## Phase 3b: 五連・長連判定のビット版

### 対象

`src/logic/renjuRules/core.ts` の関数（UI側からも使われるため、CPU専用版を別途作成）:

| 関数                                | 走査パターン                         | ビット化難度 |
| ----------------------------------- | ------------------------------------ | ------------ |
| `checkFive(board, row, col, color)` | 4方向ペア走査（8回の `countStones`） | 低           |
| `checkOverline(board, row, col)`    | 同上                                 | 低           |

### 新規ファイル

**`src/logic/cpu/lineTable/lineChecks.ts`**

```typescript
/**
 * ビットマスク版 checkFive
 * 指定位置に石を置いたとき五連ができるかを判定
 *
 * 注意: 探索中は placeStone 済みの状態で呼ぶケースと、
 * 仮置き判定で呼ぶケースがある。placeStone 済みなら
 * ビットが既に立っているため仮ビット不要。
 */
export function checkFiveBit(
  lineTable: LineTable,
  row: number,
  col: number,
  color: "black" | "white",
): boolean;

/**
 * ビットマスク版 checkOverline
 */
export function checkOverlineBit(
  lineTable: LineTable,
  row: number,
  col: number,
): boolean;
```

#### アルゴリズム

```typescript
function checkFiveBit(
  lineTable: LineTable,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (let dirIndex = 0; dirIndex < 4; dirIndex++) {
    const packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex];
    if (packed === 0xffff) continue; // このセルにはこの方向のラインがない
    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    const mask =
      (color === "black"
        ? lineTable.blacks[lineId]
        : lineTable.whites[lineId]) |
      (1 << bitPos); // 仮ビット（未配置の場合に対応）
    const count = countConsecutiveBits(mask, bitPos, LINE_LENGTHS[lineId]);
    if (count === 5) return true;
  }
  return false;
}
```

### アダプタ拡張（adapter.ts に追加）

```typescript
export function isFive(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  lineTable?: LineTable,
): boolean {
  if (lineTable) return checkFiveBit(lineTable, row, col, color);
  return checkFive(board, row, col, color);
}
```

### 変更ファイル

**`src/logic/cpu/search/threatPatterns.ts`**

- `findWinningMove`/`findFourMoves` 内の `checkFive` → アダプタ経由

### テスト

`src/logic/cpu/lineTable/lineChecks.test.ts`:

| テストケース      | 内容                                                            |
| ----------------- | --------------------------------------------------------------- |
| checkFive一致     | ランダム盤面で `checkFive` vs `checkFiveBit` が全空きセルで一致 |
| checkOverline一致 | 同上                                                            |
| 仮置きの独立性    | `checkFiveBit` 呼び出し後に LineTable が変更されていないこと    |

### Phase 3b 完了基準

1. 全テストパス
2. **フォールバック削除**: CPU側の `checkFive`/`checkOverline` 呼び出しをすべてアダプタ経由に変更し、旧パスを削除

## Phase 3c: 飛びパターン判定のビット版（オプショナル）

> **ROI注意**: 飛びパターンは連続パターンによる早期リターン後に到達するケースが限定的。
> 難度が高い割に効果は Phase 3d より小さい。Phase 3d を先に実装し、
> プロファイリングで飛びパターンがボトルネックと判明した場合のみ着手する。

### 対象

`src/logic/renjuRules/patterns.ts` の飛びパターン判定:

| 関数                                                 | 走査パターン                     | ビット化難度 |
| ---------------------------------------------------- | -------------------------------- | ------------ |
| `checkJumpFour(board, row, col, dirIndex, color)`    | 11マス直線走査 + 3パターンマッチ | 高           |
| `checkJumpThree(board, row, col, dirIndex, color)`   | 11マス直線走査 + 2パターンマッチ | 高           |
| `checkOpenPattern(board, row, col, dirIndex, color)` | 仮置き + 両方向走査              | 中           |

### 新規ファイル

**`src/logic/cpu/lineTable/lineJumpPatterns.ts`**

```typescript
export function checkJumpFourBit(
  lineTable: LineTable,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): boolean;

export function checkJumpThreeBit(
  lineTable: LineTable,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): boolean;
```

#### アルゴリズム: パターンマスク方式

飛びパターンを事前定義したビットマスクで判定する。
起点 `bitPos` を含む窓をライン上にスライドし、`(colorMask & patternMask) === patternValue` かつ `(opponentMask & emptyBits) === 0` で判定。

```
飛び四パターン（起点=●のいずれか）:
  ●●●_● : 4ビット連続 + 1ビット空き + 1ビット
  ●●_●● : 2ビット連続 + 1ビット空き + 2ビット連続
  ●_●●● : 1ビット + 1ビット空き + 3ビット連続

飛び三パターン（両端が空き）:
  _●●_●_ : 空き + 2ビット + 空き + 1ビット + 空き
  _●_●●_ : 空き + 1ビット + 空き + 2ビット + 空き
```

```typescript
const JUMP_FOUR_PATTERNS: Array<{
  mask: number; // チェックするビット範囲
  value: number; // 期待する同色ビットパターン
  emptyBits: number; // 空きであるべきビット（相手石不可）
  windowSize: number;
  offsets: number[]; // 起点がパターン内にある場合のオフセット
}> = [
  // ●●●_● (窓幅5)
  {
    mask: 0b11111,
    value: 0b10111,
    emptyBits: 0b01000,
    windowSize: 5,
    offsets: [0, 1, 2, 4],
  },
  // ●●_●● (窓幅5)
  {
    mask: 0b11111,
    value: 0b11011,
    emptyBits: 0b00100,
    windowSize: 5,
    offsets: [0, 1, 3, 4],
  },
  // ●_●●● (窓幅5)
  {
    mask: 0b11111,
    value: 0b11101,
    emptyBits: 0b00010,
    windowSize: 5,
    offsets: [0, 2, 3, 4],
  },
];
```

### テスト

`src/logic/cpu/lineTable/lineJumpPatterns.test.ts`:

| テストケース       | 内容                                                                                |
| ------------------ | ----------------------------------------------------------------------------------- |
| checkJumpFour一致  | ランダム盤面で全空きセル×4方向について `checkJumpFour` vs `checkJumpFourBit` が一致 |
| checkJumpThree一致 | 同上                                                                                |
| パターン網羅       | 各飛びパターンの個別検証                                                            |
| 相手石ブロック     | 飛びの空き位置に相手石がある場合に false                                            |
| 盤端               | ラインの端で窓がはみ出る場合の境界処理                                              |

## Phase 3d: VCF/VCT探索の全盤面スキャン最適化

### 対象

全盤面をスキャンして脅威手を列挙する関数群:

| 関数                    | ファイル          | 走査パターン                     | 頻度                    |
| ----------------------- | ----------------- | -------------------------------- | ----------------------- |
| `findFourMoves`         | threatPatterns.ts | 全盤面 + checkFive + createsFour | 超高頻度（VCF毎ノード） |
| `findWinningMove`       | threatPatterns.ts | 全盤面 + checkFive               | 超高頻度                |
| `findThreatMoves`       | vctHelpers.ts     | 全盤面 + classifyThreat          | 高頻度（VCT毎ノード）   |
| `hasFourThreeAvailable` | vctHelpers.ts     | 全盤面 + createsFourThree        | 中頻度                  |

### 最適化方針

Phase 3a/3b で個別関数をビット版に置き換えた時点で、これらは自動的に高速化される。

追加の最適化として、LineTable からの候補プレフィルタを導入する。

### 新規ファイル

**`src/logic/cpu/lineTable/lineCandidates.ts`**

```typescript
/**
 * 指定色の四候補をビットマスクから高速列挙
 * 連続四と飛び四の両方の候補を返す（false negative なし）
 */
export function findFourCandidatesBit(
  lineTable: LineTable,
  color: "black" | "white",
): Position[];
```

#### アルゴリズム

```typescript
function findFourCandidatesBit(
  lineTable: LineTable,
  color: "black" | "white",
): Position[] {
  const candidates = new Set<number>(); // row * 15 + col で重複排除

  for (let lineId = 0; lineId < 72; lineId++) {
    const colorMask =
      color === "black" ? lineTable.blacks[lineId] : lineTable.whites[lineId];
    const opponentMask =
      color === "black" ? lineTable.whites[lineId] : lineTable.blacks[lineId];
    const lineLen = LINE_LENGTHS[lineId];
    const validMask = (1 << lineLen) - 1;
    const emptyMask = ~(colorMask | opponentMask) & validMask;

    // === 連続四候補: 連続3石の両端の空き ===
    const three = colorMask & (colorMask << 1) & (colorMask << 2);
    if (three) {
      const straightFourCands = ((three << 3) | (three >> 1)) & emptyMask;
      extractBits(straightFourCands, lineId, candidates);
    }

    // === 飛び四候補: XXX_X, X_XXX, XX_XX パターンの空き位置 ===
    const twoConsec = colorMask & (colorMask << 1);
    if (twoConsec) {
      // XXX_X: 連続3石 + 空き + 1石 → 空き位置(pos i+3)が四の候補
      const jumpA = three & (colorMask << 4); // bit i: pos i,i+1,i+2 が石, pos i+4 が石
      if (jumpA) {
        extractBits((jumpA << 3) & emptyMask, lineId, candidates);
      }
      // X_XXX: 1石 + 空き + 連続3石 → 空き位置(pos i+1)が四の候補
      const jumpB = colorMask & (three << 2); // bit i: pos i が石, pos i+2,i+3,i+4 が石
      if (jumpB) {
        extractBits((jumpB << 1) & emptyMask, lineId, candidates);
      }
      // XX_XX: 連続2石 + 空き + 連続2石 → 空き位置(pos i+2)が四の候補
      const jumpC = twoConsec & (twoConsec << 3); // bit i: pos i,i+1 が石, pos i+3,i+4 が石
      if (jumpC) {
        extractBits((jumpC << 2) & emptyMask, lineId, candidates);
      }
    }
  }

  return Array.from(candidates).map((key) => ({
    row: Math.floor(key / 15),
    col: key % 15,
  }));
}

/** ビットマスクから座標に変換して Set に追加 */
function extractBits(bits: number, lineId: number, out: Set<number>): void {
  while (bits) {
    const bitPos = 31 - Math.clz32(bits & -bits); // CTZ via CLZ
    out.add(bitPosToIndex(lineId, bitPos)); // → row * 15 + col
    bits &= bits - 1; // 最下位ビットを消す
  }
}
```

> **注**: `Math.clz32` を使用（V8 で intrinsic にコンパイルされ `Math.log2` より高速）。

### `isNearExistingStone` のビット化（オプション）

`findFourMoves` 等で使われる隣接石チェックもビットマスクで高速化可能:

```typescript
// 各ラインの occupied ビットから隣接マスクを生成
const occupied = lineTable.blacks[lineId] | lineTable.whites[lineId];
const adjacent = ((occupied << 1) | (occupied >> 1)) & ~occupied & validMask;
```

4方向の OR で全盤面の「石の隣接セル」ビットマップを O(72) で生成できる。

### 変更ファイル

**`src/logic/cpu/search/threatPatterns.ts`**

`findFourMoves` に候補プレフィルタを導入:

```typescript
export function findFourMoves(
  board: BoardState,
  color: "black" | "white",
  lineTable?: LineTable,
): Position[] {
  if (lineTable) {
    const candidates = findFourCandidatesBit(lineTable, color);
    return candidates.filter(
      (pos) =>
        !isFive(board, pos.row, pos.col, color, lineTable) &&
        createsFour(board, pos.row, pos.col, color, lineTable),
    );
  }
  // 従来方式にフォールバック
  // ...
}
```

### テスト

| テストケース           | 内容                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| findFourMoves一致      | ランダム盤面で従来版とビット版の出力が一致（集合として比較）                      |
| findWinningMove一致    | 同上                                                                              |
| findThreatMoves一致    | 同上                                                                              |
| 候補プレフィルタ健全性 | `findFourCandidatesBit` の出力が従来版の結果を包含すること（false negative なし） |
| 飛び四候補の網羅       | XXX_X, X_XXX, XX_XX パターンの候補が正しく列挙されること                          |

### Phase 3d 完了基準

1. 全テストパス
2. **フォールバック削除**: `findFourMoves` 等の旧パスを削除し、`lineTable` を必須に

## 注意事項

### UI層との互換性

- `checkFive`, `checkForbiddenMove` 等は UI側（`CpuGamePlayer.vue`）から直接参照される
- これらの関数のシグネチャや戻り値型は一切変更しない
- CPU専用のビット版は `lineTable/` に別関数として配置

### 座標変換コスト

- `getLineEndsBit` 等でビット位置→座標に変換する必要がある
- ホットパス（VCF毎ノード）では座標変換を最小化する設計とする
- 可能な場合はビットマスクのまま処理を継続し、最終結果のみ座標に変換

### 段階的導入の順序

```
Phase 3a (ライン解析置き換え)
  ↓ countLineBit/checkEndsBit は Phase 2 で作成済み
Phase 3b (五連・長連)
  ↓ checkFiveBit が完成
Phase 3d (全盤面スキャン最適化)  ← 3c より先に実施
  ↓ 候補プレフィルタ完成
Phase 3c (飛びパターン) ← オプショナル、プロファイリング結果次第
```

各サブフェーズは独立してテスト・マージ可能。各フェーズ完了時にフォールバック旧パスを削除する。

## 検証

```bash
# Phase 3a（lineCounting のテストは Phase 2 で作成済み、追加分のみ）
pnpm vitest run src/logic/cpu/lineTable/lineCounting.test.ts

# Phase 3b
pnpm vitest run src/logic/cpu/lineTable/lineChecks.test.ts

# Phase 3d
pnpm vitest run src/logic/cpu/lineTable/lineCandidates.test.ts

# Phase 3c（オプショナル）
pnpm vitest run src/logic/cpu/lineTable/lineJumpPatterns.test.ts

# 全体
pnpm check-fix
```
