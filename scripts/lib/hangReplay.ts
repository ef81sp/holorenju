/**
 * ハング再現の共通ロジック（#128）。
 *
 * 「何手目を誰が打つか」「その手の PRNG seed は何か」は commit-bench の対局ループと
 * replay-hang の再生で**必ず一致していなければならない**。ずれると replay は黙って
 * 別の seed・別の手番で探索し、「再現せず」という誤った結論になる。
 * そのため導出規則はこのモジュールに一本化し、両者がここを呼ぶ。
 */
import { mixSeed } from "./mulberry32.ts";

/** 再生に必要な最小限の着手情報（座標＋開局手フラグ） */
export interface ReplayMove {
  row: number;
  col: number;
  isOpening: boolean;
}

/**
 * 手番の色。連珠は黒先で、開局手 3 手（黒白黒）を含めて必ず交互に進むため、
 * 着手インデックス（0-based）の偶奇だけで決まる。
 */
export function colorOfMoveIndex(index: number): "black" | "white" {
  return index % 2 === 0 ? "black" : "white";
}

/**
 * 側（A/B）と先後割当から、その側が担当した石色を求める。
 */
export function sideColor(
  side: "A" | "B",
  isABlack: boolean,
): "black" | "white" {
  if (side === "A") {
    return isABlack ? "black" : "white";
  }
  return isABlack ? "white" : "black";
}

/**
 * baseSeed（--seed）と局 index から、その局の gameSeed を導出する。
 * commit-bench の getGameSeed と同一である必要がある。
 */
export function deriveGameSeed(
  baseSeed: number | undefined,
  gameIdx: number,
): number | undefined {
  return baseSeed === undefined ? undefined : mixSeed(baseSeed, gameIdx);
}

/**
 * gameSeed と非オープニング要求の通し番号（1-based）から moveSeed を導出する。
 * commit-game-runner の 1 手ごとの導出と同一である必要がある。
 */
export function deriveMoveSeed(
  gameSeed: number | undefined,
  nonOpeningOrdinal: number,
): number | undefined {
  return gameSeed === undefined
    ? undefined
    : mixSeed(gameSeed, nonOpeningOrdinal);
}

/** 再生時に worker へ投げる 1 要求 */
export interface PlannedRequest {
  /** moves 配列上のインデックス（この手を打つ「前」の盤面で要求する） */
  moveIndex: number;
  /** 1-based の手数（開局手込み） */
  moveNumber: number;
  /** 非オープニング要求の通し番号（1-based） */
  nonOpeningOrdinal: number;
  color: "black" | "white";
  moveSeed?: number;
}

export interface PlanGameReplayParams {
  moves: ReplayMove[];
  /** ハングした側（この側の手番だけを worker に要求する） */
  side: "A" | "B";
  isABlack: boolean;
  gameSeed?: number;
}

export interface GameReplayPlan {
  /** ハングした側がこの局で持っていた石色 */
  color: "black" | "white";
  /** worker に投げるべき要求（moves の順） */
  requests: PlannedRequest[];
}

/**
 * 1 局分の再生計画を立てる純粋関数。
 *
 * ハングした側の**非オープニング手だけ**を要求対象にする。相手側の手は棋譜どおりに
 * 盤へ適用するだけでよく、相手 worker を起動する必要はない。
 */
export function planGameReplay(params: PlanGameReplayParams): GameReplayPlan {
  const { moves, side, isABlack, gameSeed } = params;
  const color = sideColor(side, isABlack);
  const requests: PlannedRequest[] = [];
  let nonOpeningOrdinal = 0;
  for (const [moveIndex, move] of moves.entries()) {
    if (move.isOpening) {
      continue;
    }
    nonOpeningOrdinal++;
    if (colorOfMoveIndex(moveIndex) !== color) {
      continue;
    }
    requests.push({
      moveIndex,
      moveNumber: moveIndex + 1,
      nonOpeningOrdinal,
      color,
      moveSeed: deriveMoveSeed(gameSeed, nonOpeningOrdinal),
    });
  }
  return { color, requests };
}

/**
 * moves 列のうち非オープニング手の通し番号を、ある手数（1-based）について求める。
 * ダンプのハング手について moveSeed を再導出するときのフォールバックに使う
 * （権威は telemetry.pendingRequest.moveSeed）。
 */
export function nonOpeningOrdinalOf(
  moves: ReplayMove[],
  moveNumber: number,
): number {
  let ordinal = 0;
  for (let i = 0; i < moveNumber && i < moves.length + 1; i++) {
    const move = moves[i];
    // moveNumber がちょうど moves.length + 1（次に打つ手）なら最後は未記録手
    if (move === undefined || !move.isOpening) {
      ordinal++;
    }
  }
  return ordinal;
}
