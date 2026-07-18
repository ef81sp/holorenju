/**
 * 探索関連の型定義
 *
 * 探索アルゴリズム本体（minimax, vcf, vct等）が削除された後も
 * review/ や wasm/ から参照される型をここに集約する。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinNode } from "@/types/review";

import type { ProfilingCounters } from "../profiling/counters";

// =============================================================================
// VCF
// =============================================================================

/**
 * VCF探索オプション（外部からパラメータを設定可能）
 */
export interface VCFSearchOptions {
  /** 最大探索深度（デフォルト: 8） */
  maxDepth?: number;
  /** 時間制限（ミリ秒、デフォルト: 150） */
  timeLimit?: number;
  /** ノード数上限（0 or undefined = 無制限） */
  maxNodes?: number;
}

/**
 * VCF手順の探索結果
 */
export interface VCFSequenceResult {
  /** 最初の手 */
  firstMove: Position;
  /** 手順 [攻撃1, 防御1, 攻撃2, 防御2, ..., 攻撃N] */
  sequence: Position[];
  /** 禁手追い込みによる勝ちかどうか */
  isForbiddenTrap: boolean;
}

// =============================================================================
// VCT
// =============================================================================

/**
 * VCT探索オプション（外部からパラメータを設定可能）
 */
export interface VCTSearchOptions {
  /** 最大探索深度（デフォルト: 4） */
  maxDepth?: number;
  /** 時間制限（ミリ秒、デフォルト: 150） */
  timeLimit?: number;
  /** ノード数上限（0 or undefined = 無制限） */
  maxNodes?: number;
  /** 内部VCF呼び出しに渡すオプション */
  vcfOptions?: VCFSearchOptions;
  /** 分岐情報を収集するか（レビュー用） */
  collectBranches?: boolean;
}

/** VCT手順内の分岐情報 */
/**
 * VCT手順の探索結果
 */
export interface VCTSequenceResult {
  /** 最初の手 */
  firstMove: Position;
  /** 手順 [攻撃1, 防御1, 攻撃2, ..., 攻撃N]（= 木の defenses[0] 連鎖） */
  sequence: Position[];
  /** 禁手追い込みによる勝ちかどうか */
  isForbiddenTrap: boolean;
  /** 追詰の再帰的詰み木（collectBranches有効時のみ。#22） */
  tree?: ForcedWinNode;
}

/**
 * VCT探索を有効にする石数の閾値
 *
 * review.worker.ts の vctCheckOnly から forcedLossCheck.ts の
 * checkForcedLossVCTOnly 経由で使用される（#70 でロジックを review.worker.ts
 * からこちらへ集約したため、参照元は checkForcedLossVCTOnly のみ）。
 *
 * #70（2026-07-18）: 旧値14は「石が少なすぎる開局直後は探索コストに見合わない」
 * という想定だったが、実戦棋譜で8石時点（開局3手をスキップした直後）に本物の
 * 被詰み（VCT）が存在する敗着（J6）を見逃す原因になっていた。
 *
 * ボス実戦21手全手で checkForcedLossVCTOnly のVCTステップの壁時計時間を実測
 * したところ、石数と探索コストに明確な非単調な偏りがあった: 6-7石（陰性・
 * 被詰みなし）はいずれも探索空間が広すぎて exhaustive に近い探索になり
 * timeLimit(10秒)いっぱいまで浪費する一方、8石以降（J6含む）は陽性・陰性
 * 問わず全て600ms未満で完了した。8はこの「危険な陰性探索ゾーン(6-7石)」を
 * 除外しつつ、報告された J6（8石）を確実に含む最小の閾値として選定した
 * （4等さらに低い値も検出自体は可能だが、6-7石の重い陰性探索を毎回抱える
 * ことになり不要なレイテンシ増を招く）。
 */
export const VCT_STONE_THRESHOLD = 8;

// =============================================================================
// Mise-VCF
// =============================================================================

/**
 * Mise-VCF探索オプション
 */
export interface MiseVCFSearchOptions {
  /** VCF探索オプション */
  vcfOptions?: VCFSearchOptions;
  /** 全体の時間制限（ミリ秒、デフォルト: 500） */
  timeLimit?: number;
  /** 三の代替防御の分岐を収集するか（振り返り表示用、デフォルト: false） */
  collectBranches?: boolean;
}

// =============================================================================
// 探索結果
// =============================================================================

/**
 * 候補手のスコア情報
 */
export interface MoveScoreEntry {
  /** 着手位置 */
  move: Position;
  /** 評価スコア */
  score: number;
  /** Principal Variation（予想手順） */
  pv?: Position[];
  /** PV末端の盤面（評価内訳計算用） */
  pvLeafBoard?: BoardState;
  /** PV末端での手番（評価内訳計算用） */
  pvLeafColor?: "black" | "white";
}

/**
 * ランダム選択情報
 */
export interface RandomSelectionResult {
  /** ランダム選択が発生したか */
  wasRandom: boolean;
  /** 選択された手の元の順位（1始まり） */
  originalRank: number;
  /** 選択対象の候補数 */
  candidateCount: number;
  /** 同スコアのタイブレークで選択されたか */
  wasTieBreak: boolean;
}

/**
 * 深度別の最善手情報
 */
export interface DepthHistoryEntry {
  /** 探索深度 */
  depth: number;
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
}

/**
 * 探索統計
 */
export interface SearchStats {
  /** 探索ノード数 */
  nodes: number;
  /** TTヒット数 */
  ttHits: number;
  /** TTカットオフ数 */
  ttCutoffs: number;
  /** Beta剪定数 */
  betaCutoffs: number;
  /** 禁手判定回数 */
  forbiddenCheckCalls: number;
  /** 盤面コピー回数 */
  boardCopies: number;
  /** 脅威検出回数 */
  threatDetectionCalls: number;
  /** 評価関数呼び出し回数 */
  evaluationCalls: number;
  /** Null Move Pruning 試行回数（hasImmediateThreat呼び出し回数） */
  nullMoveTrials: number;
  /** Null Move Pruning によるカットオフ数 */
  nullMoveCutoffs: number;
  /** Futility Pruning によるスキップ数 */
  futilityPrunes: number;
  /** Threat Extension 発動回数 */
  threatExtensions: number;
  /** LMR 発動回数 */
  lmrTrials: number;
  /** LMR re-search 発動回数 */
  lmrResearches: number;
  /** LMR moveIndex 分布 [3, 4, 5+] */
  lmrMoveIndexDist: [number, number, number];
  /** QSearch ノード数 */
  qSearchNodes: number;
  /** QSearch 分岐数の合計（平均計算用） */
  qSearchBranchSum: number;
  /** QSearch エントリ数（平均分岐計算用） */
  qSearchEntries: number;
  /** QSearch 深度の合計（平均深度計算用） */
  qSearchDepthSum: number;
  /** QSearch 終端数（平均深度計算用） */
  qSearchLeaves: number;
  /** 関数別タイミング（プロファイリング有効時のみ） */
  timings?: ProfilingCounters["timings"];
}

/**
 * Minimax探索結果
 */
export interface MinimaxResult {
  /** 最善手の位置 */
  position: Position;
  /** 評価スコア */
  score: number;
  /** 候補手のスコアリスト（ソート済み） */
  candidates?: MoveScoreEntry[];
  /** ランダム選択情報 */
  randomSelection?: RandomSelectionResult;
}

/**
 * Iterative Deepening結果
 */
export interface IterativeDeepingResult extends MinimaxResult {
  /** 探索統計 */
  stats?: SearchStats;
  /** 実際に完了した探索深度 */
  completedDepth: number;
  /** 時間切れで中断したか */
  interrupted: boolean;
  /** 経過時間（ミリ秒） */
  elapsedTime: number;
  /** 深度別の最善手履歴 */
  depthHistory?: DepthHistoryEntry[];
  /** 候補手が1つだけの強制手か（スコアは参考値） */
  forcedMove?: boolean;
  /** 時間制限フォールバックが発動したか */
  timePressureFallback?: boolean;
  /** フォールバック元の探索深度 */
  fallbackFromDepth?: number;
}

/**
 * PV抽出結果
 */
export interface PVExtractionResult {
  /** Principal Variation（予想手順） */
  pv: Position[];
  /** PV末端の盤面 */
  leafBoard: BoardState;
  /** PV末端での手番 */
  leafColor: "black" | "white";
}
