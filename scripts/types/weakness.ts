/**
 * 弱点パターン分析の型定義
 */

import type { Position } from "../../src/types/game.ts";

// ============================================================================
// 弱点タイプ
// ============================================================================

/** 弱点タイプ */
export type WeaknessType =
  | "blunder" // 前手との評価スコア差 >= 2000
  | "missed-vcf" // 負けた側の局面でVCFがあったのに見逃し
  | "advantage-squandered" // スコア+3000以上 → 最終的に負け
  | "depth-disagreement" // 深度間で最善手が不一致
  | "forbidden-vulnerability" // 禁手追い込みが成立した局面
  | "time-pressure-error"; // 時間切れ中断で前深度より悪い手を選択

// ============================================================================
// 弱点インスタンス
// ============================================================================

/** 弱点インスタンス共通フィールド */
interface WeaknessBase {
  /** 弱点タイプ */
  type: WeaknessType;
  /** 対局インデックス（0始まり） */
  gameIndex: number;
  /** 手番号（1始まり） */
  moveNumber: number;
  /** 弱点が発生したプレイヤーの色 */
  color: "black" | "white";
  /** 着手位置 */
  position: Position;
  /** 説明 */
  description: string;
}

/** blunder: 大悪手 */
export interface BlunderWeakness extends WeaknessBase {
  type: "blunder";
  /** 前手のスコア */
  previousScore: number;
  /** この手のスコア */
  currentScore: number;
  /** スコア差（絶対値） */
  scoreDrop: number;
}

/** missed-vcf: VCF見逃し */
export interface MissedVcfWeakness extends WeaknessBase {
  type: "missed-vcf";
  /** VCFが存在した位置 */
  vcfMove: Position;
  /** 実際に打った位置 */
  actualMove: Position;
}

/** advantage-squandered: 優勢からの逆転負け */
export interface AdvantageSquanderedWeakness extends WeaknessBase {
  type: "advantage-squandered";
  /** 最大スコア */
  peakScore: number;
  /** 最大スコアの手番号 */
  peakMoveNumber: number;
  /** 最終結果 */
  finalResult: "A" | "B" | "draw";
}

/** depth-disagreement: 深度間の最善手不一致 */
export interface DepthDisagreementWeakness extends WeaknessBase {
  type: "depth-disagreement";
  /** 深度別の最善手 */
  depthHistory: { depth: number; position: Position; score: number }[];
}

/** forbidden-vulnerability: 禁手追い込み成立 */
export interface ForbiddenVulnerabilityWeakness extends WeaknessBase {
  type: "forbidden-vulnerability";
  /** 禁手追い込みが成立した手番号 */
  trapMoveNumber: number;
}

/** time-pressure-error: 時間切れ中断による劣化 */
export interface TimePressureErrorWeakness extends WeaknessBase {
  type: "time-pressure-error";
  /** 前の深度でのスコア */
  previousDepthScore: number;
  /** 前の深度での最善手 */
  previousDepthMove: Position;
  /** 最終的に選択されたスコア */
  finalScore: number;
  /** 完了した深度 */
  completedDepth: number;
  /** 設定された最大深度 */
  maxDepth: number;
}

/** 弱点インスタンスのユニオン型 */
export type WeaknessInstance =
  | BlunderWeakness
  | MissedVcfWeakness
  | AdvantageSquanderedWeakness
  | DepthDisagreementWeakness
  | ForbiddenVulnerabilityWeakness
  | TimePressureErrorWeakness;

// ============================================================================
// パターン別集計
// ============================================================================

/** パターン別集計 */
export interface WeaknessPatternSummary {
  /** 弱点タイプ */
  type: WeaknessType;
  /** 発生件数 */
  count: number;
  /** 発生率（総対局数に対する割合） */
  rate: number;
  /** 色別内訳 */
  byColor: { black: number; white: number };
}

// ============================================================================
// 改善提案
// ============================================================================

/** 改善提案 */
export interface ImprovementSuggestion {
  /** 優先度（1=最高） */
  priority: number;
  /** 対象弱点タイプ */
  targetWeakness: WeaknessType;
  /** 提案内容 */
  suggestion: string;
  /** 関連パラメータ */
  relatedParams?: string[];
}

// ============================================================================
// レポート全体
// ============================================================================

/** 弱点分析レポート */
export interface WeaknessReport {
  /** タイムスタンプ */
  timestamp: string;
  /** ソースファイル */
  sourceFile: string;
  /** 分析対象の対局数 */
  totalGames: number;
  /** 弱点インスタンス一覧 */
  weaknesses: WeaknessInstance[];
  /** パターン別集計 */
  patterns: WeaknessPatternSummary[];
  /** 改善提案 */
  suggestions: ImprovementSuggestion[];
}
