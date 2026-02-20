# Mise-VCF ノリ手対応プラン

## Context

### 問題

`93c868b` でMise-VCFの偽陽性対策として「全Mise-VCFをminimax検証に委ねる」変更を行ったが、思考時間が+112%（avg 902ms→1909ms）に増加し、time-pressure-errorが10→94件（9.4倍）に悪化した。

### 根本原因（ノリ手）

Game 185の偽陽性の分析により、根本原因が特定された:

```
m15 (B): H7 = ミセ手（G6で四三）+ 飛び三（H列: H10-_-H8-H7）
m16 (W): H6 = 飛び三の外止め → 活三を同時に作る（ノリ手）
m17 (B): G6 = 予定通り四三
m18 (W): 四を止める手がH6の三と繋がり、棒四 → 白勝ち
```

**ミセ手が三（活三 or 飛び三）を同時に作った場合、相手はミセターゲット（四三点）ではなく三を止める方を優先する。** 三を止める手が「ノリ手」（防御+反撃）になると、その後の四三→VCF手順が破綻する。

### 修正方針

minimax委譲ではなく、Mise-VCFアルゴリズム自体を修正する:

1. ミセ手配置後、**攻撃側の活三/飛び三の作成を検出**
2. 三がない場合、**Mise-VCFとして却下**（非強制ミセ手、`bug-mise-vcf-non-forcing.md` 参照）
3. 三がある場合、相手の**全ての三防御位置**に対してVCFを検証
4. 全防御位置でVCFが成立する場合のみMise-VCFを返す
5. `iterativeDeepening.ts` のminimax委譲を元に戻す（immediateMove復帰）

## Phase 1: `findMiseVCFSequence` の修正（TDD）

### Red: テスト追加

**ファイル**: `src/logic/cpu/search/miseVcf.test.ts`

```typescript
describe("Mise-VCFの強制性チェック", () => {
  it("Game 185: ミセ手H7が飛び三を作るがノリ手で無効 → Mise-VCF検出しない", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 G7 I7 G8 I6 I8 J8 G9 G10 F8 E8 H10 I11",
    );
    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
    if (result) {
      expect(result.miseMove.row === 8 && result.miseMove.col === 7).toBe(
        false,
      );
    }
  });

  it("Game 121: 三も四も作らないミセ手K13 → Mise-VCF検出しない", () => {
    const { board } = createBoardFromRecord(
      "H8 I7 F10 K9 J8 H6 I8 G8 H9 G10 I9 H10 G9 F9 J10 G7 H7 J9 G12 F8 E9 H11 E8 E11 F11 I5 J4 I14 E10 D9 I12 H12 E7 E6 K5 J12 L9 H14 H13 K11 I13",
    );
    const result = findMiseVCFSequence(board, "white", GENEROUS_TIME_LIMIT);
    if (result) {
      expect(result.miseMove.row === 2 && result.miseMove.col === 10).toBe(
        false,
      );
    }
  });

  it("三を作るミセ手で全防御位置にVCFが成立 → 従来通り検出する", () => {
    const { board } = createBoardFromRecord(
      "H8 I9 I7 G9 J8 H10 H6 K9 H7 H9 J9 I10",
    );
    const result = findMiseVCFSequence(board, "black", GENEROUS_TIME_LIMIT);
    expect(result).not.toBeNull();
    expect(result?.miseMove.row).toBe(8);
    expect(result?.miseMove.col).toBe(6);
  });
});
```

### Green: アルゴリズム修正

#### 1. ヘルパー関数 `getCreatedOpenThreeDefenses` を `vctHelpers.ts` に追加

> **レビュー指摘（SOLID）**: `vctHelpers.ts` に既に `hasOpenThree`, `getThreatDefensePositions` が存在し、同じimportを使っている。`miseVcf.ts` ではなく `vctHelpers.ts` に配置することで、search→evaluation の新規直接依存を避ける。

**ファイル**: `src/logic/cpu/search/vctHelpers.ts`

```typescript
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";

export function getCreatedOpenThreeDefenses(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const defenses: Position[] = [];
  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) continue;
    const direction = DIRECTIONS[i];
    if (!direction) continue;
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      defenses.push(
        ...getOpenThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color)
    ) {
      defenses.push(
        ...getJumpThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
  }
  const unique = new Map<string, Position>();
  for (const pos of defenses) {
    if (board[pos.row]?.[pos.col] !== null) continue;
    const key = `${pos.row},${pos.col}`;
    if (!unique.has(key)) unique.set(key, pos);
  }
  return Array.from(unique.values());
}
```

#### 2. `findMiseVCFSequence` のループ内に強制性チェック追加

**ファイル**: `src/logic/cpu/search/miseVcf.ts`

L145 `findMiseTargetsLite` + 空チェックの後に追加:

```typescript
const miseTargets = findMiseTargetsLite(board, row, col, color);
// （既存の miseTargets 空チェックは維持）

// NEW: ミセ手が活三/飛び三を作るかチェック
const threeDefenses = getCreatedOpenThreeDefenses(board, row, col, color);

// 三を作らないミセ手は非強制 → Mise-VCFとして不適格
if (threeDefenses.length === 0) {
  moveRow[col] = null;
  continue;
}

// 三を作る場合、全三防御位置でVCFが成立するか検証（ノリ手対策）
const threeDefenseVcfOptions: VCFSearchOptions = {
  maxDepth: vcfOptions.maxDepth ?? 12,
  timeLimit: 100,
};
let miseInvalidated = false;
for (const defense of threeDefenses) {
  if (performance.now() - startTime >= timeLimit) {
    moveRow[col] = null;
    return null;
  }
  const defRow = board[defense.row];
  if (!defRow) continue;
  defRow[defense.col] = opponentColor;
  const vcfCheck = findVCFSequence(board, color, threeDefenseVcfOptions);
  defRow[defense.col] = null;
  if (!vcfCheck) {
    miseInvalidated = true;
    break;
  }
}
if (miseInvalidated) {
  moveRow[col] = null;
  continue;
}

// 既存: 各ミセターゲットについてVCF探索
for (const target of miseTargets) { ... }
```

## Phase 2: `iterativeDeepening.ts` のminimax委譲を元に戻す

**ファイル**: `src/logic/cpu/search/iterativeDeepening.ts` (L224-244)

Mise-VCFの扱いを `vctHintMove` から `immediateMove` に戻す:

```typescript
// 変更前（現在）: VCTヒントとしてminimax検証に委ねる
if (!isForbidden) {
  vctHintMove = miseVcfMove;
}

// 変更後（元に戻す）: 即座にMise-VCFスコアを返す
if (!isForbidden) {
  return {
    immediateMove: { position: miseVcfMove, score: PATTERN_SCORES.FIVE },
    opponentVCFResult: null,
  };
}
```

## Phase 3: テスト更新

**ファイル**: `src/logic/cpu/search/iterativeDeepening.test.ts`

L526-570の「Mise-VCFのminimax検証」テスト:

- Game 185: テスト意図を「ノリ手でMise-VCFが無効化される」に変更。期待値は同じ（score < FIVE）
- Game 121: テスト意図を「非強制ミセ手がMise-VCFとして検出されない」に変更。期待値は同じ（score < FIVE）

## Phase 4: ベンチマーク検証

```bash
pnpm bench --self --players=hard --games=200 --parallel
```

| 指標                | Phase 1前 (minimax委譲) | 目標                             |
| ------------------- | ----------------------- | -------------------------------- |
| 思考時間            | avg 1705-1745ms         | avg 900-1000ms（元の水準に復帰） |
| time-pressure-error | 94件                    | ~10件（元の水準）                |
| VCF偽陽性           | 1件                     | 0-1件                            |
| 禁手追い込み率      | 19.0%                   | 19%前後（維持）                  |

## 主要ファイル

| ファイル                                          | 変更内容                           |
| ------------------------------------------------- | ---------------------------------- |
| `src/logic/cpu/search/vctHelpers.ts`              | `getCreatedOpenThreeDefenses` 追加 |
| `src/logic/cpu/search/miseVcf.ts`                 | 強制性チェック + 三防御VCF検証     |
| `src/logic/cpu/search/miseVcf.test.ts`            | テスト追加                         |
| `src/logic/cpu/search/iterativeDeepening.ts`      | Mise-VCF を `immediateMove` に復帰 |
| `src/logic/cpu/search/iterativeDeepening.test.ts` | テスト意図変更                     |

## 関連ドキュメント

- `docs/bug-report/bug-mise-vcf-non-forcing.md` - Game 121の非強制ミセ手バグの詳細
