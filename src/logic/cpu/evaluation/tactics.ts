/**
 * 戦術評価 - バレルモジュール
 *
 * 禁手追い込み・勝利パターン・ミセ手・フクミ手などの戦術的評価。
 * 各サブモジュールからre-exportする。
 */

// 禁手追い込み戦術
export {
  evaluateForbiddenTrap,
  evaluateForbiddenVulnerability,
  getLineEndPoints,
  hasMixedForbiddenPoints,
} from "./forbiddenTactics";

// 勝利パターン検出
export { checkWhiteWinningPattern, createsFourThree } from "./winningPatterns";

// ミセ手戦術
export {
  findMiseTargets,
  findMiseTargetsLite,
  hasPotentialMiseTarget,
  isMiseMove,
} from "./miseTactics";

// 後続脅威評価
export {
  canContinueFourAfterDefense,
  hasFollowUpThreat,
  isFukumiMove,
} from "./followUpThreats";
