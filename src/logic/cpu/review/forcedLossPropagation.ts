/**
 * 被追詰（forcedLoss）の伝播ロジック
 *
 * 評価結果に対する後処理を純粋関数として提供する。
 */

import type {
  FullEvalResult,
  LightEvalResult,
  ReviewCandidate,
} from "@/types/review";

import { parseMove } from "@/logic/gameRecordParser";
import {
  buildBacktrackBranches,
  buildBacktrackSequence,
} from "@/logic/reviewLogic";

/**
 * 精密再評価の対象 moveIndex を選定する
 *
 * Phase 1(FAST) + Phase 2(VCT) の結果から敗着を暫定特定し、
 * 敗着とその前 1 手（プレイヤー手のみ）を返す。
 */
export function findPreciseTargets(
  results: (FullEvalResult | LightEvalResult)[],
  playerFirst: boolean,
): number[] {
  const sorted = [...results].sort((a, b) => a.moveIndex - b.moveIndex);

  // 敗着を暫定特定: forcedLossType を持つ最も早いプレイヤー手
  let losingMoveIdx: number | null = null;
  for (const r of sorted) {
    const isPlayerMove = playerFirst
      ? r.moveIndex % 2 === 0
      : r.moveIndex % 2 === 1;
    if (isPlayerMove && r.mode === "fullEval" && r.forcedLossType) {
      losingMoveIdx = r.moveIndex;
      break;
    }
  }

  if (losingMoveIdx === null) {
    return [];
  }

  // 敗着以前のプレイヤー手（フル評価のみ）を収集
  const playerMoveIndices = sorted
    .filter((r) => {
      const isPlayer = playerFirst
        ? r.moveIndex % 2 === 0
        : r.moveIndex % 2 === 1;
      return isPlayer && r.mode === "fullEval";
    })
    .map((r) => r.moveIndex)
    .filter((idx) => idx <= losingMoveIdx!);

  // 敗着から逆順に 2 手まで
  const reversed = [...playerMoveIndices].reverse();
  const targets: number[] = [];
  for (let i = 0; i < Math.min(2, reversed.length); i++) {
    targets.push(reversed[i]!);
  }
  return targets;
}

/**
 * 被追詰の後方伝播（軽量版）
 *
 * 全候補が opponentForcedWin の手から、前のプレイヤー手に
 * forcedLossType を伝播する。ワーカーリクエスト不要。
 */
export function propagateForcedLossBackward(
  results: (FullEvalResult | LightEvalResult)[],
  playerFirst: boolean,
  moves: string[],
): void {
  const sorted = [...results].sort((a, b) => a.moveIndex - b.moveIndex);

  for (const r of sorted) {
    if (r.mode !== "fullEval" || !r.forcedLossType) {
      continue;
    }
    const isPlayerMove = playerFirst
      ? r.moveIndex % 2 === 0
      : r.moveIndex % 2 === 1;
    if (!isPlayerMove) {
      continue;
    }

    const fr = r as FullEvalResult;
    const candidates = fr.candidates ?? [];
    if (
      candidates.length === 0 ||
      !candidates.every((c) => c.opponentForcedWin)
    ) {
      continue;
    }

    // 全候補が被追詰 → 前のプレイヤー手に伝播
    const prevPlayer = sorted
      .filter((pr): pr is FullEvalResult => {
        if (pr.mode !== "fullEval") {
          return false;
        }
        const isPM = playerFirst
          ? pr.moveIndex % 2 === 0
          : pr.moveIndex % 2 === 1;
        return isPM && pr.moveIndex < fr.moveIndex;
      })
      .pop();

    if (prevPlayer && !prevPlayer.forcedLossType) {
      prevPlayer.forcedLossType = fr.forcedLossType;
      prevPlayer.forcedLossSequence = buildBacktrackSequence(
        moves,
        prevPlayer.moveIndex,
        fr.moveIndex,
        fr.forcedLossSequence,
      );
      const branches = buildBacktrackBranches(
        moves,
        prevPlayer.moveIndex,
        fr.moveIndex,
        candidates as ReviewCandidate[],
      );
      if (branches.length > 0) {
        prevPlayer.forcedLossBranches = branches;
      }
    }
  }
}

/**
 * forcedLossType が付いた手の打たれた候補に opponentForcedWin を伝播する
 */
export function propagateForcedLossToCandidates(
  results: (FullEvalResult | LightEvalResult)[],
  moves: string[],
): void {
  for (const r of results) {
    if (r.mode !== "fullEval" || !r.forcedLossType) {
      continue;
    }
    const fr = r as FullEvalResult;
    const moveStr = moves[fr.moveIndex];
    if (!moveStr || !fr.candidates) {
      continue;
    }
    const pos = parseMove(moveStr);
    const cand = fr.candidates.find(
      (c) => c.position.row === pos.row && c.position.col === pos.col,
    );
    if (cand && !cand.opponentForcedWin) {
      cand.opponentForcedWin = fr.forcedLossType;
      cand.opponentForcedWinSequence = fr.forcedLossSequence;
    }
  }
}
