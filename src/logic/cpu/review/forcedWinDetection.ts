/**
 * 強制勝ち検出（VCF/VCT/両ミセ/Mise-VCF）
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinType } from "@/types/review";

import { countStones } from "../core/boardUtils";
import { findDoubleMiseMoves } from "../evaluation/tactics";
import { createsFourThree } from "../evaluation/winningPatterns";
import { findMiseVCFSequence } from "../search/miseVcf";
import { findVCFSequence } from "../search/vcf";
import {
  findVCTSequence,
  findVCTSequenceFromFirstMove,
  VCT_STONE_THRESHOLD,
  type VCTSearchOptions,
  type VCTSequenceResult,
} from "../search/vct";
import { findThreatMoves } from "../search/vctHelpers";
import { validateVCTSequence } from "../search/vctValidation";
import {
  filterByCounterThreats,
  REVIEW_MISE_VCF_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./forcedLossCheck";
import { REVIEW_VCT_OPTIONS_WITH_BRANCHES } from "./reviewConstants";

export interface ForcedWinInfo {
  firstMove: Position;
  sequence: Position[];
  isForbiddenTrap: boolean;
  branches?: unknown;
}

export interface ForcedWinDetectionResult {
  forcedWin: ForcedWinInfo | null;
  forcedWinType: ForcedWinType | undefined;
  doubleMiseMoves: Position[];
  doubleMiseBestMove: Position | null;
}

/** フォールバック時の最大初手検証数 */
const VCT_FALLBACK_MAX_FIRST_MOVES = 40;

/** フォールバック時の1手あたりVCT探索ノード数上限 */
const VCT_FALLBACK_MAX_NODES = 100_000;

/**
 * 脅威手を1手ずつ findVCTSequenceFromFirstMove で検証する
 *
 * findVCTSequence の補完。findVCTSequence は全脅威手を再帰的に探索
 * するため、リスト後方にある VCT を見つけられないことがある。
 * 本関数は各脅威手に独自の TimeLimiter を割り当てるため、
 * 前の手の探索に影響されない。
 *
 * findVCTSequence との違い:
 * - ブランチ収集は行わない（findVCTSequenceFromFirstMove の制約）
 * - 最初に見つかった有効な VCT で即座に返す（最短探索はしない）
 * - 最大 VCT_FALLBACK_MAX_FIRST_MOVES 手まで検証
 */
function findVCTByFirstMoveIteration(
  board: BoardState,
  color: "black" | "white",
  options: VCTSearchOptions,
): VCTSequenceResult | null {
  const threats = findThreatMoves(board, color);
  const perMoveOptions: VCTSearchOptions = {
    ...options,
    timeLimit: Infinity,
    maxNodes: VCT_FALLBACK_MAX_NODES,
    vcfOptions: {
      ...options.vcfOptions,
    },
    collectBranches: false,
  };
  for (let i = 0; i < threats.length && i < VCT_FALLBACK_MAX_FIRST_MOVES; i++) {
    const threat = threats[i]!;
    const result = findVCTSequenceFromFirstMove(
      board,
      threat,
      color,
      perMoveOptions,
    );
    if (result && validateVCTSequence(board, color, result.sequence)) {
      return result;
    }
  }
  return null;
}

/**
 * 局面から強制勝ちを検出する
 *
 * 優先順: 1手四三 > 両ミセ ≥ 長VCF > Mise-VCF > VCT
 */
export function detectForcedWin(
  board: BoardState,
  color: "black" | "white",
  opponentHasFour: boolean,
  isLightEval: boolean,
): ForcedWinDetectionResult {
  // 両ミセ検出（VCF探索より前に1回だけ呼ぶ、~5ms）
  // 相手に活三やミセ手がある場合、両ミセ手で脅威も潰していなければ不成立
  // （相手は四三防御を無視して棒四や四三を打てるため）
  const doubleMiseMoves =
    !isLightEval && !opponentHasFour
      ? filterByCounterThreats(board, color, findDoubleMiseMoves(board, color))
      : [];
  const doubleMiseBestMove =
    doubleMiseMoves.length > 0 ? (doubleMiseMoves[0] ?? null) : null;

  // 拡張VCF/VCT探索（高速パス）
  // 相手の四がある場合はVCF/VCTをスキップ（四を止めなければ即負け）
  // 両ミセがある場合: maxDepth 2 で1手四三を検出（四三はVCF的に3手=depth 2）
  // 両ミセがない場合: 通常のVCF全探索
  // lightEval時: timeLimit を制限（Mise-VCFスキップのため VCF のみで判定）
  let vcfOptions = REVIEW_VCF_OPTIONS;
  if (isLightEval) {
    vcfOptions = { ...REVIEW_VCF_OPTIONS, timeLimit: 2000, maxNodes: 50_000 };
  } else if (doubleMiseBestMove) {
    vcfOptions = { ...REVIEW_VCF_OPTIONS, maxDepth: 2 };
  }
  const vcfResult = opponentHasFour
    ? null
    : findVCFSequence(board, color, vcfOptions);

  // 1手四三: VCFの初手が四三を作る場合、両ミセより優先
  // （VCF sequence ≤ 1 は即五/活四、≤ 3 かつ初手が四三なら1手四三）
  const isImmediateFourThree =
    vcfResult &&
    (vcfResult.sequence.length <= 1 ||
      (doubleMiseBestMove &&
        createsFourThree(
          board,
          vcfResult.firstMove.row,
          vcfResult.firstMove.col,
          color,
        )));

  // Mise-VCF検出（VCFも両ミセもない場合のみ、lightEvalではスキップ）
  const miseVcfResult =
    !isLightEval && !vcfResult && !doubleMiseBestMove && !opponentHasFour
      ? findMiseVCFSequence(board, color, REVIEW_MISE_VCF_OPTIONS)
      : null;

  // forcedWin 構築（優先順: 1手四三 > 両ミセ ≥ 長VCF > Mise-VCF > VCT）
  let forcedWin: ForcedWinInfo | null = null;
  if (isImmediateFourThree) {
    forcedWin = vcfResult;
  } else if (doubleMiseBestMove) {
    forcedWin = {
      firstMove: doubleMiseBestMove,
      sequence: [doubleMiseBestMove],
      isForbiddenTrap: false,
    };
  } else {
    forcedWin =
      vcfResult ??
      miseVcfResult ??
      // VCT探索はlightEvalではスキップ（重いため、fullEvalで検出する）
      (!isLightEval &&
      countStones(board) >= VCT_STONE_THRESHOLD &&
      !opponentHasFour
        ? (findVCTSequence(board, color, REVIEW_VCT_OPTIONS_WITH_BRANCHES) ??
          findVCTByFirstMoveIteration(
            board,
            color,
            REVIEW_VCT_OPTIONS_WITH_BRANCHES,
          ))
        : null);
  }

  // forcedWinType 判定
  let forcedWinType: ForcedWinType | undefined = undefined;
  if (forcedWin?.isForbiddenTrap) {
    forcedWinType = "forbidden-trap";
  } else if (isImmediateFourThree) {
    forcedWinType = "vcf";
  } else if (doubleMiseBestMove) {
    forcedWinType = "double-mise";
  } else if (vcfResult) {
    forcedWinType = "vcf";
  } else if (miseVcfResult) {
    forcedWinType = "mise-vcf";
  } else if (forcedWin) {
    forcedWinType = "vct";
  }

  return { forcedWin, forcedWinType, doubleMiseMoves, doubleMiseBestMove };
}
