# ステップ4: 細かな改善

## 概要

斜め方向ボーナスと開局パターン評価を実装し、AIの打ち筋を改善する。

## 優先度: 低

## 背景

斜め連は隣接点が多く石の効率が高い。また、連珠では開局（珠型）によって有利不利が決まることが知られている。

## 機能1: 斜め方向ボーナス

### 理論

斜め方向の石は、隣接する空き点が多いため効率が良い。

| 方向 | 二連の隣接空き点数 |
|------|------------------|
| 縦・横 | 10点 |
| 斜め | 12点 |

### 実装方針

斜め方向（右下斜め、右上斜め）のパターンに+5%のボーナスを付与。

### 実装詳細

```typescript
// evaluation.ts

/** 斜め方向ボーナス係数 */
const DIAGONAL_BONUS_MULTIPLIER = 1.05;

/**
 * 4方向のベクトル（斜めを識別可能に）
 */
const DIRECTIONS_WITH_TYPE: { dr: number; dc: number; isDiagonal: boolean }[] = [
  { dr: 0, dc: 1, isDiagonal: false },  // 横（右）
  { dr: 1, dc: 0, isDiagonal: false },  // 縦（下）
  { dr: 1, dc: 1, isDiagonal: true },   // 右下斜め
  { dr: 1, dc: -1, isDiagonal: true },  // 右上斜め
];

export function evaluateStonePatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  let score = 0;

  for (const dir of DIRECTIONS_WITH_TYPE) {
    const pattern = analyzeDirection(board, row, col, dir.dr, dir.dc, color);
    let dirScore = getPatternScore(pattern);

    // 斜め方向ボーナス
    if (dir.isDiagonal && dirScore > 0) {
      dirScore *= DIAGONAL_BONUS_MULTIPLIER;
    }

    score += dirScore;
  }

  return score;
}
```

### テストケース

```typescript
describe("斜め方向ボーナス", () => {
  it("斜め方向のパターンに5%ボーナス", () => {
    const board = createEmptyBoard();

    // 横方向の活三
    const horizontalBoard = copyBoard(board);
    horizontalBoard[7][6] = "black";
    horizontalBoard[7][7] = "black";
    const horizontalScore = evaluatePosition(horizontalBoard, 7, 8, "black");

    // 斜め方向の活三（同等のパターン）
    const diagonalBoard = copyBoard(board);
    diagonalBoard[6][6] = "black";
    diagonalBoard[7][7] = "black";
    const diagonalScore = evaluatePosition(diagonalBoard, 8, 8, "black");

    // 斜め方向が5%高い
    expect(diagonalScore).toBeGreaterThan(horizontalScore);
    expect(diagonalScore / horizontalScore).toBeCloseTo(1.05, 1);
  });
});
```

## 機能2: 開局パターン評価

### 背景

連珠では珠型（開局パターン）によって黒白の有利不利が研究されている。

### 珠型ごとの評価

| 珠型 | 評価 | 推奨スコア調整 |
|------|------|---------------|
| 花月 | 黒必勝 | 黒+500, 白-500 |
| 浦月 | 黒必勝 | 黒+500, 白-500 |
| 疎星 | 黒有利 | 黒+300, 白-300 |
| 流星 | 黒有利 | 黒+300, 白-300 |
| 渓月 | 黒やや有利 | 黒+100, 白-100 |
| 峡月 | 黒やや有利 | 黒+100, 白-100 |
| 瑞星 | 互角 | ±0 |
| 山月 | 白やや有利 | 黒-100, 白+100 |
| 寒星 | 白有利 | 黒-200, 白+200 |

### 実装方針

1. 開局データベースを作成
2. 現在の盤面が開局フェーズ（4〜10手目程度）かチェック
3. 珠型を判定し、評価にボーナス/ペナルティを反映

### 実装詳細

```typescript
// opening.ts に追加

/**
 * 珠型の評価値
 * 正の値は黒有利、負の値は白有利
 */
export const JUSHU_EVALUATION: Record<string, number> = {
  // 黒必勝
  "花月": 500,
  "浦月": 500,

  // 黒有利
  "疎星": 300,
  "流星": 300,
  "金星": 250,
  "松月": 250,

  // 黒やや有利
  "渓月": 100,
  "峡月": 100,
  "雲月": 100,
  "名月": 100,

  // 互角
  "瑞星": 0,
  "遊星": 0,
  "彗星": 0,
  "水月": 0,

  // 白やや有利
  "山月": -100,
  "岩月": -100,
  "銀月": -100,

  // 白有利
  "寒星": -200,
  "残月": -200,
  "明星": -200,
  "雨月": -200,
  "丘月": -200,
  "新月": -200,
  "恒星": -200,
};

/**
 * 開局評価ボーナスを取得
 *
 * @param board 盤面
 * @param color 評価する視点
 * @returns 評価ボーナス（黒視点で計算、白の場合は符号反転）
 */
export function getOpeningEvaluation(
  board: BoardState,
  color: "black" | "white",
): number {
  // 開局フェーズ外なら0
  const stoneCount = countStones(board);
  if (stoneCount < 3 || stoneCount > 10) {
    return 0;
  }

  // 珠型を判定
  const patternInfo = getOpeningPatternInfo(board);
  if (!patternInfo) {
    return 0;
  }

  const evaluation = JUSHU_EVALUATION[patternInfo.name] ?? 0;

  // 白視点なら符号反転
  return color === "black" ? evaluation : -evaluation;
}
```

```typescript
// evaluation.ts に追加

import { getOpeningEvaluation } from "./opening";

export function evaluateBoard(
  board: BoardState,
  perspective: "black" | "white",
): number {
  const opponentColor = perspective === "black" ? "white" : "black";
  let myScore = 0;
  let opponentScore = 0;

  // 既存の評価ロジック...

  // 開局評価ボーナスを追加
  const openingBonus = getOpeningEvaluation(board, perspective);

  return myScore - opponentScore + openingBonus;
}
```

### テストケース

```typescript
describe("開局パターン評価", () => {
  it("花月は黒有利として評価", () => {
    const board = createEmptyBoard();
    // 花月の配置
    board[7][7] = "black";  // 天元
    board[8][8] = "white";  // 右下斜め
    board[6][7] = "black";  // 花月

    const blackEval = getOpeningEvaluation(board, "black");
    const whiteEval = getOpeningEvaluation(board, "white");

    expect(blackEval).toBe(500);
    expect(whiteEval).toBe(-500);
  });

  it("寒星は白有利として評価", () => {
    const board = createEmptyBoard();
    // 寒星の配置
    board[7][7] = "black";  // 天元
    board[8][8] = "white";  // 右下斜め
    board[6][6] = "black";  // 寒星

    const blackEval = getOpeningEvaluation(board, "black");
    const whiteEval = getOpeningEvaluation(board, "white");

    expect(blackEval).toBe(-200);
    expect(whiteEval).toBe(200);
  });

  it("10手目以降は開局評価なし", () => {
    const board = createEmptyBoard();
    // 11手置かれた状態をシミュレート
    const positions = [
      [7, 7], [8, 8], [6, 7], [9, 9], [5, 7],
      [10, 10], [4, 7], [11, 11], [3, 7], [12, 12], [2, 7]
    ];
    positions.forEach(([r, c], i) => {
      board[r!]![c!] = i % 2 === 0 ? "black" : "white";
    });

    const eval1 = getOpeningEvaluation(board, "black");
    expect(eval1).toBe(0);
  });
});
```

## 追加: 開局データベースの拡張（将来）

現在の実装では珠型の静的評価のみ。将来的には:

1. **定石データベース**: 珠型ごとの最善手順をデータベース化
2. **学習による評価**: 対局データから珠型の勝率を学習
3. **相手の棋風対応**: 相手の傾向に応じて珠型選択を変更

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/logic/cpuAI/evaluation.ts` | 斜め方向ボーナス追加 |
| `src/logic/cpuAI/opening.ts` | 珠型評価データ、`getOpeningEvaluation()` 追加 |
| `src/logic/cpuAI/opening.test.ts` | 開局評価のテスト追加 |
| `src/logic/cpuAI/evaluation.test.ts` | 斜め方向ボーナスのテスト追加 |

## 検証方法

```bash
# 単体テスト
pnpm test src/logic/cpuAI/

# 型チェック・リント
pnpm check-fix

# 実際のプレイで確認
pnpm dev
# 開局で有利な珠型を選択するか確認
# 斜め方向を優先する傾向があるか確認
```

## 完了条件

- [ ] 斜め方向のパターンに+5%ボーナス
- [ ] 珠型評価データが全26種類分定義されている
- [ ] 開局フェーズ（3〜10手目）で珠型評価が適用される
- [ ] 11手目以降は珠型評価が0になる
- [ ] 全テストがパス
- [ ] `pnpm check-fix` がパス

## 注意事項

### 斜め方向ボーナスについて

5%程度のボーナスは微小な影響。他の要素（四三、VCFなど）が優先されるべき。過度に斜めを優先すると不自然な打ち筋になる可能性がある。

### 開局評価について

珠型の評価値は研究に基づくが、実際のAIの強さはその後の中盤・終盤の読みに大きく依存。開局評価だけで勝敗が決まるわけではない。

評価値は参考程度とし、実際の対局結果を見ながら調整が必要。
