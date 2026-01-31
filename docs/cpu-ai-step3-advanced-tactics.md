# ステップ3: 高度な戦術評価

## 概要

複数方向脅威ボーナス、カウンターフォー、VCT探索を実装し、より高度な戦術を評価できるようにする。

## 優先度: 中

## 背景

連珠では単一方向の脅威だけでなく、複数方向への同時脅威や、防御しながら攻撃する手が重要。VCT（三・四の連続による勝利）も強力な勝ちパターン。

## 機能1: 複数方向脅威ボーナス

### 定義

次に2通り以上の勝ち方がある状態を作る手に高評価を与える。

### 実装方針

4方向のパターン評価後、高スコア（OPEN_THREE以上）のパターンが2つ以上あればボーナス。

### 実装詳細

```typescript
// evaluation.ts

/** 複数方向脅威ボーナス */
const MULTI_THREAT_BONUS = 500;

/**
 * 複数方向脅威をチェック
 * OPEN_THREE以上の脅威が2方向以上あればボーナス
 */
function evaluateMultiThreat(
  directionResults: DirectionScores[],
): number {
  let threatCount = 0;

  for (const result of directionResults) {
    // 活三以上の脅威をカウント
    if (result.hasOpenThree || result.hasFour || result.hasOpenFour) {
      threatCount++;
    }
  }

  // 2方向以上の脅威があればボーナス
  if (threatCount >= 2) {
    return MULTI_THREAT_BONUS * (threatCount - 1); // 2方向で+500, 3方向で+1000...
  }

  return 0;
}
```

### テストケース

```typescript
describe("複数方向脅威ボーナス", () => {
  it("2方向に活三がある場合にボーナス", () => {
    const board = createEmptyBoard();
    // 横に ●● （活三準備）
    board[7][6] = "black";
    board[7][7] = "black";
    // 縦に ●● （活三準備）
    board[5][8] = "black";
    board[6][8] = "black";

    const score = evaluatePosition(board, 7, 8, "black");
    // 2つの活三 + マルチ脅威ボーナス
    const baseScore = PATTERN_SCORES.OPEN_THREE * 2;
    expect(score).toBeGreaterThan(baseScore);
  });
});
```

## 機能2: カウンターフォー（防御兼攻撃）

### 定義

単に相手の脅威を止めるだけでなく、自分も四を作りながら止める手。

### 実装方針

防御スコアの計算時、自分の攻撃スコアも高い場合に係数1.5倍。

### 実装詳細

```typescript
// evaluation.ts

/** カウンター攻撃係数 */
const COUNTER_ATTACK_MULTIPLIER = 1.5;

export function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): number {
  // ... 既存の攻撃スコア計算 ...

  // 防御スコア計算
  const opponentColor = color === "black" ? "white" : "black";
  const opponentTestBoard = copyBoard(board);
  opponentTestBoard[row]![col] = opponentColor;
  const opponentPatternScore = evaluateStonePatterns(
    opponentTestBoard,
    row,
    col,
    opponentColor,
  );

  // 基本防御スコア（相手のスコアの50%）
  let defenseScore = opponentPatternScore * 0.5;

  // カウンターフォーボーナス
  // 自分の攻撃スコアが高い（四以上）場合、防御価値を1.5倍に
  if (attackScore >= PATTERN_SCORES.FOUR && opponentPatternScore >= PATTERN_SCORES.OPEN_THREE) {
    defenseScore *= COUNTER_ATTACK_MULTIPLIER;
  }

  return attackScore + defenseScore + centerBonus;
}
```

### テストケース

```typescript
describe("カウンターフォー", () => {
  it("防御しながら四を作る手が高評価", () => {
    const board = createEmptyBoard();
    // 白の活三 ○○○_ を作る
    board[7][5] = "white";
    board[7][6] = "white";
    board[7][7] = "white";
    // 黒の三連 ●●● を縦に配置
    board[5][8] = "black";
    board[6][8] = "black";
    board[8][8] = "black";

    // (7,8)に黒を置くと白の活三を止めつつ黒の四を作る
    const counterScore = evaluatePosition(board, 7, 8, "black");

    // 普通に白を止めるだけの手と比較
    board[5][8] = null;
    board[6][8] = null;
    board[8][8] = null;
    const normalDefenseScore = evaluatePosition(board, 7, 8, "black");

    expect(counterScore).toBeGreaterThan(normalDefenseScore);
  });
});
```

## 機能3: VCT探索（三も含む脅威連続）

### 定義

VCT（Victory by Continuous Threats）は、VCFより広い概念。三・四を連続して打つことで勝利する手順。

### 特徴

- VCFは四のみを追う
- VCTは三も含めて脅威を連続させる
- 計算コストが高いため、終盤限定または深さ制限を厳しくする

### 実装方針

1. 終盤（石数が一定以上）でのみVCT探索を有効化
2. 深さ制限を4手程度に設定
3. 三を打った後、相手が止めなければ四追いに移行できるかチェック

### 実装詳細

```typescript
// 新規ファイル: src/logic/cpuAI/vct.ts

/**
 * VCT（Victory by Continuous Threats）探索
 * 三・四を連続して打つことで勝利する手順を探索
 */

const VCT_MAX_DEPTH = 4;
const VCT_STONE_THRESHOLD = 20; // この石数以上で有効化

/**
 * VCTが成立するかチェック
 */
export function hasVCT(
  board: BoardState,
  color: "black" | "white",
  depth: number = 0,
): boolean {
  if (depth >= VCT_MAX_DEPTH) {
    return false;
  }

  // まずVCFをチェック（VCFがあればVCTも成立）
  if (hasVCF(board, color, 0)) {
    return true;
  }

  // 活三を作れる位置を列挙
  const threatMoves = findThreatMoves(board, color);

  for (const move of threatMoves) {
    // 脅威を作る
    const afterThreat = copyBoard(board);
    afterThreat[move.row]![move.col] = color;

    // 相手の全ての応手について調べる
    // 活三の場合、相手は2箇所のどちらかを止める必要がある
    const defensePositions = getThreatDefensePositions(afterThreat, move.row, move.col, color);

    // 全ての防御に対して脅威を継続できるかチェック
    let canContinueAllDefenses = true;

    for (const defensePos of defensePositions) {
      const opponentColor = color === "black" ? "white" : "black";

      // 黒の場合、防御位置が禁手なら相手は止められない
      if (opponentColor === "black") {
        const forbiddenResult = checkForbiddenMove(afterThreat, defensePos.row, defensePos.col);
        if (forbiddenResult.isForbidden) {
          continue; // この防御は不可能、次の防御をチェック
        }
      }

      const afterDefense = copyBoard(afterThreat);
      afterDefense[defensePos.row]![defensePos.col] = opponentColor;

      // 防御された後もVCTが継続できるか
      if (!hasVCT(afterDefense, color, depth + 1)) {
        canContinueAllDefenses = false;
        break;
      }
    }

    if (canContinueAllDefenses && defensePositions.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * 脅威（活三・四）を作れる位置を列挙
 */
function findThreatMoves(board: BoardState, color: "black" | "white"): Position[] {
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

      // 脅威（活三または四）が作れるかチェック
      if (createsThreat(board, row, col, color)) {
        moves.push({ row, col });
      }
    }
  }

  // 脅威の強さでソート（四 > 活三）
  return sortByThreatStrength(moves, board, color);
}

/**
 * 脅威に対する防御位置を取得
 */
function getThreatDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 活三の場合、両端が防御位置
    if (pattern.count === 3 && pattern.end1 === "empty" && pattern.end2 === "empty") {
      // 両端の位置を追加
      const end1Pos = getEndPosition(board, row, col, dr, dc, color, 1);
      const end2Pos = getEndPosition(board, row, col, dr, dc, color, -1);
      if (end1Pos) positions.push(end1Pos);
      if (end2Pos) positions.push(end2Pos);
    }

    // 四の場合、1箇所のみ防御位置
    if (pattern.count === 4 && (pattern.end1 === "empty" || pattern.end2 === "empty")) {
      if (pattern.end1 === "empty") {
        const end1Pos = getEndPosition(board, row, col, dr, dc, color, 1);
        if (end1Pos) positions.push(end1Pos);
      }
      if (pattern.end2 === "empty") {
        const end2Pos = getEndPosition(board, row, col, dr, dc, color, -1);
        if (end2Pos) positions.push(end2Pos);
      }
    }
  }

  return positions;
}
```

```typescript
// evaluation.ts に追加

/** VCTボーナス */
const VCT_BONUS = 8000;

/**
 * VCT評価
 * 終盤でVCTがある場合に高スコア
 */
function evaluateVCT(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  // 石数チェック（終盤のみ）
  const stoneCount = countAllStones(board);
  if (stoneCount < VCT_STONE_THRESHOLD) {
    return 0;
  }

  // 仮に石を置く
  const testBoard = copyBoard(board);
  testBoard[row]![col] = color;

  // VCTチェック
  if (hasVCT(testBoard, color)) {
    return VCT_BONUS;
  }

  return 0;
}
```

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/logic/cpuAI/evaluation.ts` | 複数方向脅威、カウンターフォー、VCT評価追加 |
| `src/logic/cpuAI/vct.ts` | VCT探索（新規作成） |
| `src/logic/cpuAI/vct.test.ts` | VCT探索のテスト（新規作成） |
| `src/logic/cpuAI/evaluation.test.ts` | 複数方向脅威・カウンターフォーのテスト追加 |

## 検証方法

```bash
# 単体テスト
pnpm test src/logic/cpuAI/

# 型チェック・リント
pnpm check-fix

# パフォーマンステスト
# VCT探索が重すぎないか確認
pnpm test src/logic/cpuAI/vct.test.ts --verbose

# 実際のプレイで確認
pnpm dev
```

## 完了条件

- [ ] 2方向以上の脅威に+500ボーナス×(方向数-1)
- [ ] カウンターフォーで防御スコア1.5倍
- [ ] VCT探索が深さ4手まで正しく動作
- [ ] VCTがある手に+8000ボーナス（終盤のみ）
- [ ] VCT探索のパフォーマンスが許容範囲内（1手あたり100ms以下）
- [ ] 全テストがパス
- [ ] `pnpm check-fix` がパス

## パフォーマンス考慮事項

VCT探索は計算コストが高いため:

1. **終盤限定**: 石数が20個以上の場合のみ有効化
2. **深さ制限**: 4手までに制限
3. **枝刈り**: 明らかに勝てない分岐は早期終了
4. **キャッシュ**: 同一局面の結果をキャッシュ

パフォーマンスが問題になる場合:
- VCT探索を別スレッドで実行
- 時間制限を設ける
- 深さ制限をさらに厳しくする
