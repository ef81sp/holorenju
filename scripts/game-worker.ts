/**
 * 対局ワーカー
 * worker_threads で並列実行される
 */

import { parentPort, workerData } from "node:worker_threads";

import {
  runHeadlessGame,
  type GameResult,
  type PlayerConfig,
} from "../src/logic/cpu/benchmark/headless.ts";
import {
  applyPatternScoreOverrides,
  type PatternScoreValues,
} from "../src/logic/cpu/evaluation/patternScores.ts";

interface WorkerData {
  taskId: number;
  playerA: PlayerConfig;
  playerB: PlayerConfig;
  verbose: boolean;
  scoreOverrides?: Partial<PatternScoreValues>;
}

interface WorkerResult {
  taskId: number;
  result: GameResult;
}

const data = workerData as WorkerData;

if (data.scoreOverrides && Object.keys(data.scoreOverrides).length > 0) {
  applyPatternScoreOverrides(data.scoreOverrides);
}

const result = runHeadlessGame(data.playerA, data.playerB, {
  verbose: data.verbose,
});

const response: WorkerResult = {
  taskId: data.taskId,
  result,
};

parentPort?.postMessage(response);
