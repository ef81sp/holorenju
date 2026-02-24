/**
 * 盤面全体の評価関数
 *
 * 盤面上の全石のパターンスコアを集計し、
 * 視点プレイヤーの有利度を数値化する
 */

import type { BoardState } from "@/types/game";

import { DIRECTIONS } from "../core/constants";
import { isNearExistingStone } from "../moveGenerator";
import { incrementEvaluationCalls } from "../profiling/counters";
import { countInDirection } from "./directionAnalysis";
import {
  type BoardEvaluationBreakdown,
  emptyLeafPatternScores,
  type LeafEvaluationOptions,
  PATTERN_SCORES,
} from "./patternScores";
import { evaluateStonePatternsWithBreakdown } from "./stonePatterns";
import { createsFourThree } from "./winningPatterns";

/**
 * 四三の必要条件を安価に判定（第二プレフィルタ）
 *
 * countInDirection で連続石をカウントし、
 * 「四の候補方向」と「活三の候補方向」が異なる方向に存在するか確認。
 * createsFourThree (~290 ops) の呼び出しを大幅に削減する。
 *
 * 制限: 連続石のみカウントするため、仮置き石が跳びパターンの端に
 * 位置する四三（例: BBB_B の端B位置）は検出できない（false negative）。
 * 末端評価のヒューリスティックとして許容範囲。
 */
function hasFourThreePotential(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  let hasFour = false;
  let hasOpenThree = false;

  for (const dir of DIRECTIONS) {
    const [dr, dc] = dir;

    const pos = countInDirection(board, row, col, dr, dc, color);
    const neg = countInDirection(board, row, col, -dr, -dc, color);
    const total = pos.count + neg.count;

    // 四の候補: 3石 + 仮置き = 4石連続、片端open
    if (total >= 3 && (pos.endState === "empty" || neg.endState === "empty")) {
      hasFour = true;
    }
    // 活三の候補: 2石 + 仮置き = 3石連続、両端open
    // else if により四方向と必ず異なる方向にマッチ
    else if (
      total >= 2 &&
      pos.endState === "empty" &&
      neg.endState === "empty"
    ) {
      hasOpenThree = true;
    }

    if (hasFour && hasOpenThree) {
      return true;
    }
  }
  return false;
}

/**
 * 指定色の四三脅威をスキャン
 * 空き交点に仮置きして四三が作れるか判定。最初の1件で打ち切り。
 */
function scanFourThreeThreat(
  board: BoardState,
  color: "black" | "white",
  stoneCount: number,
): boolean {
  // 四三 = 四(3石+仮置き) + 活三(2石+仮置き) で方向が異なるため最低5石必要
  if (stoneCount < 5) {
    return false;
  }
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
      // range=1: 四三の仮置き位置は必ず既存石に直接隣接する
      if (!isNearExistingStone(board, r, c, 1)) {
        continue;
      }
      if (!hasFourThreePotential(board, r, c, color)) {
        continue;
      }
      if (createsFourThree(board, r, c, color)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 盤面全体の評価スコアを計算
 *
 * @param board 盤面
 * @param perspective 評価する視点（黒/白）
 * @param options 末端評価オプション
 * @returns 評価スコア（正:perspective有利、負:相手有利）
 */
export function evaluateBoard(
  board: BoardState,
  perspective: "black" | "white",
  options?: LeafEvaluationOptions,
): number {
  incrementEvaluationCalls();
  const opponentColor = perspective === "black" ? "white" : "black";
  let myScore = 0;
  let opponentScore = 0;
  let myFourScore = 0;
  let myOpenThreeScore = 0;
  let opponentFourScore = 0;
  let opponentOpenThreeScore = 0;
  let myStoneCount = 0;
  let opponentStoneCount = 0;

  const connectivityBonus =
    options?.connectivityBonusValue ?? PATTERN_SCORES.CONNECTIVITY_BONUS;

  // 全ての石について評価
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }

      const { score, breakdown, activeDirectionCount } =
        evaluateStonePatternsWithBreakdown(board, row, col, stone);

      let adjustedScore = score;
      if (activeDirectionCount >= 2 && connectivityBonus > 0) {
        adjustedScore += connectivityBonus * (activeDirectionCount - 1);
      }

      if (stone === perspective) {
        myStoneCount++;
        myScore += adjustedScore;
        myFourScore += breakdown.four.final;
        myOpenThreeScore += breakdown.openThree.final;
      } else if (stone === opponentColor) {
        opponentStoneCount++;
        opponentScore += adjustedScore;
        opponentFourScore += breakdown.four.final;
        opponentOpenThreeScore += breakdown.openThree.final;
      }
    }
  }

  // 単発四ペナルティの適用
  const multiplier = options?.singleFourPenaltyMultiplier ?? 1.0;
  if (multiplier < 1.0) {
    // 四があるのに活三がない場合、四のスコアにペナルティを適用
    // 四三（四と活三の両方がある）場合はペナルティなし
    if (myFourScore > 0 && myOpenThreeScore === 0) {
      const penalty = myFourScore * (1 - multiplier);
      myScore -= penalty;
    }
    if (opponentFourScore > 0 && opponentOpenThreeScore === 0) {
      const penalty = opponentFourScore * (1 - multiplier);
      opponentScore -= penalty;
    }
  }

  // 四三脅威スキャン
  const threatBonus = PATTERN_SCORES.LEAF_FOUR_THREE_THREAT;
  if (threatBonus > 0) {
    if (scanFourThreeThreat(board, perspective, myStoneCount)) {
      myScore += threatBonus;
    }
    if (scanFourThreeThreat(board, opponentColor, opponentStoneCount)) {
      opponentScore += threatBonus;
    }
  }

  return myScore - opponentScore;
}

/**
 * 盤面全体を評価して内訳を返す（探索末端の評価用）
 *
 * @param board 盤面
 * @param perspective 評価の視点（CPUの色）
 * @returns 評価内訳
 */
export function evaluateBoardWithBreakdown(
  board: BoardState,
  perspective: "black" | "white",
): BoardEvaluationBreakdown {
  const opponentColor = perspective === "black" ? "white" : "black";

  const myBreakdown = emptyLeafPatternScores();
  const opponentBreakdown = emptyLeafPatternScores();

  // 全ての石について評価
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }

      const { score, breakdown, activeDirectionCount } =
        evaluateStonePatternsWithBreakdown(board, row, col, stone);

      let adjustedScore = score;
      if (activeDirectionCount >= 2) {
        adjustedScore +=
          PATTERN_SCORES.CONNECTIVITY_BONUS * (activeDirectionCount - 1);
      }

      if (stone === perspective) {
        myBreakdown.five += breakdown.five.final;
        myBreakdown.openFour += breakdown.openFour.final;
        myBreakdown.four += breakdown.four.final;
        myBreakdown.openThree += breakdown.openThree.final;
        myBreakdown.three += breakdown.three.final;
        myBreakdown.openTwo += breakdown.openTwo.final;
        myBreakdown.two += breakdown.two.final;
        myBreakdown.total += adjustedScore;
      } else if (stone === opponentColor) {
        opponentBreakdown.five += breakdown.five.final;
        opponentBreakdown.openFour += breakdown.openFour.final;
        opponentBreakdown.four += breakdown.four.final;
        opponentBreakdown.openThree += breakdown.openThree.final;
        opponentBreakdown.three += breakdown.three.final;
        opponentBreakdown.openTwo += breakdown.openTwo.final;
        opponentBreakdown.two += breakdown.two.final;
        opponentBreakdown.total += adjustedScore;
      }
    }
  }

  return {
    myScore: myBreakdown.total,
    opponentScore: opponentBreakdown.total,
    total: myBreakdown.total - opponentBreakdown.total,
    myBreakdown,
    opponentBreakdown,
  };
}
