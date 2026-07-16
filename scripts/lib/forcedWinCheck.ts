/**
 * 強制勝ち判定コア（SSoT）。
 *
 * regression-positions.ts（過去の敗着局面の手動回帰チェック）と trap-mining.ts
 * （序盤トラップ採掘パイプライン）の両方が使う「hard（実機経路）に着手させ、
 * その直後の局面で相手に強制勝ち（VCF∪VCT）が生じるか」を判定する処理を
 * 一本化する。判定基準がドリフトしないよう、別実装を持たないこと。
 *
 * VCF/VCT の探索予算は investigate-white-collapse.ts の調査時に使用した値と同等
 * （十分な探索深度・時間）: VCF(depth16/5s/500k) ∪ VCT(depth6/5s/500k)。
 */
import type { BoardState, Position } from "@/types/game";

import { getOppositeColor, applyMove } from "@/logic/cpu/core/boardUtils";
import {
  encodeEvalOptions,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { formatMove } from "@/logic/gameRecordParser";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

export type Side = "black" | "white";

export const VCF_MAX_DEPTH = 16;
export const VCF_TIME_LIMIT_MS = 5000;
export const VCF_MAX_NODES = 500_000;
export const VCT_MAX_DEPTH = 6;
export const VCT_TIME_LIMIT_MS = 5000;
export const VCT_MAX_NODES = 500_000;

export interface ForcedWinAfterMoveResult {
  /** move を打った後の局面 */
  afterMoveBoard: BoardState;
  /** 相手に強制勝ちが生じたか。生じなければ null */
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequence: Position[] | null;
  forcedWinSequenceStr: string | null;
}

export interface ForcedWinCheckResult extends ForcedWinAfterMoveResult {
  /** hard が選んだ手 */
  chosenMove: Position;
  chosenMoveStr: string;
  elapsedMs: number;
}

export interface HardMoveChoice {
  position: Position;
  positionStr: string;
}

/**
 * hard（実機経路: WasmSearchEngine.findBestMove）に着手させ、選んだ手を返す。
 * 強制勝ち判定は行わない（trap-mining.ts のパイプラインで白4/白6のように
 * 「hard の応手を進めるだけ」で強制勝ち判定が不要な段で使う軽量版）。
 *
 * @param hardTimeLimitMs 指定すると DIFFICULTY_PARAMS.hard の depth/maxNodes/
 *   evaluationOptions は据え置きで timeLimit だけ差し替える
 *   （trap-mining.ts のパイプライン予算短縮用のレバー。severity-A の確定は
 *   別途、実機 hard（省略時 = 本番 timeLimit）での再検証ゲートを通す）。
 *   省略時は実機 hard と完全に同じ挙動。
 */
export function chooseHardMove(
  engine: WasmSearchEngine,
  board: BoardState,
  sideToMove: Side,
  hardTimeLimitMs?: number,
): HardMoveChoice {
  const result =
    hardTimeLimitMs === undefined
      ? engine.findBestMove(board, sideToMove, "hard")
      : (() => {
          const hardParams = DIFFICULTY_PARAMS.hard;
          return engine.findBestMoveWithParams(
            board,
            sideToMove,
            hardParams.depth,
            hardTimeLimitMs,
            hardParams.maxNodes,
            encodeEvalOptions(hardParams.evaluationOptions),
          );
        })();
  return {
    position: result.position,
    positionStr: formatMove(result.position),
  };
}

/**
 * sideToMove が move を着手した後の局面で、相手側に VCF/VCT（強制勝ち手順）が
 * 生じるか判定する。move は呼び出し側が既に決めた手（chooseHardMove を経由しない）。
 * オープニングブックの手など、engine の選択を経ない手を検証する用途向け
 * （opening-book-2026-07-16.md §5 ゲート1）。
 */
export function checkForcedWinAfterMove(
  engine: WasmSearchEngine,
  board: BoardState,
  sideToMove: Side,
  move: Position,
): ForcedWinAfterMoveResult {
  const opponent = getOppositeColor(sideToMove);
  const afterMoveBoard = applyMove(board, move, sideToMove);

  const vcf = engine.findVCFSequence(
    afterMoveBoard,
    opponent,
    VCF_MAX_DEPTH,
    VCF_TIME_LIMIT_MS,
    VCF_MAX_NODES,
  );
  const forcedWin =
    vcf ??
    engine.findVCTSequence(
      afterMoveBoard,
      opponent,
      VCT_MAX_DEPTH,
      VCT_TIME_LIMIT_MS,
      VCT_MAX_NODES,
      false,
    );

  if (!forcedWin) {
    return {
      afterMoveBoard,
      forcedWinKind: null,
      forcedWinSequence: null,
      forcedWinSequenceStr: null,
    };
  }
  return {
    afterMoveBoard,
    forcedWinKind: vcf ? "VCF" : "VCT",
    forcedWinSequence: forcedWin.sequence,
    forcedWinSequenceStr: forcedWin.sequence.map(formatMove).join(" "),
  };
}

/**
 * hard（実機経路: WasmSearchEngine.findBestMove）に着手させ、着手後の局面で
 * 相手側に VCF/VCT（強制勝ち手順）が生じるか判定する。
 *
 * @param hardTimeLimitMs chooseHardMove と同じ（パイプライン予算短縮用のレバー）。
 *   省略時は実機 hard と完全に同じ挙動（regression-positions.ts の従来動作）。
 */
export function checkForcedWin(
  engine: WasmSearchEngine,
  board: BoardState,
  sideToMove: Side,
  hardTimeLimitMs?: number,
): ForcedWinCheckResult {
  const start = Date.now();

  const { position: chosenMove, positionStr: chosenMoveStr } = chooseHardMove(
    engine,
    board,
    sideToMove,
    hardTimeLimitMs,
  );

  const afterResult = checkForcedWinAfterMove(
    engine,
    board,
    sideToMove,
    chosenMove,
  );

  const elapsedMs = Date.now() - start;
  return {
    chosenMove,
    chosenMoveStr,
    ...afterResult,
    elapsedMs,
  };
}
