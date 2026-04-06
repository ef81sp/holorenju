/**
 * コミット間ベンチマーク比較の型定義
 */

import type { CpuDifficulty } from "../../src/types/cpu.ts";
import type { GameResult } from "../commit-game-runner.ts";
import type { EloDiffResult, SPRTConfig, SPRTState, WDLCount } from "./ab.ts";

/** 珠型名付き対局結果 */
export interface CommitGameResult extends GameResult {
  jushuName: string;
}

/** コミット情報 */
export interface CommitInfo {
  /** フルSHA */
  sha: string;
  /** 短縮SHA（7文字） */
  shortSha: string;
  /** コミットメッセージ */
  message: string;
  /** コミット日時 */
  date: string;
}

/** プレイヤーごとの性能統計 */
export interface PlayerPerformanceStats {
  /** 探索した手数（開局除く） */
  searchedMoves: number;
  /** 平均到達深度 */
  avgDepth: number;
  /** 最大到達深度 */
  maxDepth: number;
  /** 平均思考時間（ms） */
  avgThinkingTime: number;
}

/** コミット間ベンチマーク結果 */
export interface CommitBenchResult {
  type: "commit-bench";
  /** タイムスタンプ */
  timestamp: string;
  /** commitA情報 */
  commitA: CommitInfo;
  /** commitB情報 */
  commitB: CommitInfo;
  /** 設定 */
  config: {
    difficulty: CpuDifficulty;
    sets: number;
    gamesPerSet: number;
    randomFactor?: number;
    sprt: SPRTConfig | null;
  };
  /** 対局数 */
  totalGames: number;
  /** WDL（commitA視点） */
  wdl: WDLCount;
  /** Elo差推定 */
  eloDiff: EloDiffResult;
  /** SPRT状態（SPRT有効時のみ） */
  sprt: SPRTState | null;
  /** 個別対局結果（棋譜付き） */
  games: CommitGameResult[];
  /** 所要時間（秒） */
  elapsedSeconds: number;
  /** A/Bごとの性能統計 */
  performanceStats?: {
    A: PlayerPerformanceStats;
    B: PlayerPerformanceStats;
  };
}
