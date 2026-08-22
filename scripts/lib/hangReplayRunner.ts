/**
 * ハング再現の実行エンジン（#128）。
 *
 * 「計画」は `hangReplay.ts`（純粋関数）、「実行」はここ、「CLI と worker 起動」は
 * `scripts/replay-hang.ts` という分担。着手要求の送信を関数として受け取るので、
 * worker を起動せずに単体テストできる。
 *
 * 再生の考え方: ハングした側の手番だけを同一 worker に打たせ直し、相手の手は
 * 棋譜どおり盤に置く。相手側 worker は不要。
 */
import type { BoardState } from "../../src/types/game.ts";

import { applyMove } from "../../src/logic/cpu/core/boardUtils.ts";
import { createEmptyBoard } from "../../src/logic/renjuRules/index.ts";
import {
  type PlannedRequest,
  type ReplayMove,
  colorOfMoveIndex,
  planGameReplay,
} from "./hangReplay.ts";

/** 1 要求の結果（worker の応答種別） */
export interface ReplayRequestOutcome {
  status: "responded" | "timed-out" | "error";
  elapsedMs: number;
  errorMessage?: string;
}

/** 着手要求の送信関数（worker 依存部分を注入する） */
export type ReplayRequestFn = (params: {
  board: BoardState;
  color: "black" | "white";
  moveSeed: number | undefined;
}) => Promise<ReplayRequestOutcome>;

/** 再生する 1 ステージ（＝1 局分の棋譜） */
export interface ReplayStage {
  /** 表示用ラベル（例: "g12 寒星 (A黒)"） */
  label: string;
  moves: ReplayMove[];
  isABlack: boolean;
  gameSeed?: number;
}

/** 再生の失敗（ハング再現 or worker エラー） */
export interface ReplayFailure {
  stageLabel: string;
  moveNumber: number;
  status: "timed-out" | "error";
  elapsedMs: number;
  errorMessage?: string;
}

export interface ReplayStagesResult {
  /** worker に投げた要求の総数 */
  requestedMoves: number;
  /** 途中で止まった場合の情報。最後まで走れば undefined */
  failure?: ReplayFailure;
}

export interface RunReplayStagesParams {
  stages: ReplayStage[];
  /** ハングした側（この側の手番だけを要求する） */
  side: "A" | "B";
  request: ReplayRequestFn;
  /** 進捗表示のフック（省略可） */
  onStageStart?: (stage: ReplayStage, plannedRequests: number) => void;
  onRequestDone?: (
    stage: ReplayStage,
    planned: PlannedRequest,
    outcome: ReplayRequestOutcome,
    doneCount: number,
  ) => void;
}

/**
 * ステージ列を順に再生する。1 要求でも timed-out / error になったらそこで止める
 * （その時点が新しい調査対象なので、先へ進めても意味がないため）。
 */
export async function runReplayStages(
  params: RunReplayStagesParams,
): Promise<ReplayStagesResult> {
  const { stages, side, request, onStageStart, onRequestDone } = params;
  let requestedMoves = 0;

  for (const stage of stages) {
    const plan = planGameReplay({
      moves: stage.moves,
      side,
      isABlack: stage.isABlack,
      gameSeed: stage.gameSeed,
    });
    onStageStart?.(stage, plan.requests.length);

    const requestByMoveIndex = new Map<number, PlannedRequest>();
    for (const planned of plan.requests) {
      requestByMoveIndex.set(planned.moveIndex, planned);
    }

    let board: BoardState = createEmptyBoard();
    for (const [moveIndex, move] of stage.moves.entries()) {
      const planned = requestByMoveIndex.get(moveIndex);
      if (planned) {
        // 逐次実行が必須: 同一 worker に順番に要求するので並列化できない
        const outcome = await request({
          board,
          color: planned.color,
          moveSeed: planned.moveSeed,
        });
        requestedMoves++;
        onRequestDone?.(stage, planned, outcome, requestedMoves);
        if (outcome.status !== "responded") {
          return {
            requestedMoves,
            failure: {
              stageLabel: stage.label,
              moveNumber: planned.moveNumber,
              status: outcome.status,
              elapsedMs: outcome.elapsedMs,
              errorMessage: outcome.errorMessage,
            },
          };
        }
      }
      // 棋譜どおりに進める（worker が返した手ではない）。
      // 禁手負けの局では最終手が盤に置かれないまま記録されているが、
      // その手より後の要求は無いので再生に影響しない。
      board = applyMove(
        board,
        { row: move.row, col: move.col },
        colorOfMoveIndex(moveIndex),
      );
    }
  }
  return { requestedMoves };
}

/**
 * 再生に必要な要求数を数える（所要時間見積もり用）。
 */
export function countPlannedRequests(
  stages: ReplayStage[],
  side: "A" | "B",
): number {
  return stages.reduce(
    (sum, stage) =>
      sum +
      planGameReplay({
        moves: stage.moves,
        side,
        isABlack: stage.isABlack,
        gameSeed: stage.gameSeed,
      }).requests.length,
    0,
  );
}
