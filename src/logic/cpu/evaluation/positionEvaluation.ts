/**
 * 位置評価関数
 *
 * 指定位置に石を置いた場合の評価スコアを計算
 * インプレース変更によるホットパス版 (evaluatePosition / evaluatePositionCore) と
 * copyBoard を使う安全版 (evaluatePositionWithBreakdown) を提供
 */

import type { BoardState, StoneColor } from "@/types/game";

import { incrementEvaluationCalls } from "@/logic/cpu/profiling/counters";
import { checkFive, copyBoard } from "@/logic/renjuRules";

import { includesPosition } from "../core/boardUtils";
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
  type PatternBreakdown,
  PATTERN_SCORES,
  type ScoreBreakdown,
  type ThreatInfo,
} from "./patternScores";
import {
  evaluateStonePatterns,
  evaluateStonePatternsWithBreakdown,
} from "./stonePatterns";
import {
  checkWhiteWinningPattern,
  evaluateForbiddenTrap,
  evaluateForbiddenVulnerability,
  hasFollowUpThreat,
  isFukumiMove,
  isMiseMove,
} from "./tactics";
import {
  countThreatDirections,
  detectOpponentThreats,
  evaluateMultiThreat,
  hasDefenseThatBlocksBoth,
} from "./threatDetection";

/**
 * 指定位置に石を置いた場合の評価スコアを計算
 *
 * @param board 現在の盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @param options 評価オプション（省略時はデフォルト=高速モード）
 * @returns 評価スコア
 */
export function evaluatePosition(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
  options: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
): number {
  // プロファイリング: 評価関数呼び出し回数をカウント
  incrementEvaluationCalls();

  if (color === null) {
    return 0;
  }

  // 五連チェック（最優先、盤面変更前に実行）
  if (checkFive(board, row, col, color)) {
    return PATTERN_SCORES.FIVE;
  }

  // インプレースで石を配置
  const boardRow = board[row];
  if (boardRow) {
    boardRow[col] = color;
  }

  // 内部関数で全評価ロジックを実行（early returnが自由にできる）
  const score = evaluatePositionCore(board, boardRow, row, col, color, options);

  // 確実にUndoする（唯一のUndoポイント）
  if (boardRow) {
    boardRow[col] = null;
  }
  return score;
}

function evaluatePositionCore(
  board: BoardState,
  boardRow: (StoneColor | null)[] | undefined,
  row: number,
  col: number,
  color: "black" | "white",
  options: EvaluationOptions,
): number {
  const opponentColor = color === "black" ? "white" : "black";

  // 攻撃スコア: 自分のパターン
  const attackScore = evaluateStonePatterns(board, row, col, color);

  // 四三ボーナス: 四と有効な活三を同時に作る手
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  let fourThreeBonus = 0;
  if (jumpResult.hasFour && jumpResult.hasValidOpenThree) {
    fourThreeBonus = PATTERN_SCORES.FOUR_THREE_BONUS;
  }

  // 必須防御ルール: 相手の活四・活三を止めない手は除外
  // 白の三三・四四チェックよりも先に評価（相手の脅威を放置すると先に負ける）
  if (options.enableMandatoryDefense) {
    // 事前計算された脅威情報があればそれを使用（最適化）
    let threats: ThreatInfo = options.precomputedThreats ?? {
      openFours: [],
      fours: [],
      openThrees: [],
      mises: [],
      doubleThrees: [],
    };
    if (!options.precomputedThreats) {
      // Undo → detectOpponentThreats → Redo（元の盤面で脅威を検出する必要がある）
      if (boardRow) {
        boardRow[col] = null;
      }
      threats = detectOpponentThreats(board, opponentColor);
      if (boardRow) {
        boardRow[col] = color;
      }
    }

    // 自分が活四を持っているか（相手の四があっても勝てる唯一の手段）
    // 相手に四がある場合、自分の活四のみが例外（四三でも相手の四を止められない）
    const hasMyOpenFour = attackScore >= PATTERN_SCORES.OPEN_FOUR;

    // 自分が先に勝てるかチェック（活四または四三）
    // 注: これは相手の活三・ミセに対してのみ有効。相手の四に対しては活四のみが例外
    const canWinFirst = hasMyOpenFour || fourThreeBonus > 0;

    // 相手の活四を止めない手は除外（例外: 自分の活四のみ）
    if (threats.openFours.length > 0 && !hasMyOpenFour) {
      if (!includesPosition(threats.openFours, row, col)) {
        return -Infinity;
      }
    }

    // 相手の止め四を止めない手は除外（例外: 自分の活四のみ）
    // 四三でも相手の止め四より先に勝てない（止め四は次に五連になる）
    if (
      threats.fours.length > 0 &&
      threats.openFours.length === 0 &&
      !hasMyOpenFour
    ) {
      if (!includesPosition(threats.fours, row, col)) {
        return -Infinity;
      }
    }

    // 相手の活三を止めない手は除外（活四・止め四がない場合）
    // 活三 → 活四 → 負け確定なので、ミセより優先度が高い
    if (
      threats.openThrees.length > 0 &&
      threats.openFours.length === 0 &&
      threats.fours.length === 0 &&
      !canWinFirst
    ) {
      if (!includesPosition(threats.openThrees, row, col)) {
        return -Infinity;
      }

      // 活三を止めつつミセ手も止める必要がある
      if (options.enableMiseThreat && threats.mises.length > 0) {
        // ミセ手を止めていない、かつ両方を止める手が存在する場合のみ除外
        if (
          !includesPosition(threats.mises, row, col) &&
          hasDefenseThatBlocksBoth(threats.openThrees, threats.mises)
        ) {
          return -Infinity;
        }
      }
    }

    // 相手の三三脅威を止めない手は除外（活四・止め四・活三がない場合）
    // 三三成立 = 両方の活三を止められず2手後に勝利確定（防御不能）
    // 脅威位置が2箇所以上あると1手で防御不能なので、1箇所のときのみ適用
    if (
      options.enableDoubleThreeThreat &&
      threats.doubleThrees.length === 1 &&
      threats.openFours.length === 0 &&
      threats.fours.length === 0 &&
      threats.openThrees.length === 0 &&
      !canWinFirst
    ) {
      if (!includesPosition(threats.doubleThrees, row, col)) {
        return -Infinity;
      }
    }

    // 相手のミセ手を止めない手は除外（活四・止め四・活三がない場合）
    // ミセ → 四三はまだ止められる可能性があるが、放置すると危険
    if (
      options.enableMiseThreat &&
      threats.mises.length > 0 &&
      threats.openFours.length === 0 &&
      threats.fours.length === 0 &&
      threats.openThrees.length === 0 &&
      !canWinFirst
    ) {
      if (!includesPosition(threats.mises, row, col)) {
        return -Infinity;
      }
    }
  }

  // 白の三三・四四チェック（白には禁手がないため即勝利）
  // mandatory defense を通過した手のみが到達する（防御義務を果たした上での勝利パターン）
  if (color === "white" && checkWhiteWinningPattern(board, row, col)) {
    return PATTERN_SCORES.FIVE;
  }

  // 禁手追い込みボーナス（白番のみ、オプションで有効時のみ）
  let forbiddenTrapBonus = 0;
  if (options.enableForbiddenTrap && color === "white") {
    forbiddenTrapBonus = evaluateForbiddenTrap(board, row, col);
  }

  // 禁手脆弱性ペナルティ（黒番のみ）
  let forbiddenVulnerabilityPenalty = 0;
  if (options.enableForbiddenVulnerability && color === "black") {
    forbiddenVulnerabilityPenalty = evaluateForbiddenVulnerability(
      board,
      row,
      col,
    );
  }

  // ミセ手ボーナス: 次に四三を作れる手（オプションで有効時のみ）
  let miseBonus = 0;
  if (options.enableMise && isMiseMove(board, row, col, color)) {
    miseBonus = PATTERN_SCORES.MISE_BONUS;
  }

  // 複数方向脅威ボーナス: 2方向以上で脅威を作る手（オプションで有効時のみ）
  let multiThreatBonus = 0;
  if (options.enableMultiThreat) {
    const threatCount = countThreatDirections(board, row, col, color);
    multiThreatBonus = evaluateMultiThreat(threatCount);
  }

  // 単発四ペナルティ: 四を作るが四三ではなく、後続脅威もない場合
  let singleFourPenalty = 0;
  if (options.enableSingleFourPenalty) {
    // 四を作るが四三ではない場合
    if (jumpResult.hasFour && !jumpResult.hasValidOpenThree) {
      // 後続脅威がない場合のみペナルティ
      if (!hasFollowUpThreat(board, row, col, color)) {
        // FOURスコアにペナルティ適用（倍率は難易度で設定）
        // multiplier=0.0なら1000点全て減点、multiplier=0.1なら900点減点
        const fourCount =
          jumpResult.jumpFourCount > 0 ? jumpResult.jumpFourCount : 1;
        singleFourPenalty =
          PATTERN_SCORES.FOUR *
          fourCount *
          (1 - options.singleFourPenaltyMultiplier);
      }
    }
  }

  // 防御スコア: 相手の脅威をブロック
  let defenseScore = 0;
  let defenseMultiThreatBonus = 0;

  // この位置に相手が置いた場合のスコアを計算（ブロック価値）
  // boardを再利用: 自分の石を消して相手の石を置く
  if (boardRow) {
    boardRow[col] = opponentColor;
  }
  const { score: opponentPatternScore, breakdown: opponentBreakdown } =
    evaluateStonePatternsWithBreakdown(board, row, col, opponentColor);

  // 防御交差点ボーナス: 相手が置くと2方向以上の脅威になる位置の防御価値
  if (options.enableMultiThreat) {
    const defThreatCount = countThreatDirections(
      board,
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
  if (boardRow) {
    boardRow[col] = color;
  }

  // 脅威レベル別の防御倍率を適用
  defenseScore =
    Math.round(opponentBreakdown.five.final * DEFENSE_MULTIPLIERS.five) +
    Math.round(
      opponentBreakdown.openFour.final * DEFENSE_MULTIPLIERS.openFour,
    ) +
    Math.round(opponentBreakdown.four.final * DEFENSE_MULTIPLIERS.four) +
    Math.round(
      opponentBreakdown.openThree.final * DEFENSE_MULTIPLIERS.openThree,
    ) +
    Math.round(opponentBreakdown.three.final * DEFENSE_MULTIPLIERS.three) +
    Math.round(opponentBreakdown.openTwo.final * DEFENSE_MULTIPLIERS.openTwo) +
    Math.round(opponentBreakdown.two.final * DEFENSE_MULTIPLIERS.two);

  // カウンターフォー: 防御しながら四を作る手（オプションで有効時のみ）
  // 自分が四以上を作り、相手が活三以上を持っていた場合、防御スコアを1.5倍
  if (options.enableCounterFour) {
    if (
      attackScore >= PATTERN_SCORES.FOUR &&
      opponentPatternScore >= PATTERN_SCORES.OPEN_THREE
    ) {
      defenseScore *= PATTERN_SCORES.COUNTER_FOUR_MULTIPLIER;
    }
  }

  // 中央ボーナスを追加
  const centerBonus = getCenterBonus(row, col);

  return (
    attackScore +
    defenseScore +
    centerBonus +
    fourThreeBonus +
    forbiddenTrapBonus +
    miseBonus +
    multiThreatBonus +
    defenseMultiThreatBonus -
    singleFourPenalty -
    forbiddenVulnerabilityPenalty
  );
}

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

  // ミセ手ボーナス
  let miseBonus = 0;
  if (options.enableMise && isMiseMove(testBoard, row, col, color)) {
    miseBonus = PATTERN_SCORES.MISE_BONUS;
  }

  // フクミ手ボーナス
  let fukumiBonus = 0;
  const attackScore = evaluateStonePatterns(testBoard, row, col, color);
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

  return {
    score: totalScore,
    breakdown: {
      pattern: patternBreakdown,
      defense: defenseBreakdown,
      fourThree: fourThreeBonus,
      fukumi: fukumiBonus,
      mise: miseBonus,
      center: centerBonus,
      multiThreat: multiThreatBonus,
      defenseMultiThreat: defenseMultiThreatBonus,
      singleFourPenalty: singleFourPenalty,
      forbiddenTrap: forbiddenTrapBonus,
      forbiddenVulnerability: forbiddenVulnerabilityPenalty,
    },
  };
}
