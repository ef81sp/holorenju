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
  type ScoreBreakdown,
} from "@/types/cpu";

import type { WasmModuleContext } from "./wasm/types";

import { countStones } from "./core/boardUtils";
import {
  evaluateBoardWithBreakdown,
  evaluatePositionWithBreakdown,
} from "./evaluation";
import { getOpeningMove, isOpeningPhase } from "./opening";
import { findBestMoveIterativeWithTT } from "./search/minimax";
import { type BoardEvaluator, WasmBoardEvaluator } from "./wasm/bridge";
import { loadWasmModule } from "./wasm/loader";
import { WasmSearchEngine } from "./wasm/searchEngine";

/** WASM モジュール（初回ロード後にキャッシュ） */
let cachedWasm: WasmModuleContext | null = null;

async function getWasmModule(): Promise<WasmModuleContext | null> {
  if (cachedWasm) {
    return cachedWasm;
  }
  try {
    cachedWasm = await loadWasmModule();
    return cachedWasm;
  } catch {
    console.warn("WASM module unavailable, falling back to TS");
    return null;
  }
}

async function getWasmEvaluator(): Promise<BoardEvaluator | null> {
  const wasm = await getWasmModule();
  return wasm ? new WasmBoardEvaluator(wasm) : null;
}

/**
 * Worker内でのメッセージハンドラ
 *
 * 開局フェーズ（1〜3手目）では珠型パターンを使用し、
 * 4手目以降はIterative Deepeningで探索する
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

    // 4手目以降、または開局パターン外の場合は通常のCPU探索
    const params = DIFFICULTY_PARAMS[request.difficulty];

    // WASMモジュールをロード（初回のみ、以降はキャッシュ）
    const wasm = await getWasmModule();

    // WASM探索エンジンが利用可能ならWASM版で探索（エラー時はTS版にフォールバック）
    if (wasm) {
      try {
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
        return;
      } catch (wasmError) {
        console.warn("WASM探索でエラー発生、TS版にフォールバック:", wasmError);
        // フォールバック: 下のTS版処理に進む
      }
    }

    // WASM非対応の場合はTS版でフォールバック
    const boardEvaluator = (await getWasmEvaluator()) ?? undefined;

    // Iterative Deepeningで探索（TT/Move Ordering統合版）
    const result = findBestMoveIterativeWithTT({
      board: request.board,
      color: currentTurn,
      maxDepth: params.depth,
      timeLimit: params.timeLimit,
      randomFactor: params.randomFactor,
      evaluationOptions: params.evaluationOptions,
      maxNodes: params.maxNodes,
      scoreThreshold: params.scoreThreshold,
      boardEvaluator,
    });

    const endTime = performance.now();
    const thinkingTime = Math.round(endTime - startTime);

    // 候補手を上位5手に制限（通信オーバーヘッド削減）
    // 各候補手の内訳を計算
    const candidates = result.candidates?.slice(0, 5).map((entry, index) => {
      // 即時評価の内訳を計算
      const { score: breakdownScore, breakdown } =
        evaluatePositionWithBreakdown(
          request.board,
          entry.move.row,
          entry.move.col,
          currentTurn,
          params.evaluationOptions,
        );

      // 探索末端の評価内訳を計算（PVがある場合）
      const leafEvaluation =
        entry.pvLeafBoard && entry.pvLeafColor
          ? evaluateBoardWithBreakdown(entry.pvLeafBoard, currentTurn)
          : undefined;

      return {
        position: entry.move,
        score: Math.round(breakdownScore), // 即時評価（内訳の合計）
        searchScore: entry.score, // 探索スコア（順位の根拠）
        rank: index + 1,
        breakdown: breakdown as ScoreBreakdown,
        principalVariation: entry.pv, // 予想手順
        leafEvaluation, // 探索末端の評価内訳
      };
    });

    // 深度履歴を変換
    const depthHistory = result.depthHistory?.map((entry) => ({
      depth: entry.depth,
      position: entry.position,
      score: entry.score,
    }));

    const response: CpuResponse = {
      position: result.position,
      score: result.score,
      thinkingTime,
      depth: result.completedDepth,
      candidates,
      randomSelection: result.randomSelection
        ? {
            wasRandom: result.randomSelection.wasRandom,
            wasTieBreak: result.randomSelection.wasTieBreak,
            originalRank: result.randomSelection.originalRank,
            candidateCount: result.randomSelection.candidateCount,
            randomFactor: params.randomFactor,
          }
        : undefined,
      depthHistory,
      searchStats: result.stats,
      forcedMove: result.forcedMove,
      timePressureFallback: result.timePressureFallback,
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
