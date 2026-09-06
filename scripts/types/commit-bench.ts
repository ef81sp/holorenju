/**
 * コミット間ベンチマーク比較の型定義
 */

import type { EvaluationOptions } from "../../src/logic/cpu/evaluation/patternScores.ts";
import type { CpuDifficulty } from "../../src/types/cpu.ts";
import type { GameResult } from "../commit-game-runner.ts";
import type {
  EloDiffResult,
  PairedStats,
  SPRTConfig,
  SPRTState,
  WDLCount,
} from "./ab.ts";
import type { OpeningSuiteConfig } from "./openingSuite.ts";

/** 開局ラベル付き対局結果 */
export interface CommitGameResult extends GameResult {
  /** 開局ラベル（珠型名または開局 id） */
  jushuName: string;
  /**
   * ペア id（同一開局の A黒/A白 2 局が同じ値を持つ）。
   * 旧 JSON には無い（その場合は jushuName でペアリングする）。
   */
  pairId?: string;
}

/** 破棄（abort）された局の識別情報。決定的モードでは 1 件でも run が無効になる。 */
export interface AbortedGame {
  gameIdx: number;
  openingId: string;
  pairId: string;
  isABlack: boolean;
  /** ハングした側。worker 死等で特定できないときは undefined */
  side?: "A" | "B";
  reason: string;
}

/**
 * 固定ノード（決定的探索）モードの設定記録。bench-fixed-nodes-2026-09-06.md §2.5。
 * commit-bench / weight-bench の config で共用する。
 */
export interface FixedNodesConfig {
  /** `--fixed-nodes=N`（両側）。片側指定なら undefined */
  fixedNodes?: number;
  /** `--fixed-nodes-a=N` / `--fixed-nodes-b=N`（片側。時間 vs 固定の混合＝較正用） */
  fixedNodesA?: number;
  fixedNodesB?: number;
  /**
   * 両側の wasm `getSearchFeatures()` ビット（bit0=deterministic 対応、bit1=stats 拡張）。
   * `--compare` の provenance。export の無い旧 wasm / TS では undefined。
   */
  searchFeaturesA?: number;
  searchFeaturesB?: number;
}

/** 決定的モードの run 妥当性（abort=0 が受け入れ条件）。 */
export interface RunValidity {
  /**
   * 決定的モードで abort が 1 件でも出たら false（結果は Elo 判定に使えない）。
   * 時間モードでは記録しない（従来どおり abort 局を除いて集計）。
   */
  valid?: boolean;
  /** 破棄された局の一覧（後方互換のため optional。旧 JSON には無い） */
  abortedGames?: AbortedGame[];
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
export interface CommitBenchResult extends RunValidity {
  type: "commit-bench";
  /** タイムスタンプ */
  timestamp: string;
  /** commitA情報 */
  commitA: CommitInfo;
  /** commitB情報 */
  commitB: CommitInfo;
  /** 設定 */
  config: FixedNodesConfig & {
    difficulty: CpuDifficulty;
    /** 珠型モードではセット数、開局スイートではスイートの周回数 */
    sets: number;
    /** 1 周回あたりの局数（珠型 26×2、スイートは (count−offset)×2） */
    gamesPerSet: number;
    randomFactor?: number;
    sprt: SPRTConfig | null;
    /** `--openings` 指定時の開局スイート情報。未指定（珠型モード）なら無い */
    openings?: OpeningSuiteConfig;
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
  /** Elo差推定（三項＝1 局単位。参考値） */
  eloDiff: EloDiffResult;
  /**
   * SPRT状態（SPRT有効時のみ）。**停止に使った判定＝ペア LLR**。
   * paired が無い旧 JSON では三項判定が入っている。
   */
  sprt: SPRTState | null;
  /** 三項（1 局単位）の SPRT 判定。参考用。 */
  sprtTrinomial?: SPRTState | null;
  /** ペア統計（pentanomial）。旧 JSON には無い（bench-reanalyze で再集計可） */
  paired?: PairedStats;
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
