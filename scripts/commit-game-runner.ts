/**
 * コミット間対局コーディネーター
 *
 * 2つのbridge workerを受け取り、1ゲームを実行する。
 * 盤面管理・勝敗判定は現在ソースのrenjuRulesを使用（中立レフェリー）。
 * workerは外部から渡され、N ゲームで使い回される。
 */

import type { Worker } from "node:worker_threads";

import type {
  GameResult,
  MoveRecord,
} from "../src/logic/cpu/benchmark/headless.ts";
import type { BoardState, Position } from "../src/types/game.ts";

import { applyMove } from "../src/logic/cpu/core/boardUtils.ts";
import { detectOpponentThreats } from "../src/logic/cpu/evaluation/threatDetection.ts";
import {
  DRAW_MOVE_LIMIT,
  checkDraw,
  checkForbiddenMove,
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

/**
 * workerに着手を要求し、レスポンスを待つ
 */
function askWorker(
  worker: Worker,
  board: BoardState,
  color: "black" | "white",
  timeoutMs: number,
): Promise<MoveResponse> {
  return new Promise<MoveResponse>((resolve, reject) => {
    const requestId = nextRequestId++;

    const timer = setTimeout(() => {
      worker.off("message", handler);
      reject(
        new Error(`Worker move request timed out (requestId=${requestId})`),
      );
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
    worker.postMessage({ requestId, board, color });
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
  } = {},
): Promise<GameResult> {
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

  while (moveCount < DRAW_MOVE_LIMIT) {
    const isBlack = currentColor === "black";
    const worker = isBlack ? blackWorker : whiteWorker;

    // 着手要求（逐次実行が必要: 同じworkerを1ゲーム内で交互に使用）

    const moveStartTime = performance.now();

    const response = await askWorker(
      worker,
      board,
      currentColor,
      moveTimeoutMs,
    );
    const moveTime = performance.now() - moveStartTime;

    const move: Position = response.position;

    // 黒の禁手チェック
    if (currentColor === "black") {
      const forbidden = checkForbiddenMove(board, move.row, move.col);
      if (forbidden.isForbidden) {
        log(
          `Move ${moveCount + 1}: forbidden at (${move.row}, ${move.col}) - ${forbidden.type}`,
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
        const forbiddenResult = checkForbiddenMove(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
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
