/**
 * CPUベンチマーク公開インターフェース
 */

export {
  calculateExpectedScore,
  createInitialRating,
  formatRating,
  updateRating,
  updateRatings,
} from "./rating.ts";

export type { EloRating, GameOutcome, RatingConfig } from "./rating.ts";

export {
  calculateStats,
  runHeadlessGame,
  runMultipleGames,
} from "./headless.ts";

export type {
  GameOptions,
  GameResult,
  GameStats,
  MoveRecord,
  PlayerConfig,
  SearchStatsRecord,
  ThinkingTimeStats,
} from "./headless.ts";
