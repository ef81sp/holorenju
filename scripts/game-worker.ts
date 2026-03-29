/**
 * 対局ワーカー
 * worker_threads で並列実行される
 */

import { parentPort, workerData } from "node:worker_threads";

import type { Position } from "../src/types/game.ts";

import {
  runHeadlessGame,
  type GameResult,
  type PlayerConfig,
} from "../src/logic/cpu/benchmark/headless.ts";
import {
  applyPatternScoreOverrides,
  type PatternScoreValues,
} from "../src/logic/cpu/evaluation/patternScores.ts";
import {
  type BoardEvaluator,
  WasmBoardEvaluator,
} from "../src/logic/cpu/wasm/bridge.ts";
import { loadWasmModule } from "../src/logic/cpu/wasm/loader.ts";

interface WorkerData {
  taskId: number;
  playerA: PlayerConfig;
  playerB: PlayerConfig;
  verbose: boolean;
  scoreOverrides?: Partial<PatternScoreValues>;
  openingMoves?: [Position, Position, Position];
  useWasmEval?: boolean;
}

interface WorkerResult {
  taskId: number;
  result: GameResult;
}

async function run(): Promise<void> {
  const data = workerData as WorkerData;

  if (data.scoreOverrides && Object.keys(data.scoreOverrides).length > 0) {
    applyPatternScoreOverrides(data.scoreOverrides);
  }

  let boardEvaluator: BoardEvaluator | undefined = undefined;
  if (data.useWasmEval) {
    const wasm = await loadWasmModule();
    boardEvaluator = new WasmBoardEvaluator(wasm);
  }

  const result = runHeadlessGame(data.playerA, data.playerB, {
    verbose: data.verbose,
    openingMoves: data.openingMoves,
    boardEvaluator,
  });

  const response: WorkerResult = {
    taskId: data.taskId,
    result,
  };

  parentPort?.postMessage(response);
}

run().catch((err) => {
  console.error("Worker error:", err);
  process.exit(1);
});
