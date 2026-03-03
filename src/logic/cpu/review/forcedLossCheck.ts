/**
 * 強制負け検出の純粋関数
 *
 * worker とテストの両方から利用する SSoT モジュール。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedLossResult } from "@/types/review";

import { BOARD_SIZE } from "@/constants/board";

import { detectOpponentThreats } from "../evaluation";
import { findDoubleMiseMoves } from "../evaluation/tactics";
import {
  checkWhiteWinningPattern,
  classifyWhiteWinningPattern,
} from "../evaluation/winningPatterns";
import {
  findMiseVCFSequence,
  type MiseVCFSearchOptions,
} from "../search/miseVcf";
import { findVCFSequence, type VCFSearchOptions } from "../search/vcf";
import {
  findVCTSequence,
  VCT_STONE_THRESHOLD,
  type VCTSearchOptions,
} from "../search/vct";

/** 振り返り用VCF探索パラメータ */
export const REVIEW_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 16,
  timeLimit: 1500,
};

/** 振り返り用Mise-VCF探索パラメータ */
export const REVIEW_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 12, timeLimit: 300 },
  timeLimit: 500,
};

/** checkForcedLoss用VCT探索パラメータ（存在検出のみ、分岐収集なし、Phase 2で単一ワーカー実行） */
export const FORCED_LOSS_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 6,
  timeLimit: 10000,
  vcfOptions: {
    maxDepth: 16,
    timeLimit: 10000,
  },
  collectBranches: false,
};

/** 候補手検証用の短縮パラメータ */
export const CANDIDATE_VERIFY_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 12,
  timeLimit: 500,
};
export const CANDIDATE_VERIFY_MISE_VCF_OPTIONS: MiseVCFSearchOptions = {
  vcfOptions: { maxDepth: 10, timeLimit: 150 },
  timeLimit: 250,
};
export const CANDIDATE_VERIFY_VCT_OPTIONS: VCTSearchOptions = {
  maxDepth: 4,
  timeLimit: 750,
  vcfOptions: { maxDepth: 12, timeLimit: 250 },
  collectBranches: false,
};

export interface ForcedLossCheckOptions {
  vcfOptions: VCFSearchOptions;
  miseVcfOptions: MiseVCFSearchOptions;
  vctOptions: VCTSearchOptions;
  skipVCT?: boolean;
}

interface WhiteWinningMoves {
  doubleFour?: Position;
  doubleThree?: Position;
}

/**
 * 白の四四・三三手を全空きセルから1パスでスキャンして収集する
 *
 * 四四と三三を別々の優先レベルで使うため、それぞれ最初の1手ずつ返す。
 */
function findWhiteWinningMoves(board: BoardState): WhiteWinningMoves {
  const result: WhiteWinningMoves = {};
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = board[r];
    if (!row) {
      continue;
    }
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (row[c] !== null) {
        continue;
      }
      row[c] = "white";
      if (checkWhiteWinningPattern(board, r, c)) {
        const type = classifyWhiteWinningPattern(board, r, c);
        if (type === "double-four" && !result.doubleFour) {
          result.doubleFour = { row: r, col: c };
        } else if (type === "double-three" && !result.doubleThree) {
          result.doubleThree = { row: r, col: c };
        }
        if (result.doubleFour && result.doubleThree) {
          row[c] = null;
          return result;
        }
      }
      row[c] = null;
    }
  }
  return result;
}

/**
 * 相手の必勝手順（VCF→Mise-VCF→VCT）を検出する
 */
export function checkForcedLoss(
  boardAfter: BoardState,
  opponentColor: "black" | "white",
  stoneCountAfter: number,
  options?: ForcedLossCheckOptions,
): ForcedLossResult | undefined {
  const vcfOpts = options?.vcfOptions ?? REVIEW_VCF_OPTIONS;
  const miseOpts = options?.miseVcfOptions ?? REVIEW_MISE_VCF_OPTIONS;
  const vctOpts = options?.vctOptions ?? FORCED_LOSS_VCT_OPTIONS;

  // 0. 白パターンの事前スキャン（高速、結果は後段で使用）
  const whiteWins =
    opponentColor === "white" ? findWhiteWinningMoves(boardAfter) : undefined;

  // 1. VCF（最優先: 四追いで確定した手順）
  const oppVCF = findVCFSequence(boardAfter, opponentColor, vcfOpts);
  if (oppVCF) {
    return {
      type: oppVCF.isForbiddenTrap ? "forbidden-trap" : "vcf",
      sequence: oppVCF.sequence,
    };
  }

  // 2. 四四（VCFが時間切れ等で見逃した場合のフォールバック）
  if (whiteWins?.doubleFour) {
    return { type: "double-four", sequence: [whiteWins.doubleFour] };
  }

  // 3. 両ミセ
  const oppDM = findDoubleMiseMoves(boardAfter, opponentColor);
  if (oppDM.length > 0 && oppDM[0]) {
    return { type: "double-mise", sequence: [oppDM[0]] };
  }

  // 4. Mise-VCF
  const oppMise = findMiseVCFSequence(boardAfter, opponentColor, miseOpts);
  if (oppMise) {
    return { type: "mise-vcf", sequence: oppMise.sequence };
  }

  // 5. 三三（VCTと同等レベル）
  if (whiteWins?.doubleThree) {
    return { type: "double-three", sequence: [whiteWins.doubleThree] };
  }

  // 6. VCT
  if (stoneCountAfter >= VCT_STONE_THRESHOLD && !options?.skipVCT) {
    const oppVCT = findVCTSequence(boardAfter, opponentColor, vctOpts);
    if (oppVCT) {
      return {
        type: oppVCT.isForbiddenTrap ? "forbidden-trap" : "vct",
        sequence: oppVCT.sequence,
      };
    }
  }

  return undefined;
}

/**
 * 候補手を仮配置して相手の強制勝ちを検出する
 */
export function checkCandidateForcedLoss(
  board: BoardState,
  pos: Position,
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  options?: ForcedLossCheckOptions,
): ForcedLossResult | undefined {
  const row = board[pos.row];
  if (!row) {
    return undefined;
  }

  row[pos.col] = color;
  try {
    // 自分に四があれば相手はVCF/VCTどころではない
    const selfThreats = detectOpponentThreats(board, color);
    if (selfThreats.fours.length > 0 || selfThreats.openFours.length > 0) {
      return undefined;
    }
    return checkForcedLoss(board, opponentColor, stoneCount + 1, options);
  } finally {
    row[pos.col] = null;
  }
}
