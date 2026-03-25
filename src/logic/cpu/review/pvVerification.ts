/**
 * PV（予想手順）の事後検証
 *
 * minimax が返した PV を辿り、プレイヤーの各手の後に
 * 相手の追詰チェックを実行する。相手の手の後はチェックしない。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedLossType, ReviewCandidate } from "@/types/review";

import {
  checkCandidateForcedLoss,
  CANDIDATE_VERIFY_VCF_OPTIONS,
  CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
  CANDIDATE_VERIFY_VCT_OPTIONS,
} from "./forcedLossCheck";

/** PV 検証で使用する追詰チェックオプション（verifyCandidates と同一） */
const PV_VERIFY_OPTIONS = {
  vcfOptions: CANDIDATE_VERIFY_VCF_OPTIONS,
  miseVcfOptions: CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
  vctOptions: CANDIDATE_VERIFY_VCT_OPTIONS,
};

export interface PVVerificationResult {
  /** PV の打ち切り位置（slice(0, failIndex) で使用） */
  failIndex: number;
  forcedLossType: ForcedLossType;
  forcedLossSequence: Position[];
}

/**
 * 候補手の PV を辿り、プレイヤーの各手の後に追詰チェックを実行する
 *
 * PV の手順: [自分の手, 相手の手, 自分の手, 相手の手, ...]
 * 偶数インデックス（0, 2, 4, ...）がプレイヤーの手。
 * プレイヤーの手を置いた直後に checkCandidateForcedLoss で相手の追詰を検出する。
 * 相手の手の後はチェックしない（相手の応手は候補の品質と無関係）。
 *
 * @returns 追詰が見つかった場合は PVVerificationResult、安全なら null
 */
export function verifyPV(
  board: BoardState,
  candidate: ReviewCandidate,
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  timeBudgetMs: number,
): PVVerificationResult | null {
  const pv = candidate.principalVariation;
  // PV 長 1 は verifyCandidates と完全重複のためスキップ
  if (!pv || pv.length < 2) {
    return null;
  }

  const deadline = performance.now() + timeBudgetMs;

  // PV の手を順に盤面に置く（undo 用にスタック管理）
  const placed: { row: number; col: number }[] = [];

  const undoAll = (): void => {
    for (let k = placed.length - 1; k >= 0; k--) {
      const p = placed[k]!;
      const r = board[p.row];
      if (r) {
        r[p.col] = null;
      }
    }
  };

  try {
    for (let i = 0; i < pv.length; i++) {
      if (performance.now() > deadline) {
        return null;
      }

      const move = pv[i]!;
      const isPlayerMove = i % 2 === 0;
      const moveColor = isPlayerMove ? color : opponentColor;

      const row = board[move.row];
      if (!row || row[move.col] !== null) {
        // 既に石がある（不正な PV）→ 検証中断
        return null;
      }
      row[move.col] = moveColor;
      placed.push({ row: move.row, col: move.col });

      // プレイヤーの手の後に追詰チェック
      // checkCandidateForcedLoss は「石がない盤面 + pos」を期待するので、
      // 一旦石を外して渡し、戻す。例外時は undoAll が全復元するため安全。
      if (isPlayerMove) {
        const currentStoneCount = stoneCount + placed.length;
        row[move.col] = null;
        const loss = checkCandidateForcedLoss(
          board,
          move,
          color,
          opponentColor,
          currentStoneCount - 1,
          PV_VERIFY_OPTIONS,
        );
        row[move.col] = color;

        if (loss) {
          return {
            failIndex: i,
            forcedLossType: loss.type,
            forcedLossSequence: loss.sequence,
          };
        }
      }
    }

    return null;
  } finally {
    undoAll();
  }
}

/**
 * 安全な候補のみを対象に PV 検証を実行する
 *
 * 追詰が見つかった候補に opponentForcedWin を設定し、PV を打ち切る。
 * スコア引き下げは下流の adjustCandidatesForForcedLoss が担当する。
 */
export function verifyCandidatePVs(
  board: BoardState,
  candidates: ReviewCandidate[],
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  totalBudgetMs: number,
): void {
  const deadline = performance.now() + totalBudgetMs;

  for (const cand of candidates) {
    if (performance.now() > deadline) {
      break;
    }

    if (cand.opponentForcedWin) {
      continue;
    }

    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      break;
    }

    const result = verifyPV(
      board,
      cand,
      color,
      opponentColor,
      stoneCount,
      remaining,
    );

    if (result) {
      cand.opponentForcedWin = result.forcedLossType;
      cand.opponentForcedWinSequence = result.forcedLossSequence;
      // PV を打ち切り位置で切断
      if (cand.principalVariation) {
        cand.principalVariation = cand.principalVariation.slice(
          0,
          result.failIndex,
        );
      }
    }
  }
}
