/**
 * CPUロジック
 *
 * 探索アルゴリズムはZig/WASMに移行済み。
 * TS側は評価関数、開局パターン、候補手生成を提供する。
 */

export { PATTERN_SCORES } from "./evaluation";
export { isNearExistingStone } from "./moveGenerator";
export {
  getOpeningMove,
  getOpeningPatternInfo,
  isOpeningPhase,
  TENGEN,
} from "./opening";
