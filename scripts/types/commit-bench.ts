/**
 * コミット間ベンチマーク比較の型定義
 */

import type { EvaluationOptions } from "../../src/logic/cpu/evaluation/patternScores.ts";
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
    /** Gate 2: A/B 側それぞれの evaluationOptions オーバーライド（例: evalBasis=prospect）。 */
    evalOptionsA?: Partial<EvaluationOptions>;
    evalOptionsB?: Partial<EvaluationOptions>;
    /** ブックゲート（★v2プラン B3）: A/B 側それぞれでオープニングブックを有効化したか。 */
    bookA?: boolean;
    bookB?: boolean;
    /**
     * 脅威プローブトグル（探索レバー A/B）。true=ON（従来挙動）、false=OFF。
     * 記録なし＝ON 相当（後方互換 optional）。
     */
    threatProbeA?: boolean;
    threatProbeB?: boolean;
    /**
     * maxNodes オーバーライド（探索レバー A/B）。未指定なら difficulty 既定。
     */
    maxNodesA?: number;
    maxNodesB?: number;
    /**
     * depth cap オーバーライド（探索レバー A/B）。未指定なら difficulty 既定。
     */
    maxDepthA?: number;
    maxDepthB?: number;
    /**
     * PRNG baseSeed。--seed 指定時は明示値、未指定時は Date.now() の下位32bit。
     * randomFactor 未指定なら undefined（seed が意味を持たないため）。
     * 局ごとの実効 seed は mixSeed(seed, gameIdx) で導出される。
     */
    seed?: number;
  };
  /** 対局数（実際に完走した局のみ。中断＝abort 局は含めない） */
  totalGames: number;
  /**
   * ハング等で破棄された局数。回復パスが働いた回数。
   * 既存 JSON との後方互換のため optional（未設定＝0 相当）。
   */
  aborts?: number;
  /**
   * abort 局を側（A/B）別に集計。「劣勢側だけハングして負けが消える」
   * バイアスの検出に使う。後方互換のため optional。
   */
  abortsBySide?: { A: number; B: number };
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
