# ステップ2: 白の三三四四勝利と禁手追い込み

## 概要

白番専用の評価ロジックを追加し、三三・四四による即勝利評価、禁手追い込み戦術、ミセ手・フクミ手の検出を実装する。

## 優先度: 高

## 背景

連珠では白には禁手がないため、三三・四四は黒と違って即勝利となる。また、黒を禁手位置に追い込む戦術は白の重要な勝ちパターン。

## 機能1: 白の三三・四四を勝利扱い

### 現状

| パターン | 現状   | 提案                 |
| -------- | ------ | -------------------- |
| 白の三三 | 未対応 | FIVE と同等 (100000) |
| 白の四四 | 未対応 | FIVE と同等 (100000) |
| 白の長連 | 対応済 | FIVE と同等          |

### 実装方針

白番の評価時に、活三が2つ以上または四が2つ以上あれば FIVE スコアを返す。

### 実装詳細

```typescript
// evaluation.ts

/**
 * 白の三三・四四チェック
 * 白には禁手がないため、これらは即勝利となる
 */
function checkWhiteWinningPattern(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  // 仮想的に石を置く
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = "white";
  }

  let openThreeCount = 0;
  let fourCount = 0;

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(testBoard, row, col, dr, dc, "white");

    // 活三カウント
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      openThreeCount++;
    }

    // 四カウント（活四・止め四両方）
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      fourCount++;
    }

    // 跳びパターンも考慮
    const jumpPattern = analyzeJumpPatterns(
      testBoard,
      row,
      col,
      dr,
      dc,
      "white",
    );
    if (jumpPattern.openJumpThree > 0) {
      openThreeCount++;
    }
    if (jumpPattern.jumpFour > 0 || jumpPattern.openJumpFour > 0) {
      fourCount++;
    }
  }

  // 三三または四四なら即勝利
  return openThreeCount >= 2 || fourCount >= 2;
}

export function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): number {
  // ... 既存の五連チェック ...

  // 白の三三・四四チェック
  if (color === "white" && checkWhiteWinningPattern(board, row, col)) {
    return PATTERN_SCORES.FIVE;
  }

  // ... 以降の処理 ...
}
```

### テストケース

```typescript
describe("白の三三・四四", () => {
  it("白の三三を勝利として評価", () => {
    const board = createEmptyBoard();
    // 横に ○○ （活三になる準備）
    board[7][6] = "white";
    board[7][7] = "white";
    // 縦に ○○ （活三になる準備）
    board[5][8] = "white";
    board[6][8] = "white";
    // 7,8 に置くと横縦両方で活三

    const score = evaluatePosition(board, 7, 8, "white");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });

  it("白の四四を勝利として評価", () => {
    const board = createEmptyBoard();
    // 横に ○○○ （四になる）
    board[7][5] = "white";
    board[7][6] = "white";
    board[7][7] = "white";
    // 縦に ○○○ （四になる）
    board[4][8] = "white";
    board[5][8] = "white";
    board[6][8] = "white";

    const score = evaluatePosition(board, 7, 8, "white");
    expect(score).toBe(PATTERN_SCORES.FIVE);
  });
});
```

## 機能2: 禁手追い込み評価の強化

### 現状

| 状況                       | 現状   | 提案スコア  |
| -------------------------- | ------ | ----------- |
| 黒の防御位置が禁手         | 100    | +5000~10000 |
| 禁手への誘導手（ネライ手） | 未対応 | +1000~2000  |

### 実装方針

白番で四や活三を作る際、黒の止め位置が禁手かどうかをチェック。

### 実装詳細

```typescript
// evaluation.ts

/** 禁手追い込みスコア */
const FORBIDDEN_TRAP_STRONG = 5000;
const FORBIDDEN_TRAP_SETUP = 1500;

/**
 * 禁手追い込み評価
 * 白が四や活三を作った時、黒の防御位置が禁手なら高評価
 */
function evaluateForbiddenTrap(
  board: BoardState,
  row: number,
  col: number,
): number {
  // 仮想的に白石を置く
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = "white";
  }

  let trapScore = 0;

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(testBoard, row, col, dr, dc, "white");

    // 四を作った場合
    if (
      pattern.count === 4 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      // 黒の止め位置を特定
      const defensePositions = getDefensePositions(testBoard, row, col, dr, dc);

      for (const pos of defensePositions) {
        const forbiddenResult = checkForbiddenMove(testBoard, pos.row, pos.col);
        if (forbiddenResult.isForbidden) {
          // 黒が禁手位置でしか防御できない = 白勝利確定
          trapScore += FORBIDDEN_TRAP_STRONG;
        }
      }
    }

    // 活三を作った場合（次に四になる）
    if (
      pattern.count === 3 &&
      pattern.end1 === "empty" &&
      pattern.end2 === "empty"
    ) {
      // 両端の位置をチェック
      const extensionPoints = getExtensionPoints(testBoard, row, col, dr, dc);

      for (const pos of extensionPoints) {
        const forbiddenResult = checkForbiddenMove(testBoard, pos.row, pos.col);
        if (forbiddenResult.isForbidden) {
          // 禁手への誘導セットアップ
          trapScore += FORBIDDEN_TRAP_SETUP;
        }
      }
    }
  }

  return trapScore;
}

/**
 * 四に対する防御位置を取得
 */
function getDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
): Position[] {
  const positions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === "white") {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}
```

## 機能3: ミセ手・フクミ手の検出

### 定義

| 用語     | 説明                      | 提案スコア |
| -------- | ------------------------- | ---------- |
| ミセ手   | 次に四三を作れる手        | +1000      |
| フクミ手 | 次にVCF（四追い勝ち）の手 | +1500      |

### ミセ手の判定アルゴリズム

```
1. 仮に石を置く
2. その位置から4方向をスキャン
3. 活三パターンの数と、二連以上のパターンの数をカウント
4. 以下のいずれかを満たせばミセ手:
   - 活三 >= 1 かつ 別方向に二連以上 >= 1
   - 次の手で活三を2方向に作れる位置がある
```

### フクミ手の判定アルゴリズム（軽量版VCF探索）

```
VCF探索（深さ制限8手）:
1. 現在の局面で四が作れる位置を列挙
2. 各位置について:
   a. 四を作る
   b. 相手は必ずその四を止める（止め方は1通り）
   c. 止めた後の局面で再帰的にVCF探索
3. 五連に到達できればVCF成立
4. 深さ制限で打ち切り
```

### 実装詳細

```typescript
// 新規ファイル: src/logic/cpuAI/vcf.ts

/**
 * VCF（Victory by Continuous Fours）探索
 * 四を連続して打つことで勝利する手順を探索
 */

const VCF_MAX_DEPTH = 8;

/**
 * VCFが成立するかチェック
 */
export function hasVCF(
  board: BoardState,
  color: "black" | "white",
  depth: number = 0,
): boolean {
  if (depth >= VCF_MAX_DEPTH) {
    return false;
  }

  // 四を作れる位置を列挙
  const fourMoves = findFourMoves(board, color);

  for (const move of fourMoves) {
    // 四を作る
    const afterFour = copyBoard(board);
    afterFour[move.row]![move.col] = color;

    // 五連チェック
    if (checkFive(afterFour, move.row, move.col, color)) {
      return true;
    }

    // 相手の応手（四を止める）
    const defensePos = getFourDefensePosition(
      afterFour,
      move.row,
      move.col,
      color,
    );
    if (!defensePos) {
      // 止められない = 勝利
      return true;
    }

    // 黒の場合、防御位置が禁手ならVCF成立
    if (color === "white") {
      const opponentColor = "black";
      const forbiddenResult = checkForbiddenMove(
        afterFour,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        return true;
      }
    }

    // 相手が止めた後の局面で再帰
    const afterDefense = copyBoard(afterFour);
    const opponentColor = color === "black" ? "white" : "black";
    afterDefense[defensePos.row]![defensePos.col] = opponentColor;

    if (hasVCF(afterDefense, color, depth + 1)) {
      return true;
    }
  }

  return false;
}

/**
 * 四を作れる位置を列挙
 */
function findFourMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const moves: Position[] = [];

  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      if (board[row]?.[col] !== null) continue;
      if (!isNearExistingStone(board, row, col)) continue;

      // 黒の禁手チェック
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) continue;
      }

      // 四が作れるかチェック
      if (createsFour(board, row, col, color)) {
        moves.push({ row, col });
      }
    }
  }

  return moves;
}
```

```typescript
// evaluation.ts に追加

/** ミセ手ボーナス */
const MISE_BONUS = 1000;
/** フクミ手ボーナス */
const FUKUMI_BONUS = 1500;

/**
 * ミセ手判定
 * 次の手で四三が作れる位置
 */
function isMiseMove(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const testBoard = copyBoard(board);
  testBoard[row]![col] = color;

  // この手の後、周囲に四三が作れる位置があるかチェック
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr;
      const nc = col + dc;
      if (!isValidPosition(nr, nc)) continue;
      if (testBoard[nr]?.[nc] !== null) continue;

      // この位置で四三が作れるか
      if (createsFourThree(testBoard, nr, nc, color)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * フクミ手判定
 * 次の手でVCF（四追い勝ち）がある位置
 */
function isFukumiMove(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const testBoard = copyBoard(board);
  testBoard[row]![col] = color;

  return hasVCF(testBoard, color);
}
```

## 変更ファイル

| ファイル                             | 変更内容                                       |
| ------------------------------------ | ---------------------------------------------- |
| `src/logic/cpuAI/evaluation.ts`      | 白の三三四四判定、禁手追い込み、ミセ手判定追加 |
| `src/logic/cpuAI/vcf.ts`             | VCF探索（新規作成）                            |
| `src/logic/cpuAI/vcf.test.ts`        | VCF探索のテスト（新規作成）                    |
| `src/logic/cpuAI/evaluation.test.ts` | 白勝利パターン・禁手追い込みのテスト追加       |

## 検証方法

```bash
# 単体テスト
pnpm test src/logic/cpuAI/

# 型チェック・リント
pnpm check-fix

# 実際のプレイで確認
pnpm dev
# 白番で三三・四四を狙う動きを確認
# 禁手追い込み戦術を確認
```

## 完了条件

- [ ] 白の三三をFIVEスコアで評価
- [ ] 白の四四をFIVEスコアで評価
- [ ] 禁手位置が防御点となる四に+5000ボーナス
- [ ] ミセ手に+1000ボーナス
- [ ] フクミ手に+1500ボーナス
- [ ] VCF探索が深さ8手まで正しく動作
- [ ] 全テストがパス
- [ ] `pnpm check-fix` がパス
