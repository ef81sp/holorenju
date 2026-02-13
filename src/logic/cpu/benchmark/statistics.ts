/**
 * 対局統計計算
 *
 * 対局結果から統計情報を算出する純粋関数群
 */

import type { GameResult } from "./gameRunner.ts";

/**
 * 思考時間統計
 */
export interface ThinkingTimeStats {
  /** 平均思考時間（ミリ秒） */
  avg: number;
  /** 最小思考時間（ミリ秒） */
  min: number;
  /** 最大思考時間（ミリ秒） */
  max: number;
  /** 中央値思考時間（ミリ秒） */
  median: number;
  /** 着手数 */
  count: number;
}

/**
 * 対局統計を計算
 */
export interface GameStats {
  /** 総対局数 */
  total: number;
  /** プレイヤーA勝利数 */
  winsA: number;
  /** プレイヤーB勝利数 */
  winsB: number;
  /** 引き分け数 */
  draws: number;
  /** プレイヤーA勝率 */
  winRateA: number;
  /** 平均手数 */
  avgMoves: number;
  /** 平均対局時間（ミリ秒） */
  avgDuration: number;
  /** プレイヤーA思考時間統計 */
  thinkingTimeA: ThinkingTimeStats;
  /** プレイヤーB思考時間統計 */
  thinkingTimeB: ThinkingTimeStats;
}

/**
 * 思考時間統計を計算するヘルパー関数
 */
function calculateThinkingTimeStats(times: number[]): ThinkingTimeStats {
  if (times.length === 0) {
    return { avg: 0, min: 0, max: 0, median: 0, count: 0 };
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, t) => acc + t, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  return {
    avg: sum / sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    median,
    count: sorted.length,
  };
}

/**
 * 対局結果から統計を計算
 *
 * @param results 対局結果の配列
 * @returns 統計情報
 */
export function calculateStats(results: GameResult[]): GameStats {
  const emptyThinkingStats: ThinkingTimeStats = {
    avg: 0,
    min: 0,
    max: 0,
    median: 0,
    count: 0,
  };

  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      winsA: 0,
      winsB: 0,
      draws: 0,
      winRateA: 0,
      avgMoves: 0,
      avgDuration: 0,
      thinkingTimeA: emptyThinkingStats,
      thinkingTimeB: emptyThinkingStats,
    };
  }

  const winsA = results.filter((r) => r.winner === "A").length;
  const winsB = results.filter((r) => r.winner === "B").length;
  const draws = results.filter((r) => r.winner === "draw").length;
  const totalMoves = results.reduce((sum, r) => sum + r.moves, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  // プレイヤーごとの思考時間を集計
  // isABlack=true: 偶数インデックス=A（黒）、奇数インデックス=B（白）
  // isABlack=false: 偶数インデックス=B（黒）、奇数インデックス=A（白）
  const timesA: number[] = [];
  const timesB: number[] = [];

  for (const result of results) {
    for (let i = 0; i < result.moveHistory.length; i++) {
      const move = result.moveHistory[i];
      if (!move) {
        continue;
      }

      const isEvenIndex = i % 2 === 0;
      // 偶数インデックス = 黒番の手
      const isBlackMove = isEvenIndex;

      // A が黒番: 黒の手は A、白の手は B
      // A が白番: 黒の手は B、白の手は A
      const isPlayerAMove = result.isABlack === isBlackMove;
      if (isPlayerAMove) {
        timesA.push(move.time);
      } else {
        timesB.push(move.time);
      }
    }
  }

  return {
    total,
    winsA,
    winsB,
    draws,
    winRateA: winsA / total,
    avgMoves: totalMoves / total,
    avgDuration: totalDuration / total,
    thinkingTimeA: calculateThinkingTimeStats(timesA),
    thinkingTimeB: calculateThinkingTimeStats(timesB),
  };
}
