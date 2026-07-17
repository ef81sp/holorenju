/**
 * 振り返り（棋譜評価）関連の型定義
 */

import type { CpuBattleRecord } from "./cpu";
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
  /** 相手の必勝手順の詰み木（#26。VCT 被詰のみ。VCF/Mise-VCF 等の線形ケースでは無し） */
  tree?: ForcedWinNode;
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
 * 詰み木の再帰的ノード（#22 / #26）。
 *
 * AND-OR 木の攻め手ノード。`defenses` が空なら終端（この攻め手で勝ち確定:
 * 五 / 達四 / VCF 完了）。`defenses[0]` 連鎖が既存 `sequence`（既定経路）に一致する。
 *
 * 追詰文脈（#22）では `attackerMove` はプレイヤーの攻め手・`defenderMove` は相手の防御手。
 * 被詰文脈（#26）では `attackerMove` は相手の攻め手・`defenderMove` はプレイヤーの防御手。
 * 構造は同一で、役割の違いは表示側で `ProgressionTab.attackerIsSelf` により切り替える。
 */
export interface ForcedWinNode {
  /** この局面での攻め手（OR を1つに固定） */
  attackerMove: Position;
  /** 受け側の全防御（AND）。空 = 終端 */
  defenses: ForcedWinDefense[];
}

/**
 * 詰み木の防御エッジ（#22）。
 */
export interface ForcedWinDefense {
  /** 受け手 */
  defenderMove: Position;
  /** この防御後の攻め継続ノード（必須・非null。即勝ちは defenses:[] の node で表す） */
  next: ForcedWinNode;
}

/**
 * 候補手（内訳付き）
 */
export interface ReviewCandidate {
  position: Position;
  /** 探索スコア（順位の根拠） */
  searchScore: number;
  /** 予想手順 */
  principalVariation?: Position[];
  /** この手を打つと相手に強制勝ちを許す場合のタイプ */
  opponentForcedWin?: ForcedLossType;
  /** 相手の強制勝ち手順（Phase 3 深掘りチェックで取得） */
  opponentForcedWinSequence?: Position[];
  /** フクミ手（この手を放置するとVCFが成立する） */
  isFukumi?: boolean;
  /** フクミ手のVCF手数 */
  fukumiDepth?: number;
}

/**
 * 手の品質分類
 *
 * "forcedReply"（被詰み継続）: 同一プレイヤーの forcedLoss（被追詰）チェーンの
 * 2手目以降。選択の余地がない手のため、mistake/blunder 等のミス評価を上書きし、
 * criticalErrors カウントと accuracy 分母から除外する（applyForcedReplyChains 参照）。
 */
export type MoveQuality =
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder"
  | "forcedReply";

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
  /** 必勝手順の詰み木（#22。最善タブの分岐表示の出所） */
  forcedWinTree?: ForcedWinNode;
  /** 相手の必勝手順（自分が負け確定） */
  forcedLossType?: ForcedLossType;
  /** 相手の必勝手順のシーケンス */
  forcedLossSequence?: Position[];
  /** 相手の必勝手順の分岐（Phase 3 遡及で構築） */
  forcedLossBranches?: ForcedWinBranch[];
  /** 相手の必勝手順の詰み木（#26。被詰タブの分岐表示の出所。VCT 被詰のみ） */
  forcedLossTree?: ForcedWinNode;
  /** 軽量評価（minimax省略、強制勝ち検出のみ） */
  isLightEval?: boolean;
  /** 両ミセ手の見逃し（打つ前の盤面で両ミセ手が存在した） */
  missedDoubleMise?: Position[];
  /** 両ミセのターゲット位置（四三を作る位置） */
  doubleMiseTargets?: Position[];
  /**
   * 序盤定石ブックと一致する手か（§3）。true のときはミス判定・代替推奨の
   * 表示を抑制し、「序盤ブック手」ラベルを表示する。
   */
  isBookMove?: boolean;
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
  /** 敗着の推定結果 */
  losingMove?: LosingMoveInfo;
}

/**
 * 敗着推定結果
 *
 * 追詰（VCF/VCT等）ベースで特定した敗着の近似位置。
 * VCT検出の深度限界により完全な正確性は保証されない。
 */
export interface LosingMoveInfo {
  /** 敗着と推定される手の moveIndex */
  moveIndex: number;
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
  /** Phase 3: VCT石数閾値を無視する（遡及チェック用） */
  skipStoneThreshold?: boolean;
  /** Phase 3: 候補手の位置（指定時、実際の着手の代わりにこの位置で盤面を構築） */
  candidatePosition?: Position;
  /** PV事後検証を実行するか */
  preciseAnalysis?: boolean;
}

/**
 * 評価Workerの結果: 共通フィールド
 */
interface ReviewWorkerResultBase {
  /** 手のインデックス */
  moveIndex: number;
}

/**
 * Phase 2 VCTチェック結果
 */
export interface VCTCheckResult extends ReviewWorkerResultBase {
  mode: "vctCheck";
  /** 相手の必勝手順 */
  forcedLossType?: ForcedLossType;
  /** 相手の必勝手順のシーケンス */
  forcedLossSequence?: Position[];
  /** 相手の必勝手順の詰み木（#26。VCT 被詰のみ） */
  forcedLossTree?: ForcedWinNode;
}

/**
 * 軽量評価結果（コンピュータ手用: 強制勝ち検出のみ）
 */
export interface LightEvalResult extends ReviewWorkerResultBase {
  mode: "lightEval";
  /** 最善手 */
  bestMove: Position;
  /** 必勝手順の種類 */
  forcedWinType?: ForcedWinType;
}

/**
 * フル評価結果（プレイヤー手用: minimax探索 + 候補手検証）
 */
export interface FullEvalResult extends ReviewWorkerResultBase {
  mode: "fullEval";
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
  /** 必勝手順の詰み木（#22。最善タブの分岐表示の出所） */
  forcedWinTree?: ForcedWinNode;
  /** 相手の必勝手順（自分が負け確定） */
  forcedLossType?: ForcedLossType;
  /** 相手の必勝手順のシーケンス */
  forcedLossSequence?: Position[];
  /** 相手の必勝手順の分岐（Phase 3 遡及で構築） */
  forcedLossBranches?: ForcedWinBranch[];
  /** 相手の必勝手順の詰み木（#26。VCT 被詰のみ、Phase 2 VCTチェック結果から伝搬） */
  forcedLossTree?: ForcedWinNode;
  /** 両ミセ手の見逃し（打つ前の盤面で両ミセ手が存在した） */
  missedDoubleMise?: Position[];
  /** 両ミセのターゲット位置（四三を作る位置） */
  doubleMiseTargets?: Position[];
  /** Phase 1でVCTをスキップし、Phase 2でのVCTチェックが必要 */
  needsVCTCheck?: boolean;
  /**
   * 打たれた手が序盤定石ブック（opening-book-2026-07-16.md）と一致するか
   * （§3: 注釈専用。対象は白番 ply4〜8。着手選択には使わない）。
   */
  isBookMove?: boolean;
}

/**
 * 評価Workerの結果（判別共用体）
 */
export type ReviewWorkerResult =
  | VCTCheckResult
  | LightEvalResult
  | FullEvalResult;
