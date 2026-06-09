/**
 * 位置評価関数（review のスコア内訳表示専用）
 *
 * 指定位置に石を置いた場合の評価スコアと内訳を copyBoard 上で計算する。
 * （対局ホットパス版 evaluatePosition / evaluatePositionCore は Zig/WASM 化に伴い
 *  死蔵となり削除済み。対局評価は position_eval.zig が担う。）
 */

import type { BoardState, StoneColor } from "@/types/game";

import { checkFive, copyBoard } from "@/logic/renjuRules";

import {
  applyDefenseMultiplier,
  DEFENSE_MULTIPLIERS,
  getCenterBonus,
} from "./directionAnalysis";
import { analyzeJumpPatterns } from "./jumpPatterns";
import {
  DEFAULT_EVAL_OPTIONS,
  emptyPatternBreakdown,
  type EvaluationOptions,
  type MiseType,
  type PatternBreakdown,
  PATTERN_SCORES,
  type ScoreBreakdown,
} from "./patternScores";
import {
  evaluateStonePatterns,
  evaluateStonePatternsWithBreakdown,
} from "./stonePatterns";
import {
  checkWhiteWinningPattern,
  computeMiseBonus,
  evaluateForbiddenTrap,
  evaluateForbiddenVulnerability,
  hasFollowUpThreat,
  isFukumiMove,
} from "./tactics";
import { countThreatDirections, evaluateMultiThreat } from "./threatDetection";

/**
 * 指定位置に石を置いた場合の評価スコアと内訳を計算
 * デバッグ表示用
 */
export function evaluatePositionWithBreakdown(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  options: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
): { score: number; breakdown: ScoreBreakdown } {
  const defaultBreakdown: ScoreBreakdown = {
    pattern: emptyPatternBreakdown(),
    defense: emptyPatternBreakdown(),
    fourThree: 0,
    fukumi: 0,
    mise: 0,
    miseType: "none",
    center: 0,
    multiThreat: 0,
    defenseMultiThreat: 0,
    singleFourPenalty: 0,
    forbiddenTrap: 0,
    forbiddenVulnerability: 0,
  };

  if (color === null) {
    return { score: 0, breakdown: defaultBreakdown };
  }

  // 五連チェック（最優先）
  if (checkFive(board, row, col, color)) {
    const fiveBreakdown = emptyPatternBreakdown();
    fiveBreakdown.five = {
      base: PATTERN_SCORES.FIVE,
      diagonalBonus: 0,
      final: PATTERN_SCORES.FIVE,
    };
    return {
      score: PATTERN_SCORES.FIVE,
      breakdown: {
        ...defaultBreakdown,
        pattern: fiveBreakdown,
      },
    };
  }

  // 仮想的に石を置いた盤面でパターンを評価
  const testBoard = copyBoard(board);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 白の三三・四四チェック
  if (color === "white" && checkWhiteWinningPattern(testBoard, row, col)) {
    const fiveBreakdown = emptyPatternBreakdown();
    fiveBreakdown.five = {
      base: PATTERN_SCORES.FIVE,
      diagonalBonus: 0,
      final: PATTERN_SCORES.FIVE,
    };
    return {
      score: PATTERN_SCORES.FIVE,
      breakdown: {
        ...defaultBreakdown,
        pattern: fiveBreakdown,
      },
    };
  }

  // 攻撃スコア: 自分のパターン（内訳付き）
  const { breakdown: patternBreakdown } = evaluateStonePatternsWithBreakdown(
    testBoard,
    row,
    col,
    color,
  );

  const opponentColor = color === "black" ? "white" : "black";

  // 四三ボーナス
  const jumpResult = analyzeJumpPatterns(testBoard, row, col, color);
  let fourThreeBonus = 0;
  if (jumpResult.hasFour && jumpResult.hasValidOpenThree) {
    fourThreeBonus = PATTERN_SCORES.FOUR_THREE_BONUS;
  }

  // フクミ手ボーナス
  let fukumiBonus = 0;
  const attackScore = evaluateStonePatterns(testBoard, row, col, color);

  // ミセ手ボーナス
  // fourThreeBonus > 0 なら四三が既にあるためミセ計算をスキップ（二重加算防止）
  // attackScore >= OPEN_FOUR なら活四以上で既に勝ちなのでスキップ
  let miseBonus = 0;
  if (
    options.enableMise &&
    fourThreeBonus === 0 &&
    attackScore < PATTERN_SCORES.OPEN_FOUR
  ) {
    miseBonus = computeMiseBonus(testBoard, row, col, color);
  }
  if (
    options.enableFukumi &&
    attackScore < PATTERN_SCORES.OPEN_FOUR &&
    isFukumiMove(testBoard, color)
  ) {
    fukumiBonus = PATTERN_SCORES.FUKUMI_BONUS;
  }

  // 複数方向脅威ボーナス
  let multiThreatBonus = 0;
  if (options.enableMultiThreat) {
    const threatCount = countThreatDirections(testBoard, row, col, color);
    multiThreatBonus = evaluateMultiThreat(threatCount);
  }

  // 禁手追い込みボーナス（白番のみ）
  let forbiddenTrapBonus = 0;
  if (options.enableForbiddenTrap && color === "white") {
    forbiddenTrapBonus = evaluateForbiddenTrap(testBoard, row, col);
  }

  // 禁手脆弱性ペナルティ（黒番のみ）
  let forbiddenVulnerabilityPenalty = 0;
  if (options.enableForbiddenVulnerability && color === "black") {
    forbiddenVulnerabilityPenalty = evaluateForbiddenVulnerability(
      testBoard,
      row,
      col,
    );
  }

  // 単発四ペナルティ: 四を作るが四三ではなく、後続脅威もない場合
  let singleFourPenalty = 0;
  if (options.enableSingleFourPenalty) {
    // 四を作るが四三ではない場合
    if (jumpResult.hasFour && !jumpResult.hasValidOpenThree) {
      // 後続脅威がない場合のみペナルティ
      if (!hasFollowUpThreat(testBoard, row, col, color)) {
        // FOURスコアにペナルティ適用（倍率は難易度で設定）
        const fourCount =
          jumpResult.jumpFourCount > 0 ? jumpResult.jumpFourCount : 1;
        singleFourPenalty =
          PATTERN_SCORES.FOUR *
          fourCount *
          (1 - options.singleFourPenaltyMultiplier);
      }
    }
  }

  // 中央ボーナス
  const centerBonus = getCenterBonus(row, col);

  // 防御スコア（相手のパターンを阻止）
  // testBoardを再利用: 自分の石を消して相手の石を置く
  if (testRow) {
    testRow[col] = opponentColor;
  }
  const { breakdown: opponentPatternBreakdown } =
    evaluateStonePatternsWithBreakdown(testBoard, row, col, opponentColor);

  // 防御交差点ボーナス: 相手が置くと2方向以上の脅威になる位置の防御価値
  let defenseMultiThreatBonus = 0;
  if (options.enableMultiThreat) {
    const defThreatCount = countThreatDirections(
      testBoard,
      row,
      col,
      opponentColor,
    );
    if (defThreatCount >= 2) {
      defenseMultiThreatBonus =
        PATTERN_SCORES.DEFENSE_MULTI_THREAT_BONUS * (defThreatCount - 1);
    }
  }

  // 元に戻す（自分の石を戻す）
  if (testRow) {
    testRow[col] = color;
  }

  // 防御内訳（脅威レベル別倍率を適用）
  const defenseBreakdown: PatternBreakdown = {
    five: applyDefenseMultiplier(
      opponentPatternBreakdown.five,
      DEFENSE_MULTIPLIERS.five,
    ),
    openFour: applyDefenseMultiplier(
      opponentPatternBreakdown.openFour,
      DEFENSE_MULTIPLIERS.openFour,
    ),
    four: applyDefenseMultiplier(
      opponentPatternBreakdown.four,
      DEFENSE_MULTIPLIERS.four,
    ),
    openThree: applyDefenseMultiplier(
      opponentPatternBreakdown.openThree,
      DEFENSE_MULTIPLIERS.openThree,
    ),
    three: applyDefenseMultiplier(
      opponentPatternBreakdown.three,
      DEFENSE_MULTIPLIERS.three,
    ),
    openTwo: applyDefenseMultiplier(
      opponentPatternBreakdown.openTwo,
      DEFENSE_MULTIPLIERS.openTwo,
    ),
    two: applyDefenseMultiplier(
      opponentPatternBreakdown.two,
      DEFENSE_MULTIPLIERS.two,
    ),
  };

  // 内訳の合計を計算（表示と一致させる）
  const sumPatternBreakdown = (breakdown: PatternBreakdown): number =>
    breakdown.five.final +
    breakdown.openFour.final +
    breakdown.four.final +
    breakdown.openThree.final +
    breakdown.three.final +
    breakdown.openTwo.final +
    breakdown.two.final;

  const patternTotal = sumPatternBreakdown(patternBreakdown);
  const defenseTotal = sumPatternBreakdown(defenseBreakdown);

  const totalScore =
    patternTotal +
    defenseTotal +
    centerBonus +
    fourThreeBonus +
    miseBonus +
    fukumiBonus +
    multiThreatBonus +
    defenseMultiThreatBonus +
    forbiddenTrapBonus -
    singleFourPenalty -
    forbiddenVulnerabilityPenalty;

  // miseType を導出
  let miseType: MiseType = "none";
  if (miseBonus >= PATTERN_SCORES.DOUBLE_MISE_BONUS) {
    miseType = "double-mise";
  } else if (miseBonus > 0) {
    miseType = "mise";
  }

  return {
    score: totalScore,
    breakdown: {
      pattern: patternBreakdown,
      defense: defenseBreakdown,
      fourThree: fourThreeBonus,
      fukumi: fukumiBonus,
      mise: miseBonus,
      miseType,
      center: centerBonus,
      multiThreat: multiThreatBonus,
      defenseMultiThreat: defenseMultiThreatBonus,
      singleFourPenalty: singleFourPenalty,
      forbiddenTrap: forbiddenTrapBonus,
      forbiddenVulnerability: forbiddenVulnerabilityPenalty,
    },
  };
}
