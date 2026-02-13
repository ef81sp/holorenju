/**
 * ヘッドレス対局エンジン（バレル）
 *
 * 後方互換のため、gameRunner / statistics からすべて再エクスポートする
 */

export { runHeadlessGame, runMultipleGames } from "./gameRunner.ts";

export type {
  GameOptions,
  GameResult,
  MoveRecord,
  PlayerConfig,
  SearchStatsRecord,
} from "./gameRunner.ts";

export { calculateStats } from "./statistics.ts";

export type { GameStats, ThinkingTimeStats } from "./statistics.ts";
