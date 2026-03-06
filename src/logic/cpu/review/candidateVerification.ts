/**
 * 候補手の事後検証（相手の強制勝ち検出）
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState } from "@/types/game";
import type { ForcedLossResult, ReviewCandidate } from "@/types/review";

import {
  checkCandidateForcedLoss,
  CANDIDATE_VERIFY_VCF_OPTIONS,
  CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
  CANDIDATE_VERIFY_VCT_OPTIONS,
} from "./forcedLossCheck";

/**
 * 候補手リストを事後検証し、相手に強制勝ちを許す手にフラグを付ける
 *
 * 最善手（index 0）から順に検証し、安全な手が見つかった時点で打ち切る。
 * @returns demotedBest - 最善手が降格されたか
 */
export function verifyCandidates(
  board: BoardState,
  candidates: ReviewCandidate[],
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  timeBudgetMs: number,
): { demotedBest: boolean; bestLoss?: ForcedLossResult } {
  const deadline = performance.now() + timeBudgetMs;
  let demotedBest = false;
  let bestLoss: ForcedLossResult | undefined = undefined;

  for (let i = 0; i < candidates.length; i++) {
    if (performance.now() > deadline) {
      break;
    }
    const cand = candidates[i];
    if (!cand) {
      continue;
    }

    const loss = checkCandidateForcedLoss(
      board,
      cand.position,
      color,
      opponentColor,
      stoneCount,
      {
        vcfOptions: CANDIDATE_VERIFY_VCF_OPTIONS,
        miseVcfOptions: CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
        vctOptions: CANDIDATE_VERIFY_VCT_OPTIONS,
      },
    );

    if (loss) {
      cand.opponentForcedWin = loss.type;
      if (i === 0) {
        demotedBest = true;
        bestLoss = loss;
      }
    } else {
      // 安全な手を発見 → 以降の検証不要
      break;
    }
  }

  return { demotedBest, bestLoss };
}

/**
 * 候補手を安全度→スコア順にソートし、最上位の安全な候補を返す
 */
export function findSafeBest(
  candidates: ReviewCandidate[],
): ReviewCandidate | undefined {
  candidates.sort((a, b) => {
    const aUnsafe = a.opponentForcedWin ? 1 : 0;
    const bUnsafe = b.opponentForcedWin ? 1 : 0;
    if (aUnsafe !== bUnsafe) {
      return aUnsafe - bUnsafe;
    }
    return b.searchScore - a.searchScore;
  });
  return candidates.find((c) => !c.opponentForcedWin);
}
