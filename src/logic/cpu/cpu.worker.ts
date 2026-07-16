/**
 * Renju CPU Web Worker
 *
 * CPUをメインスレッドから分離してUIブロッキングを回避
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import CpuWorker from './cpu.worker?worker'
 */

import type { Position } from "@/types/game";

import {
  DIFFICULTY_PARAMS,
  type CpuRequest,
  type CpuResponse,
} from "@/types/cpu";

import type { WasmModuleContext } from "./wasm/types";

import { isBookEligible } from "./bookGate";
import { countStones } from "./core/boardUtils";
import { getOpeningMove, isOpeningPhase } from "./opening";
import { getBookMove, preloadOpeningBook } from "./openingBook";
import {
  listChebyshevNeighbors,
  selectMoveWithRandomization,
} from "./randomization";
import {
  isForbiddenForBlack,
  preloadForbiddenWasm,
} from "./wasm/forbiddenAdapter";
import { loadWasmModule } from "./wasm/loader";
import { WasmSearchEngine } from "./wasm/searchEngine";

/** WASM モジュール（初回ロード後にキャッシュ） */
let cachedWasm: WasmModuleContext | null = null;

async function getWasmModule(): Promise<WasmModuleContext> {
  if (cachedWasm) {
    return cachedWasm;
  }
  cachedWasm = await loadWasmModule();
  return cachedWasm;
}

/**
 * Worker内でのメッセージハンドラ
 *
 * 開局フェーズ（1〜3手目）では珠型パターンを使用し、
 * 4手目以降はWASM探索エンジンで探索する
 */
self.onmessage = async (event: MessageEvent<CpuRequest>) => {
  const request = event.data;
  const startTime = performance.now();

  try {
    const moveCount = countStones(request.board);
    const currentTurn = request.currentTurn as "black" | "white";

    // 開局フェーズかチェック
    if (isOpeningPhase(moveCount)) {
      const openingMove = getOpeningMove(request.board, currentTurn);
      if (openingMove) {
        const endTime = performance.now();
        const thinkingTime = Math.round(endTime - startTime);

        const response: CpuResponse = {
          position: openingMove,
          score: 0, // 開局の手は評価スコアなし
          thinkingTime,
          depth: 0, // 探索なし
        };

        self.postMessage(response);
        return;
      }
    }

    // オープニングブック（hard・白番ply4〜8/黒番ply5〜7）: ヒット時はブック手を返す。
    // ミス（未ロード/未生成/ヒットなし）なら従来のWASM探索にフォールバックする。
    if (isBookEligible(request.difficulty, currentTurn, moveCount)) {
      await preloadOpeningBook();
      const bookMove = getBookMove(request.board, currentTurn);
      if (bookMove) {
        const endTime = performance.now();
        const response: CpuResponse = {
          position: bookMove,
          score: 0, // ブックの手は評価スコアなし
          thinkingTime: Math.round(endTime - startTime),
          depth: 0, // 探索なし
        };
        self.postMessage(response);
        return;
      }
    }

    // 4手目以降、または開局パターン外の場合はWASM探索
    const params = DIFFICULTY_PARAMS[request.difficulty];
    const wasm = await getWasmModule();
    const engine = new WasmSearchEngine(wasm);
    const wasmResult = engine.findBestMove(
      request.board,
      currentTurn,
      request.difficulty,
    );

    // ★1 等の弱体化: 確率で近傍空き点からランダム選択
    const finalPosition = await applyRandomization(
      wasmResult.position,
      wasmResult.score,
      request.board,
      currentTurn,
      params.randomFactor,
      params.randomCriticalScoreThreshold,
    );

    const endTime = performance.now();
    const thinkingTime = Math.round(endTime - startTime);

    const response: CpuResponse = {
      position: finalPosition,
      score: wasmResult.score,
      thinkingTime,
      depth: wasmResult.completedDepth || params.depth,
    };

    self.postMessage(response);
  } catch (error) {
    // エラー時はデフォルト位置を返す
    console.error("CPU Worker error:", error);
    const response: CpuResponse = {
      position: { row: 7, col: 7 },
      score: 0,
      thinkingTime: 0,
      depth: 0,
    };
    self.postMessage(response);
  }
};

/** 近傍ランダム選択の半径（Chebyshev 距離）。 */
const RANDOM_NEIGHBOR_RADIUS = 3;

/**
 * 弱体化レイヤ。確率で「最善手の近傍(Chebyshev≤3)の合法空き点からランダム選択」を返す。
 *
 * 全盤面ランダムだと辺境に飛んで不自然なため、bestMove 近辺に絞る。
 * 黒手番は禁手を除外。近傍に合法手がなければ bestMove にフォールバック。
 */
async function applyRandomization(
  bestMove: Position,
  bestMoveScore: number,
  board: CpuRequest["board"],
  turn: "black" | "white",
  randomFactor: number,
  criticalScoreThreshold: number | undefined,
): Promise<Position> {
  if (randomFactor <= 0) {
    return bestMove;
  }
  if (turn === "black") {
    await preloadForbiddenWasm();
  }
  const neighbors = listChebyshevNeighbors(bestMove, RANDOM_NEIGHBOR_RADIUS);
  const candidates = neighbors.filter((p) => {
    if (board[p.row]?.[p.col] !== null) {
      return false;
    }
    if (turn === "black" && isForbiddenForBlack(board, p.row, p.col)) {
      return false;
    }
    return true;
  });
  return selectMoveWithRandomization({
    bestMove,
    bestMoveScore,
    criticalScoreThreshold,
    randomFactor,
    pickRandomMove: () => {
      if (candidates.length === 0) {
        return null;
      }
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx] ?? null;
    },
  });
}

// TypeScript用の型宣言
export type { CpuRequest, CpuResponse };
