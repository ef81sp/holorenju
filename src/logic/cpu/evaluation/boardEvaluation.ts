/**
 * 盤面全体の評価関数
 *
 * 盤面上の全石のパターンスコアを集計し、
 * 視点プレイヤーの有利度を数値化する
 */

import type { BoardState } from "@/types/game";

import type { LineTable } from "../lineTable/lineTable";

import { DIRECTIONS } from "../core/constants";
import {
  precomputedBlackFlags,
  precomputedBlackPatterns,
  precomputedWhiteFlags,
  precomputedWhitePatterns,
  precomputeLineFeatures,
} from "../lineTable/lineScan";
import { isNearExistingStone } from "../moveGenerator";
import { incrementEvaluationCalls } from "../profiling/counters";
import { countInDirection } from "./directionAnalysis";
import {
  type BoardEvaluationBreakdown,
  emptyLeafPatternScores,
  type LeafEvaluationOptions,
  PATTERN_SCORES,
} from "./patternScores";
import {
  evaluateStonePatternsLight,
  evaluateStonePatternsPrecomputed,
  evaluateStonePatternsWithBreakdown,
} from "./stonePatterns";
import { createsFourThree, createsFourThreeBit } from "./winningPatterns";

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

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

/**
 * 指定色の四三脅威をスキャン（Board走査フォールバック、lineTable なし時）
 * 空き交点に仮置きして四三が作れるか判定。最初の1件で打ち切り。
 */
function scanFourThreeThreat(
  board: BoardState,
  color: "black" | "white",
  stoneCount: number,
): boolean {
  if (stoneCount < 5) {
    return false;
  }
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
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
 * 事前計算フラグを使った四三脅威スキャン（lineTable あり時）
 *
 * precomputeLineFeatures で計算済みの四/三候補フラグを使い、
 * 候補セルのみを createsFourThreeBit で検証する。
 */
function scanFourThreeThreatFromFlags(
  board: BoardState,
  lineTable: LineTable,
  flags: Uint8Array,
  color: "black" | "white",
  stoneCount: number,
): boolean {
  if (stoneCount < 5) {
    return false;
  }
  for (let i = 0; i < 225; i++) {
    const f = flags[i] ?? 0;
    if (f === 0) {
      continue;
    }
    const fourDirs = f & 0x0f;
    const threeDirs = (f >> 4) & 0x0f;
    if (fourDirs && threeDirs) {
      const row = (i / 15) | 0;
      const col = i % 15;
      if (createsFourThreeBit(board, lineTable, row, col, color)) {
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
  lineTable?: LineTable,
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

  // ── 事前計算 ──
  if (lineTable) {
    precomputeLineFeatures(lineTable.blacks, lineTable.whites);
  }

  // perspective に対応する precomputed 配列を選択
  const myPatterns =
    perspective === "black"
      ? precomputedBlackPatterns
      : precomputedWhitePatterns;
  const oppPatterns =
    perspective === "black"
      ? precomputedWhitePatterns
      : precomputedBlackPatterns;

  // 全ての石について評価
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === null || stone === undefined) {
        continue;
      }

      const patterns = stone === perspective ? myPatterns : oppPatterns;
      const result = lineTable
        ? evaluateStonePatternsPrecomputed(board, row, col, stone, patterns)
        : evaluateStonePatternsLight(board, row, col, stone);

      let adjustedScore = result.score;
      if (result.activeDirectionCount >= 2 && connectivityBonus > 0) {
        adjustedScore += connectivityBonus * (result.activeDirectionCount - 1);
      }

      if (stone === perspective) {
        myStoneCount++;
        myScore += adjustedScore;
        myFourScore += result.fourScore;
        myOpenThreeScore += result.openThreeScore;
      } else if (stone === opponentColor) {
        opponentStoneCount++;
        opponentScore += adjustedScore;
        opponentFourScore += result.fourScore;
        opponentOpenThreeScore += result.openThreeScore;
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

  // テンポ補正: 直前着手者の活三を割引（奇偶振動抑制）
  if (options?.lastMoverIsPerspective !== undefined) {
    const discount = PATTERN_SCORES.TEMPO_OPEN_THREE_DISCOUNT;
    if (options.lastMoverIsPerspective) {
      myScore -= myOpenThreeScore * discount;
    } else {
      opponentScore -= opponentOpenThreeScore * discount;
    }
  }

  // 四三脅威スキャン
  const threatBonus = PATTERN_SCORES.LEAF_FOUR_THREE_THREAT;
  if (threatBonus > 0 && lineTable) {
    const myFlags =
      perspective === "black" ? precomputedBlackFlags : precomputedWhiteFlags;
    const oppFlags =
      perspective === "black" ? precomputedWhiteFlags : precomputedBlackFlags;
    if (
      scanFourThreeThreatFromFlags(
        board,
        lineTable,
        myFlags,
        perspective,
        myStoneCount,
      )
    ) {
      myScore += threatBonus;
    }
    if (
      scanFourThreeThreatFromFlags(
        board,
        lineTable,
        oppFlags,
        opponentColor,
        opponentStoneCount,
      )
    ) {
      opponentScore += threatBonus;
    }
  } else if (threatBonus > 0) {
    // Board走査フォールバック（lineTable なし時）
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
  lineTable?: LineTable,
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
        evaluateStonePatternsWithBreakdown(board, row, col, stone, lineTable);

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
