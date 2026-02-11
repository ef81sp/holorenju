/**
 * ベンチマーク棋譜分析の型定義
 */

import type {
  GameResult,
  MoveRecord,
} from "../../src/logic/cpu/benchmark/headless.ts";
import type { Position } from "../../src/types/game.ts";

// ============================================================================
// タグ定義
// ============================================================================

/** 禁手系タグ */
export type ForbiddenTag =
  | "double-three" // 三々
  | "double-four" // 四々
  | "overline" // 長連
  | "forbidden-loss" // 禁手負け
  | "forbidden-trap"; // 禁手追い込み

/** 四追い系タグ */
export type ThreatSequenceTag =
  | "vcf-win" // 四追い勝ち（棋譜から検出）
  | `vcf-${number}` // VCF手数（例: vcf-3 = 3手のVCF）
  | "four-three"; // 四三同時

/** 戦術系タグ（将来の拡張用） */
export type TacticalTag =
  | "good-move" // 好手（評価上位）
  | "bad-move"; // 悪手（評価下位）

/** パターン系タグ */
export type PatternTag =
  | "open-three" // 活三を作った
  | "open-four" // 活四を作った
  | "four"; // 止め四（片方閉じ）

/** 勝敗系タグ */
export type ResultTag = "winning-move"; // 勝ちを決めた手（最終手）

/** 開局系タグ */
export type OpeningTag =
  | "opening-move" // 開局定石
  | `jushu:${string}` // 珠型名（例: "jushu:花月", "jushu:寒星"）
  | "diagonal" // 直打ち
  | "orthogonal"; // 間打ち

/** 全タグ型 */
export type Tag =
  | ForbiddenTag
  | ThreatSequenceTag
  | TacticalTag
  | PatternTag
  | ResultTag
  | OpeningTag;

// ============================================================================
// 分析結果構造
// ============================================================================

/** 1手の分析結果 */
export interface MoveAnalysis {
  moveNumber: number;
  position: Position;
  color: "black" | "white";
  notation: string; // "H8"形式
  tags: Tag[];
}

/** 開局情報 */
export interface OpeningInfo {
  /** 珠型名（"花月", "寒星" など） */
  jushu: string;
  /** 直打ち/間打ち */
  type: "diagonal" | "orthogonal";
}

/** 1対局の分析結果 */
export interface GameAnalysis {
  gameId: string;
  sourceFile: string;
  matchup: string; // "easy vs hard"
  winner: "A" | "B" | "draw";
  reason: string;
  totalMoves: number;
  /** 対局で現れた特徴タグ */
  gameTags: Tag[];
  moves: MoveAnalysis[];
  /** 棋譜文字列（スペース区切り） */
  gameRecord: string;
  /** 開局情報 */
  opening?: OpeningInfo;
}

/** 分析サマリー統計 */
export interface AnalysisSummary {
  totalGames: number;
  totalMoves: number;
  /** タグごとの出現回数 */
  tagCounts: Record<string, number>;
  /** 珠型ごとのゲーム数 */
  jushuCounts: Record<string, number>;
  /** 勝因ごとの内訳 */
  reasonCounts: Record<string, number>;
}

/** 分析結果全体 */
export interface AnalysisResult {
  timestamp: string;
  sourceFiles: string[];
  games: GameAnalysis[];
  summary: AnalysisSummary;
}

// ============================================================================
// ベンチマーク結果の型（bench-results/*.json の構造）
// ============================================================================

/** ベンチマーク結果の1手（headless.ts の MoveRecord と同一） */
export type BenchMoveHistory = MoveRecord;

/** ベンチマーク結果の1対局（headless.ts の GameResult と同一） */
export type BenchGameResult = GameResult;

/** ベンチマーク結果全体 */
export interface BenchmarkResultFile {
  timestamp: string;
  options: {
    players: string[];
    gamesPerMatchup: number;
    parallel: boolean;
    workers: number;
  };
  ratings: Record<
    string,
    {
      rating: number;
      games: number;
      wins: number;
      losses: number;
      draws: number;
    }
  >;
  matchups: {
    playerA: string;
    playerB: string;
    winsA: number;
    winsB: number;
    draws: number;
    total: number;
  }[];
  games: BenchGameResult[];
}

// ============================================================================
// フィルタオプション
// ============================================================================

/** ブラウズ時のフィルタオプション */
export interface BrowseFilter {
  /** タグで絞り込み */
  tags?: Tag[];
  /** マッチアップで絞り込み（部分一致） */
  matchup?: string;
  /** 手数範囲 */
  movesMin?: number;
  movesMax?: number;
  /** 勝者で絞り込み */
  winner?: "black" | "white" | "draw";
  /** 珠型で絞り込み */
  jushu?: string;
}
