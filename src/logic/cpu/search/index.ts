/**
 * CPU探索モジュール
 *
 * 探索アルゴリズムはZig/WASMに移行済み。
 * TS側はボードプリミティブ（脅威検出・検証）と型定義を提供する。
 */

// 型定義
export type {
  VCFSearchOptions,
  VCFSequenceResult,
  VCTSearchOptions,
  VCTSequenceResult,
  MiseVCFSearchOptions,
  MoveScoreEntry,
  IterativeDeepingResult,
  SearchStats,
} from "./types";
export { VCT_STONE_THRESHOLD } from "./types";

// 時間制限
export type { TimeLimiter } from "./timeLimiter";
export { isTimeExceeded, incrementNodes } from "./timeLimiter";

// VCF存在判定
export { hasVCF } from "./vcfCheck";

// 脅威パターン
export {
  type FourDefense,
  findFourMoves,
  findWinningMove,
  fourDefenseBlock,
  getFourDefensePosition,
  checkDefenseCounterThreat,
} from "./threatPatterns";

// 脅威手
export { createsFour } from "./threatMoves";

// VCTヘルパー
export {
  findThreatMoves,
  hasFourThreeAvailable,
  hasOpenThree,
} from "./vctHelpers";

// VCT検証
export { validateVCTSequence } from "./vctValidation";
