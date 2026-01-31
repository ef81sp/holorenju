# ステップ1: 跳びパターン検出と四三ボーナス

## 概要

評価関数を拡張し、跳び三・跳び四パターンの検出と四三同時作成ボーナスを実装する。

## 優先度: 最高

## 背景

現在の`evaluation.ts`は連続した石のみを検出しているが、連珠では1マス空いた形（跳び形）も同等の脅威を持つ。また、四と三を同時に作る手は黒の主な勝ちパターンであり、高く評価すべき。

## 機能1: 跳び三・跳び四の検出

### 現状

`renjuRules.ts`には禁手判定用の跳びパターン検出が存在するが、`evaluation.ts`の評価関数では使用されていない。

### 検出すべきパターン

| パターン | 形の例               | スコア            |
| -------- | -------------------- | ----------------- |
| 跳び四   | `●_●●●`, `●●_●●`     | FOUR (1000)       |
| 活跳び四 | `_●_●●●_`, `_●●_●●_` | OPEN_FOUR (10000) |
| 跳び三   | `●_●●`, `●●_●`       | THREE (100)       |
| 活跳び三 | `_●_●●_`, `_●●_●_`   | OPEN_THREE (1000) |

### 実装方針

1. `analyzeDirection()` を拡張し、1マス空きパターンも検出
2. 新しい関数 `analyzeDirectionWithGap()` を追加
3. ラインスキャンでパターンマッチングを実行

### 実装詳細

```typescript
// evaluation.ts に追加

/**
 * 跳びパターン分析結果
 */
interface JumpPatternResult {
  /** 跳び四の数 */
  jumpFour: number;
  /** 活跳び四の数 */
  openJumpFour: number;
  /** 跳び三の数 */
  jumpThree: number;
  /** 活跳び三の数 */
  openJumpThree: number;
}

/**
 * 指定方向の跳びパターンを分析
 * ラインを取得し、跳び形のパターンマッチングを行う
 */
function analyzeJumpPatterns(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): JumpPatternResult {
  // 置いた位置を中心に両方向にスキャン
  const line: (StoneColor | "edge")[] = [];

  // 負方向に5マス
  for (let i = 5; i >= 1; i--) {
    const r = row - dr * i;
    const c = col - dc * i;
    if (isValidPosition(r, c)) {
      line.push(board[r]?.[c] ?? null);
    } else {
      line.push("edge");
    }
  }

  // 置いた位置
  line.push(color);

  // 正方向に5マス
  for (let i = 1; i <= 5; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (isValidPosition(r, c)) {
      line.push(board[r]?.[c] ?? null);
    } else {
      line.push("edge");
    }
  }

  const result: JumpPatternResult = {
    jumpFour: 0,
    openJumpFour: 0,
    jumpThree: 0,
    openJumpThree: 0,
  };

  // パターンマッチング（置いた位置を含むパターンのみ）
  const placedIndex = 5;
  const opponent = color === "black" ? "white" : "black";

  // 跳び四パターン: ●●●_● or ●●_●● or ●_●●●
  // 活跳び四: 両端が空
  // ... パターンマッチングロジック

  return result;
}
```

### テストケース

```typescript
// evaluation.test.ts に追加

describe("跳びパターン検出", () => {
  it("跳び四を検出できる", () => {
    const board = createEmptyBoard();
    // ●_●●● パターン
    board[7][7] = "black";
    // board[7][8] = null (空き)
    board[7][9] = "black";
    board[7][10] = "black";
    board[7][11] = "black";

    const score = evaluatePosition(board, 7, 8, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.FOUR);
  });

  it("活跳び三を検出できる", () => {
    const board = createEmptyBoard();
    // _●_●●_ パターン
    board[7][8] = "black";
    // board[7][9] = null (空き)
    board[7][10] = "black";
    board[7][11] = "black";

    const score = evaluatePosition(board, 7, 9, "black");
    expect(score).toBeGreaterThanOrEqual(PATTERN_SCORES.OPEN_THREE);
  });
});
```

## 機能2: 四三同時作成ボーナス

### 現状

```
現在: OPEN_FOUR(10000) + OPEN_THREE(1000) = 11000
```

### 提案

```
四三同時ボーナス +5000 → 合計 16000
```

### 実装方針

1. `evaluatePosition()` で4方向のパターンを分析後、結果を集計
2. 四（活四または止め四）と三（活三）が同時に存在する場合にボーナス加算

### 実装詳細

```typescript
// evaluation.ts

/** 四三同時作成ボーナス */
const FOUR_THREE_BONUS = 5000;

/**
 * 方向ごとのパターン分析結果
 */
interface DirectionScores {
  hasFour: boolean; // 四（活四または止め四）がある
  hasOpenFour: boolean; // 活四がある
  hasOpenThree: boolean; // 活三がある
  hasThree: boolean; // 三（活三または止め三）がある
  score: number; // この方向のスコア
}

export function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): number {
  // ... 既存の処理 ...

  // 4方向の分析結果を収集
  const directionResults: DirectionScores[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(testBoard, row, col, dr, dc, color);
    const jumpPattern = analyzeJumpPatterns(testBoard, row, col, dr, dc, color);

    const result: DirectionScores = {
      hasFour:
        pattern.count === 4 &&
        (pattern.end1 === "empty" || pattern.end2 === "empty"),
      hasOpenFour:
        pattern.count === 4 &&
        pattern.end1 === "empty" &&
        pattern.end2 === "empty",
      hasOpenThree:
        pattern.count === 3 &&
        pattern.end1 === "empty" &&
        pattern.end2 === "empty",
      hasThree:
        pattern.count === 3 &&
        (pattern.end1 === "empty" || pattern.end2 === "empty"),
      score: getPatternScore(pattern),
    };

    // 跳びパターンも考慮
    if (jumpPattern.jumpFour > 0 || jumpPattern.openJumpFour > 0) {
      result.hasFour = true;
    }
    if (jumpPattern.openJumpFour > 0) {
      result.hasOpenFour = true;
    }
    if (jumpPattern.openJumpThree > 0) {
      result.hasOpenThree = true;
    }
    if (jumpPattern.jumpThree > 0 || jumpPattern.openJumpThree > 0) {
      result.hasThree = true;
    }

    directionResults.push(result);
  }

  // 四三同時作成ボーナス
  const hasFour = directionResults.some((r) => r.hasFour || r.hasOpenFour);
  const hasThree = directionResults.some((r) => r.hasOpenThree);

  let bonus = 0;
  if (hasFour && hasThree) {
    bonus = FOUR_THREE_BONUS;
  }

  return attackScore + defenseScore + centerBonus + bonus;
}
```

### テストケース

```typescript
describe("四三同時作成ボーナス", () => {
  it("四と活三を同時に作る手にボーナスが加算される", () => {
    const board = createEmptyBoard();
    // 四三が作れる配置を作成
    // 横に ●●●_ （四になる）
    board[7][6] = "black";
    board[7][7] = "black";
    board[7][8] = "black";
    // 縦に _●●_ （活三になる）
    board[6][9] = "black";
    board[8][9] = "black";

    const score = evaluatePosition(board, 7, 9, "black");
    // 四 + 活三 + 四三ボーナス
    expect(score).toBeGreaterThan(
      PATTERN_SCORES.FOUR + PATTERN_SCORES.OPEN_THREE,
    );
  });
});
```

## 変更ファイル

| ファイル                             | 変更内容                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `src/logic/cpuAI/evaluation.ts`      | `analyzeJumpPatterns()` 追加、`evaluatePosition()` 拡張 |
| `src/logic/cpuAI/evaluation.test.ts` | 跳びパターン・四三ボーナスのテスト追加                  |

## 検証方法

```bash
# 単体テスト
pnpm test src/logic/cpuAI/evaluation.test.ts

# 型チェック・リント
pnpm check-fix

# 実際のプレイで確認
pnpm dev
# CPU対戦で跳び形を作る手を高く評価しているか確認
```

## 完了条件

- [ ] 跳び四パターンをFOURスコアで評価
- [ ] 活跳び四パターンをOPEN_FOURスコアで評価
- [ ] 跳び三パターンをTHREEスコアで評価
- [ ] 活跳び三パターンをOPEN_THREEスコアで評価
- [ ] 四三同時作成時に+5000ボーナス
- [ ] 全テストがパス
- [ ] `pnpm check-fix` がパス
