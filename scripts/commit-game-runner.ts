/**
 * コミット間対局コーディネーター
 *
 * 2つのbridge workerを受け取り、1ゲームを実行する。
 * 盤面管理・勝敗判定は現在ソースのrenjuRulesを使用（中立レフェリー）。
 * workerは外部から渡され、N ゲームで使い回される。
 */

import type { Worker } from "node:worker_threads";

import type { BoardState, Position } from "../src/types/game.ts";

import { WorkerMoveTimeoutError } from "./lib/workerMoveTimeoutError.ts";

/** 着手記録 */
export interface MoveRecord {
  row: number;
  col: number;
  time: number;
  isOpening: boolean;
  depth?: number;
  score?: number;
  stats?: Record<string, number>;
}

/** 対局結果 */
export interface GameResult {
  playerA: string;
  playerB: string;
  winner: "A" | "B" | "draw";
  reason: "five" | "forbidden" | "draw" | "move_limit";
  moves: number;
  duration: number;
  moveHistory: MoveRecord[];
  isABlack: boolean;
}

import { applyMove } from "../src/logic/cpu/core/boardUtils.ts";
import { detectOpponentThreats } from "../src/logic/cpu/evaluation/threatDetection.ts";
import {
  getForbiddenType,
  isForbiddenForBlack,
  preloadForbiddenWasm,
} from "../src/logic/cpu/wasm/forbiddenAdapter.ts";
import { preloadThreatWasm } from "../src/logic/cpu/wasm/threatLoader.ts";
import {
  DRAW_MOVE_LIMIT,
  checkDraw,
  checkWin,
  createEmptyBoard,
} from "../src/logic/renjuRules/index.ts";

// ============================================================================
// Worker通信の型定義
// ============================================================================

interface MoveResponse {
  requestId: number;
  position: Position;
  score: number;
  depth: number;
  thinkingTimeMs: number;
  interrupted: boolean;
  stats?: Record<string, number>;
}

interface ErrorResponse {
  requestId: number;
  error: string;
}

type WorkerMessage = MoveResponse | ErrorResponse;

// ============================================================================
// requestId管理（モジュール全体で一意）
// ============================================================================

let nextRequestId = 0;

export { WorkerMoveTimeoutError } from "./lib/workerMoveTimeoutError.ts";

/**
 * runCommitGame がハング（move-request timeout）で throw するエラー。
 * bench ハーネス（match ループ）がこれを catch して再現ダンプを書き、
 * worker を respawn して残り局を続行する。
 */
export interface HangContext {
  requestId: number;
  timeoutMs: number;
  /** ハングした側（A/B）と手番色 */
  side: "A" | "B";
  color: "black" | "white";
  /** ハング直前の盤面（再現の起点） */
  board: BoardState;
  /** ハング直前までの着手履歴（opening 3手を含む） */
  moveHistory: MoveRecord[];
  /** ゲーム開始からの経過ミリ秒 */
  elapsedMs: number;
  /** ハング時の手数（0-based, opening 3手を含む＝ハング要求は moveHistory.length 番目の手を打とうとしていた） */
  moveNumber: number;
}

export class GameHangError extends Error {
  readonly context: HangContext;

  constructor(context: HangContext) {
    super(
      `Game hang: side=${context.side} color=${context.color} moveNumber=${context.moveNumber} requestId=${context.requestId} timeoutMs=${context.timeoutMs}`,
    );
    this.name = "GameHangError";
    this.context = context;
  }
}

/**
 * workerに着手を要求し、レスポンスを待つ。
 * timeout 時は WorkerMoveTimeoutError を throw（runCommitGame が context を付与する）。
 */
function askWorker(
  worker: Worker,
  board: BoardState,
  color: "black" | "white",
  timeoutMs: number,
  side: "A" | "B",
  hangInject: boolean,
): Promise<MoveResponse> {
  return new Promise<MoveResponse>((resolve, reject) => {
    const requestId = nextRequestId++;

    const timer = setTimeout(() => {
      worker.off("message", handler);
      reject(new WorkerMoveTimeoutError({ requestId, timeoutMs, color, side }));
    }, timeoutMs);

    const handler = (msg: WorkerMessage): void => {
      if (msg.requestId !== requestId) {
        return;
      }
      worker.off("message", handler);
      clearTimeout(timer);

      if ("error" in msg) {
        reject(new Error(msg.error));
      } else {
        resolve(msg);
      }
    };

    worker.on("message", handler);
    worker.postMessage({ requestId, board, color, hangInject });
  });
}

/**
 * 石の色から勝者（A/B）を判定
 * @param winnerColor 勝ったプレイヤーの色
 * @param isABlack commitA（workerA）が黒番かどうか
 */
function colorToWinner(
  winnerColor: "black" | "white",
  isABlack: boolean,
): "A" | "B" {
  if (winnerColor === "black") {
    return isABlack ? "A" : "B";
  }
  return isABlack ? "B" : "A";
}

/**
 * ハング注入設定。指定した非オープニング手番号（1-based）で該当 side/color の
 * リクエストにハングフラグを立て、bridge worker に応答させない。
 * bench 側の回復パス（timeout → dump → worker respawn）を確実にテストするための
 * 差し込み口で、未指定時は完全に既存挙動（後方互換）。
 */
export interface HangInjectSpec {
  /** 非オープニング手番号（1-based）。この番目の要求でハングを起こす */
  requestOrdinal: number;
  /** どちらのプレイヤーで注入するか。未指定なら手番に来た側 */
  side?: "A" | "B";
}

/**
 * askWorker のラッパー。WorkerMoveTimeoutError を GameHangError に変換して throw する。
 * ループ内クロージャで no-loop-func 警告を出さないため、ループ外の関数として切り出す。
 */
async function askOrHang(
  worker: Worker,
  board: BoardState,
  color: "black" | "white",
  timeoutMs: number,
  side: "A" | "B",
  hangInject: boolean,
  moveHistory: MoveRecord[],
  gameStartTime: number,
  moveCount: number,
): Promise<MoveResponse> {
  try {
    return await askWorker(worker, board, color, timeoutMs, side, hangInject);
  } catch (err: unknown) {
    if (err instanceof WorkerMoveTimeoutError) {
      throw new GameHangError({
        requestId: err.requestId,
        timeoutMs: err.timeoutMs,
        side: err.side,
        color: err.color,
        board,
        moveHistory,
        elapsedMs: performance.now() - gameStartTime,
        moveNumber: moveCount + 1,
      });
    }
    throw err;
  }
}

/**
 * 1ゲームを実行
 *
 * @param workerA commitAのbridge worker
 * @param workerB commitBのbridge worker
 * @param isABlack commitAが黒番（先手）か
 * @param options オプション
 * @returns 対局結果（commitA = playerA, commitB = playerB）
 */
export async function runCommitGame(
  workerA: Worker,
  workerB: Worker,
  isABlack: boolean,
  options: {
    verbose?: boolean;
    moveTimeoutMs?: number;
    openingMoves?: [Position, Position, Position];
    /** テスト用: 特定の要求番目でハングを注入する */
    hangInject?: HangInjectSpec;
  } = {},
): Promise<GameResult> {
  // #43 PR-6: 禁手判定(forbidden) と脅威検出(detectOpponentThreats→threat) はどちらも
  // pure-wasm のため、両 thin wasm を先にロードする。
  await Promise.all([preloadForbiddenWasm(), preloadThreatWasm()]);
  const { verbose = false, moveTimeoutMs = 30000 } = options;

  let board: BoardState = createEmptyBoard();
  const moveHistory: MoveRecord[] = [];
  let currentColor: "black" | "white" = "black";
  let moveCount = 0;
  const startTime = performance.now();

  // 黒番・白番のworkerを決定
  const blackWorker = isABlack ? workerA : workerB;
  const whiteWorker = isABlack ? workerB : workerA;

  const log = (msg: string): void => {
    if (verbose) {
      console.log(msg);
    }
  };

  log(
    `Game: commitA(${isABlack ? "black" : "white"}) vs commitB(${isABlack ? "white" : "black"})`,
  );

  // 開局手が指定されている場合、盤面に配置
  if (options.openingMoves) {
    const [pos1, pos2, pos3] = options.openingMoves;
    const openingEntries: [Position, "black" | "white"][] = [
      [pos1, "black"],
      [pos2, "white"],
      [pos3, "black"],
    ];
    for (const [pos, color] of openingEntries) {
      board = applyMove(board, pos, color);
      moveHistory.push({
        row: pos.row,
        col: pos.col,
        time: 0,
        isOpening: true,
      });
      moveCount++;
      log(`Move ${moveCount}: opening at (${pos.row}, ${pos.col})`);
    }
    currentColor = "white";
  }

  // 非オープニング手のリクエスト番号（1-based）。ハング注入の照合用。
  let nonOpeningRequestOrdinal = 0;

  while (moveCount < DRAW_MOVE_LIMIT) {
    const isBlack = currentColor === "black";
    const worker = isBlack ? blackWorker : whiteWorker;
    // どちらの side (A/B) がこの手番か
    const currentSide: "A" | "B" =
      (isBlack && isABlack) || (!isBlack && !isABlack) ? "A" : "B";

    nonOpeningRequestOrdinal++;
    const shouldInject =
      options.hangInject !== undefined &&
      options.hangInject.requestOrdinal === nonOpeningRequestOrdinal &&
      (options.hangInject.side === undefined ||
        options.hangInject.side === currentSide);

    // 着手要求（逐次実行が必要: 同じworkerを1ゲーム内で交互に使用）

    const moveStartTime = performance.now();

    const response = await askOrHang(
      worker,
      board,
      currentColor,
      moveTimeoutMs,
      currentSide,
      shouldInject,
      moveHistory,
      startTime,
      moveCount,
    );
    const moveTime = performance.now() - moveStartTime;

    const move: Position = response.position;

    // 黒の禁手チェック
    if (currentColor === "black") {
      const forbiddenType = getForbiddenType(board, move.row, move.col);
      if (forbiddenType) {
        log(
          `Move ${moveCount + 1}: forbidden at (${move.row}, ${move.col}) - ${forbiddenType}`,
        );
        moveHistory.push({
          row: move.row,
          col: move.col,
          time: moveTime,
          isOpening: false,
          score: response.score,
          depth: response.depth,
        });
        return {
          playerA: "commitA",
          playerB: "commitB",
          winner: colorToWinner("white", isABlack),
          reason: "forbidden",
          moves: moveCount + 1,
          duration: performance.now() - startTime,
          moveHistory,
          isABlack,
        };
      }
    }

    // 着手を適用
    board = applyMove(board, move, currentColor);
    moveHistory.push({
      row: move.row,
      col: move.col,
      time: moveTime,
      isOpening: false,
      score: response.score,
      depth: response.depth,
      stats: response.stats,
    });
    moveCount++;

    log(`Move ${moveCount}: at (${move.row}, ${move.col})`);

    // 勝利判定
    if (checkWin(board, move, currentColor)) {
      log(`${isBlack ? "black" : "white"} wins!`);
      return {
        playerA: "commitA",
        playerB: "commitB",
        winner: colorToWinner(currentColor, isABlack),
        reason: "five",
        moves: moveCount,
        duration: performance.now() - startTime,
        moveHistory,
        isABlack,
      };
    }

    // 禁手追い込み判定（白着手後、黒の防御位置が禁手なら白の勝ち）
    if (currentColor === "white") {
      const whiteThreats = detectOpponentThreats(board, "white");
      const defensePosArray =
        whiteThreats.openFours.length > 0
          ? whiteThreats.openFours
          : whiteThreats.fours;

      const [defensePos] = defensePosArray;
      if (defensePos) {
        if (isForbiddenForBlack(board, defensePos.row, defensePos.col)) {
          log(`white wins by forbidden trap!`);
          const lastMove = moveHistory[moveHistory.length - 1];
          const updatedHistory = lastMove
            ? [
                ...moveHistory.slice(0, -1),
                { ...lastMove, forcedForbidden: true },
              ]
            : moveHistory;
          return {
            playerA: "commitA",
            playerB: "commitB",
            winner: colorToWinner("white", isABlack),
            reason: "forbidden",
            moves: moveCount,
            duration: performance.now() - startTime,
            moveHistory: updatedHistory,
            isABlack,
          };
        }
      }
    }

    // 引き分け判定
    if (checkDraw(moveCount)) {
      log(`Draw at move ${moveCount}`);
      return {
        playerA: "commitA",
        playerB: "commitB",
        winner: "draw",
        reason: "move_limit",
        moves: moveCount,
        duration: performance.now() - startTime,
        moveHistory,
        isABlack,
      };
    }

    // 手番交代
    currentColor = currentColor === "black" ? "white" : "black";
  }

  // 最大手数到達
  return {
    playerA: "commitA",
    playerB: "commitB",
    winner: "draw",
    reason: "move_limit",
    moves: moveCount,
    duration: performance.now() - startTime,
    moveHistory,
    isABlack,
  };
}
