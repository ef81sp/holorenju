/**
 * 候補手の事後検証（相手の強制勝ち検出）
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState } from "@/types/game";
import type { ForcedLossResult, ReviewCandidate } from "@/types/review";

import type { WasmSearchEngine } from "../wasm/searchEngine";

import {
  checkCandidateForcedLoss,
  CANDIDATE_VERIFY_VCF_OPTIONS,
  CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
  CANDIDATE_VERIFY_VCT_OPTIONS,
  REVIEW_VCF_OPTIONS,
} from "./forcedLossCheck";
import { wasmFindVCFSequence } from "./wasmAdapters";

/**
 * 候補手リストを事後検証し、相手に強制勝ちを許す手にフラグを付ける
 *
 * 最善手（index 0）から順に検証し、安全な手が見つかった時点で打ち切る。
 * @param timeBudgetMs 時間制限（ms）。`Infinity` で無制限。
 * @returns demotedBest - 最善手が降格されたか
 */
export function verifyCandidates(
  board: BoardState,
  candidates: ReviewCandidate[],
  color: "black" | "white",
  opponentColor: "black" | "white",
  stoneCount: number,
  timeBudgetMs: number,
  wasmSearchEngine: WasmSearchEngine,
): { demotedBest: boolean; bestLoss?: ForcedLossResult } {
  const deadline = performance.now() + timeBudgetMs;
  let demotedBest = false;
  let bestLoss: ForcedLossResult | undefined = undefined;

  for (let i = 0; i < candidates.length; i++) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      break;
    }
    const cand = candidates[i];
    if (!cand) {
      continue;
    }

    // 残り時間を残り候補数で均等配分し、per-candidate の上限を設定
    const remainingCandidates = candidates.length - i;
    const perCandidateLimit = remaining / remainingCandidates;

    const loss = checkCandidateForcedLoss(
      board,
      cand.position,
      color,
      opponentColor,
      stoneCount,
      wasmSearchEngine,
      {
        vcfOptions: {
          ...CANDIDATE_VERIFY_VCF_OPTIONS,
          timeLimit: Math.min(
            CANDIDATE_VERIFY_VCF_OPTIONS.timeLimit ?? 1000,
            perCandidateLimit,
          ),
        },
        miseVcfOptions: {
          ...CANDIDATE_VERIFY_MISE_VCF_OPTIONS,
          vcfOptions: {
            ...CANDIDATE_VERIFY_MISE_VCF_OPTIONS.vcfOptions,
            timeLimit: Math.min(
              CANDIDATE_VERIFY_MISE_VCF_OPTIONS.vcfOptions?.timeLimit ?? 1000,
              perCandidateLimit,
            ),
          },
          timeLimit: Math.min(
            CANDIDATE_VERIFY_MISE_VCF_OPTIONS.timeLimit ?? 1000,
            perCandidateLimit,
          ),
        },
        vctOptions: {
          ...CANDIDATE_VERIFY_VCT_OPTIONS,
          timeLimit: Math.min(
            CANDIDATE_VERIFY_VCT_OPTIONS.timeLimit ?? 2000,
            perCandidateLimit,
          ),
          vcfOptions: {
            ...CANDIDATE_VERIFY_VCT_OPTIONS.vcfOptions,
            timeLimit: Math.min(
              CANDIDATE_VERIFY_VCT_OPTIONS.vcfOptions?.timeLimit ?? 1000,
              perCandidateLimit,
            ),
          },
        },
      },
    );

    if (loss) {
      cand.opponentForcedWin = loss.type;
      cand.opponentForcedWinSequence = loss.sequence;
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

/**
 * 候補手にフクミ手（放置したらVCFになる手）のアノテーションを付ける
 *
 * 各候補手Mについて:
 *   1. Mを仮配置（color側の石として）
 *   2. color側にVCFがあるか判定
 *   3. VCFがあれば isFukumi=true, fukumiDepth=VCF手数 を設定
 *   4. 仮配置を戻す
 */
export function annotateFukumiMoves(
  candidates: ReviewCandidate[],
  board: BoardState,
  color: "black" | "white",
  wasmSearchEngine: WasmSearchEngine,
): void {
  for (const cand of candidates) {
    const row = board[cand.position.row];
    if (!row) {
      continue;
    }

    row[cand.position.col] = color;
    try {
      const vcfResult = wasmFindVCFSequence(
        wasmSearchEngine,
        board,
        color,
        REVIEW_VCF_OPTIONS,
      );
      if (vcfResult) {
        cand.isFukumi = true;
        cand.fukumiDepth = vcfResult.sequence.length;
      }
    } finally {
      row[cand.position.col] = null;
    }
  }
}
