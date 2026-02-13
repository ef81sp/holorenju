/**
 * 盤面全体の評価関数
 *
 * 盤面上の全石のパターンスコアを集計し、
 * 視点プレイヤーの有利度を数値化する
 */

import type { BoardState } from "@/types/game";

import {
  type BoardEvaluationBreakdown,
  emptyLeafPatternScores,
  type LeafEvaluationOptions,
  PATTERN_SCORES,
} from "./patternScores";
import { evaluateStonePatternsWithBreakdown } from "./stonePatterns";

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
  const opponentColor = perspective === "black" ? "white" : "black";
  let myScore = 0;
  let opponentScore = 0;
  let myFourScore = 0;
  let myOpenThreeScore = 0;
  let opponentFourScore = 0;
  let opponentOpenThreeScore = 0;

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
        myScore += adjustedScore;
        myFourScore += breakdown.four.final;
        myOpenThreeScore += breakdown.openThree.final;
      } else if (stone === opponentColor) {
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
