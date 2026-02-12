/**
 * 盤面評価関数
 *
 * 独自のパターンカウント関数を使用してスコアリングを行う
 */

import type { BoardState, StoneColor } from "@/types/game";

import { incrementEvaluationCalls } from "@/logic/cpu/profiling/counters";
import { checkFive, copyBoard } from "@/logic/renjuRules";

import { DIRECTIONS } from "../core/constants";
import {
  analyzeDirection,
  applyDefenseMultiplier,
  DEFENSE_MULTIPLIERS,
  getCenterBonus,
  getPatternScore,
  getPatternType,
} from "./directionAnalysis";
import { analyzeJumpPatterns, getJumpPatternScore } from "./jumpPatterns";
import {
  type BoardEvaluationBreakdown,
  DEFAULT_EVAL_OPTIONS,
  emptyLeafPatternScores,
  emptyPatternBreakdown,
  type EvaluationOptions,
  type LeafEvaluationOptions,
  type LeafPatternScores,
  type PatternBreakdown,
  PATTERN_SCORES,
  type PatternScoreDetail,
  type ScoreBreakdown,
  type ThreatInfo,
} from "./patternScores";
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

// Re-export all types and constants
export {
  type BoardEvaluationBreakdown,
  DEFAULT_EVAL_OPTIONS,
  type EvaluationOptions,
  FULL_EVAL_OPTIONS,
  type LeafEvaluationOptions,
  type LeafPatternScores,
  type PatternBreakdown,
  PATTERN_SCORES,
  type PatternScoreDetail,
  type ScoreBreakdown,
  type ThreatInfo,
} from "./patternScores";
export { detectOpponentThreats } from "./threatDetection";

/**
 * 指定位置の石について全方向のパターンスコアを計算
 * 連続パターンと跳びパターンの両方を評価
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param color 石の色
 * @returns 全方向のスコア合計
 */
export function evaluateStonePatterns(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): number {
  let score = 0;

  // 連続パターンのスコア
  // DIRECTIONSのインデックス: 0=横, 1=縦, 2=右下斜め, 3=右上斜め
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    let dirScore = getPatternScore(pattern);

    // 斜め方向（インデックス2,3）にボーナスを適用
    if ((i === 2 || i === 3) && dirScore > 0) {
      dirScore = Math.round(
        dirScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
    }

    score += dirScore;
  }

  // 跳びパターンのスコア
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  score += getJumpPatternScore(jumpResult);

  return score;
}

/**
 * 石のパターンを評価し、内訳も返す
 */
export function evaluateStonePatternsWithBreakdown(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): {
  score: number;
  breakdown: PatternBreakdown;
  activeDirectionCount: number;
} {
  let score = 0;
  const breakdown: PatternBreakdown = emptyPatternBreakdown();
  let activeDirectionCount = 0;

  // 連続パターンのスコア
  for (let i = 0; i < DIRECTIONS.length; i++) {
    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    const baseScore = getPatternScore(pattern);
    const patternType = getPatternType(pattern);

    if (baseScore > 0) {
      activeDirectionCount++;
    }

    // 斜め方向（インデックス2,3）にボーナスを適用
    const isDiagonal = i === 2 || i === 3;
    let finalScore = baseScore;
    let diagonalBonus = 0;

    if (isDiagonal && baseScore > 0) {
      finalScore = Math.round(
        baseScore * PATTERN_SCORES.DIAGONAL_BONUS_MULTIPLIER,
      );
      diagonalBonus = finalScore - baseScore;
    }

    score += finalScore;

    // 内訳に追加
    if (patternType) {
      breakdown[patternType].base += baseScore;
      breakdown[patternType].diagonalBonus += diagonalBonus;
      breakdown[patternType].final += finalScore;
    }
  }

  // 跳びパターンのスコア
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  const jumpScore = getJumpPatternScore(jumpResult);
  score += jumpScore;

  // 跳び四は四に、跳び三は活三に加算（跳びパターンは斜めボーナスなし）
  if (jumpResult.jumpFourCount > 0) {
    const jumpFourScore = PATTERN_SCORES.FOUR * jumpResult.jumpFourCount;
    breakdown.four.base += jumpFourScore;
    breakdown.four.final += jumpFourScore;
  }
  if (jumpResult.hasValidOpenThree) {
    breakdown.openThree.base += PATTERN_SCORES.OPEN_THREE;
    breakdown.openThree.final += PATTERN_SCORES.OPEN_THREE;
  }

  return { score, breakdown, activeDirectionCount };
}

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

  // 白の三三・四四チェック（白には禁手がないため即勝利）
  if (color === "white" && checkWhiteWinningPattern(board, row, col)) {
    return PATTERN_SCORES.FIVE;
  }

  // 攻撃スコア: 自分のパターン
  const attackScore = evaluateStonePatterns(board, row, col, color);

  // 四三ボーナス: 四と有効な活三を同時に作る手
  const jumpResult = analyzeJumpPatterns(board, row, col, color);
  let fourThreeBonus = 0;
  if (jumpResult.hasFour && jumpResult.hasValidOpenThree) {
    fourThreeBonus = PATTERN_SCORES.FOUR_THREE_BONUS;
  }

  // 必須防御ルール: 相手の活四・活三を止めない手は除外
  if (options.enableMandatoryDefense) {
    // 事前計算された脅威情報があればそれを使用（最適化）
    let threats: ThreatInfo = options.precomputedThreats ?? {
      openFours: [],
      fours: [],
      openThrees: [],
      mises: [],
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
      const isDefendingOpenFour = threats.openFours.some(
        (p) => p.row === row && p.col === col,
      );
      if (!isDefendingOpenFour) {
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
      const isDefendingFour = threats.fours.some(
        (p) => p.row === row && p.col === col,
      );
      if (!isDefendingFour) {
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
      const isDefendingOpenThree = threats.openThrees.some(
        (p) => p.row === row && p.col === col,
      );
      if (!isDefendingOpenThree) {
        return -Infinity;
      }

      // 活三を止めつつミセ手も止める必要がある
      if (options.enableMiseThreat && threats.mises.length > 0) {
        const isDefendingMise = threats.mises.some(
          (p) => p.row === row && p.col === col,
        );
        // ミセ手を止めていない、かつ両方を止める手が存在する場合のみ除外
        if (
          !isDefendingMise &&
          hasDefenseThatBlocksBoth(threats.openThrees, threats.mises)
        ) {
          return -Infinity;
        }
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
      const isDefendingMise = threats.mises.some(
        (p) => p.row === row && p.col === col,
      );
      if (!isDefendingMise) {
        return -Infinity;
      }
    }
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

  // フクミ手ボーナス: ルートレベルでのみ判定するため、評価関数内では無効化
  // 理由: isFukumiMove(hasVCF)は計算コストが高い
  const fukumiBonus = 0;

  // 複数方向脅威ボーナス: 2方向以上で脅威を作る手（オプションで有効時のみ）
  let multiThreatBonus = 0;
  if (options.enableMultiThreat) {
    const threatCount = countThreatDirections(board, row, col, color);
    multiThreatBonus = evaluateMultiThreat(threatCount);
  }

  // VCTボーナス: ルートレベルでのみ判定するため、評価関数内では無効化
  // 理由: 各ノードでVCT探索を実行すると計算コストが爆発的に増加
  // 代わりに findBestMoveIterativeWithTT でルートの候補手に対してのみVCT判定
  const vctBonus = 0;

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

  // この位置に相手が置いた場合のスコアを計算（ブロック価値）
  // boardを再利用: 自分の石を消して相手の石を置く
  if (boardRow) {
    boardRow[col] = opponentColor;
  }
  const { score: opponentPatternScore, breakdown: opponentBreakdown } =
    evaluateStonePatternsWithBreakdown(board, row, col, opponentColor);
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
    fukumiBonus +
    multiThreatBonus +
    vctBonus -
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
      singleFourPenalty: singleFourPenalty,
      forbiddenTrap: forbiddenTrapBonus,
      forbiddenVulnerability: forbiddenVulnerabilityPenalty,
    },
  };
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
