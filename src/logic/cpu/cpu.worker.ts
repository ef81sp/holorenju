/**
 * Renju CPU Web Worker
 *
 * CPUをメインスレッドから分離してUIブロッキングを回避
 *
 * Viteの?workerサフィックスでインポートして使用:
 * import CpuWorker from './cpu.worker?worker'
 */

import {
  DIFFICULTY_PARAMS,
  type CpuRequest,
  type CpuResponse,
} from "@/types/cpu";

import type { WasmModuleContext } from "./wasm/types";

import { countStones } from "./core/boardUtils";
import { getOpeningMove, isOpeningPhase } from "./opening";
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

    // 4手目以降、または開局パターン外の場合はWASM探索
    const params = DIFFICULTY_PARAMS[request.difficulty];
    const wasm = await getWasmModule();
    const engine = new WasmSearchEngine(wasm);
    const wasmResult = engine.findBestMove(
      request.board,
      currentTurn,
      request.difficulty,
    );

    const endTime = performance.now();
    const thinkingTime = Math.round(endTime - startTime);

    const response: CpuResponse = {
      position: wasmResult.position,
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

// TypeScript用の型宣言
export type { CpuRequest, CpuResponse };
