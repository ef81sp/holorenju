/**
 * 振り返り（棋譜評価）関連の型定義
 */

import type { CpuBattleRecord, LeafEvaluation, ScoreBreakdown } from "./cpu";
import type { Position } from "./game";

/**
 * 強制負けの種類（VCF/VCT/禁手トラップ/ミセ四追い/両ミセ/三三/四四）
 */
export type ForcedLossType =
  | "vcf"
  | "vct"
  | "forbidden-trap"
  | "mise-vcf"
  | "double-mise"
  | "double-three"
  | "double-four";

/** 強制勝ちの種類（ForcedLossType から白パターン系を除外） */
export type ForcedWinType = Exclude<
  ForcedLossType,
  "double-three" | "double-four"
>;

/**
 * 強制負け検出の結果
 */
export interface ForcedLossResult {
  type: ForcedLossType;
  sequence: Position[];
}

/**
 * プレイヤー視点の手番
 */
export type PlayerSide = "black" | "white" | "both";

/**
 * レビューソースの判別共用体
 */
export type ReviewSource =
  | { type: "cpuBattle"; record: CpuBattleRecord }
  | { type: "imported"; moveHistory: string; playerSide: PlayerSide };

/**
 * VCT/VCF手順の分岐情報
 */
export interface ForcedWinBranch {
  /** 分岐点のPVインデックス（防御手の位置） */
  defenseIndex: number;
  /** 代替防御手 */
  defenseMove: Position;
  /** この防御後の継続手順 */
  continuation: Position[];
}

/**
 * 候補手（内訳付き）
 */
export interface ReviewCandidate {
  position: Position;
  /** 即時評価スコア */
  score: number;
  /** 探索スコア（順位の根拠） */
  searchScore: number;
  /** 即時評価の内訳 */
  breakdown?: ScoreBreakdown;
  /** 予想手順 */
  principalVariation?: Position[];
  /** 探索末端の評価内訳 */
  leafEvaluation?: LeafEvaluation;
  /** この手を打つと相手に強制勝ちを許す場合のタイプ */
  opponentForcedWin?: ForcedLossType;
}

/**
 * 手の品質分類
 */
export type MoveQuality =
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

/**
 * 1手分の評価結果
 */
export interface EvaluatedMove {
  /** 手番インデックス（0始まり） */
  moveIndex: number;
  /** 着手位置 */
  position: Position;
  /** プレイヤーの手かどうか */
  isPlayerMove: boolean;
  /** 品質 */
  quality: MoveQuality;
  /** 実際の手のスコア */
  playedScore: number;
  /** 最善手のスコア */
  bestScore: number;
  /** スコア差 */
  scoreDiff: number;
  /** 最善手の位置 */
  bestMove: Position;
  /** 上位候補手 */
  candidates: ReviewCandidate[];
  /** 探索が完了した深度 */
  completedDepth?: number;
  /** 必勝手順の種類 */
  forcedWinType?: ForcedWinType;
  /** 必勝手順の分岐情報 */
  forcedWinBranches?: ForcedWinBranch[];
  /** 相手の必勝手順（自分が負け確定） */
  forcedLossType?: ForcedLossType;
  /** 相手の必勝手順のシーケンス */
  forcedLossSequence?: Position[];
  /** 軽量評価（minimax省略、強制勝ち検出のみ） */
  isLightEval?: boolean;
  /** 両ミセ手の見逃し（打つ前の盤面で両ミセ手が存在した） */
  missedDoubleMise?: Position[];
  /** 両ミセのターゲット位置（四三を作る位置） */
  doubleMiseTargets?: Position[];
}

/**
 * 対局全体の評価結果
 */
export interface GameReview {
  /** 各手の評価 */
  evaluatedMoves: EvaluatedMove[];
  /** プレイヤー精度（0-100） */
  accuracy: number;
  /** クリティカルエラー数（mistake + blunder） */
  criticalErrors: number;
}

/**
 * 評価Workerへのリクエスト
 */
export interface ReviewEvalRequest {
  /** 棋譜文字列 */
  moveHistory: string;
  /** 評価する手のインデックス */
  moveIndex: number;
  /** プレイヤーが先手かどうか */
  playerFirst: boolean;
  /** 軽量評価モード（コンピュータ手用） */
  isLightEval?: boolean;
  /** Phase 2: VCTチェックのみ実行 */
  vctCheckOnly?: boolean;
}

/**
 * 評価Workerの結果（1手分）
 */
export interface ReviewWorkerResult {
  /** 手のインデックス */
  moveIndex: number;
  /** 最善手 */
  bestMove: Position;
  /** 最善手のスコア */
  bestScore: number;
  /** 実際の手のスコア */
  playedScore: number;
  /** 上位候補手 */
  candidates: ReviewCandidate[];
  /** 探索が完了した深度 */
  completedDepth: number;
  /** 必勝手順の種類 */
  forcedWinType?: ForcedWinType;
  /** 必勝手順の分岐情報 */
  forcedWinBranches?: ForcedWinBranch[];
  /** 相手の必勝手順（自分が負け確定） */
  forcedLossType?: ForcedLossType;
  /** 相手の必勝手順のシーケンス */
  forcedLossSequence?: Position[];
  /** 軽量評価（minimax省略、強制勝ち検出のみ） */
  isLightEval?: boolean;
  /** 両ミセ手の見逃し（打つ前の盤面で両ミセ手が存在した） */
  missedDoubleMise?: Position[];
  /** 両ミセのターゲット位置（四三を作る位置） */
  doubleMiseTargets?: Position[];
  /** Phase 1でVCTをスキップし、Phase 2でのVCTチェックが必要 */
  needsVCTCheck?: boolean;
}
