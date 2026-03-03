/**
 * CPUブリッジワーカー
 *
 * 特定のgit worktreeのCPU実装を使って着手を計算するworker。
 * commit-bench.ts から起動され、全ゲームで同じインスタンスを使い回す。
 *
 * 起動パターン:
 *   new Worker("cpu-bridge-worker.ts", {
 *     workerData: { worktreePath, difficulty, customParams },
 *     execArgv: ["--import", "{worktreePath}/scripts/register-loader.mjs"]
 *   })
 *
 * worktreeの register-loader.mjs が @/ を worktreeの src/ に解決するため、
 * 動的importされたCPUモジュールは正しいworktreeのコードを使用する。
 */

import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

import type { DifficultyParams } from "../src/types/cpu.ts";
import type { BoardState, Position } from "../src/types/game.ts";

// ============================================================================
// 型定義
// ============================================================================

interface BridgeWorkerData {
  worktreePath: string;
  difficulty: string;
  customParams?: Partial<DifficultyParams>;
}

interface MoveRequest {
  requestId: number;
  board: BoardState;
  color: "black" | "white";
}

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

/** findBestMoveIterativeWithTT の最低限の型（worktreeから動的importする） */
type FindBestMoveFn = (
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  randomFactor?: number,
  evaluationOptions?: unknown,
  maxNodes?: number,
) => {
  position: Position;
  score: number;
  completedDepth: number;
  interrupted: boolean;
};

// ============================================================================
// 実装
// ============================================================================

const data = workerData as BridgeWorkerData;

/**
 * worktreeからCPUモジュールを動的import
 * 絶対URLを使用してworktreeのソースを確実に読む
 */
async function loadCpuFromWorktree(worktreePath: string): Promise<{
  findBestMove: FindBestMoveFn;
  params: DifficultyParams;
}> {
  const iterativeDeepeningUrl = pathToFileURL(
    path.join(
      worktreePath,
      "src",
      "logic",
      "cpu",
      "search",
      "iterativeDeepening.ts",
    ),
  ).href;

  const cpuTypesUrl = pathToFileURL(
    path.join(worktreePath, "src", "types", "cpu.ts"),
  ).href;

  const [iterativeModule, cpuTypesModule] = (await Promise.all([
    import(iterativeDeepeningUrl),
    import(cpuTypesUrl),
  ])) as [
    { findBestMoveIterativeWithTT?: FindBestMoveFn },
    { DIFFICULTY_PARAMS?: Record<string, DifficultyParams> },
  ];

  const findBestMove = iterativeModule.findBestMoveIterativeWithTT;
  if (typeof findBestMove !== "function") {
    throw new Error(
      `findBestMoveIterativeWithTT not found in ${iterativeDeepeningUrl}. ` +
        `Available exports: ${Object.keys(iterativeModule).join(", ")}`,
    );
  }

  const difficultyParams = cpuTypesModule.DIFFICULTY_PARAMS;
  if (!difficultyParams) {
    throw new Error(`DIFFICULTY_PARAMS not found in ${cpuTypesUrl}`);
  }

  const { difficulty } = data;
  const baseParams = difficultyParams[difficulty];
  if (!baseParams) {
    throw new Error(
      `Difficulty "${difficulty}" not found in DIFFICULTY_PARAMS. ` +
        `Available: ${Object.keys(difficultyParams).join(", ")}`,
    );
  }

  const { customParams } = data;
  const params: DifficultyParams = customParams
    ? {
        ...baseParams,
        ...customParams,
        evaluationOptions: {
          ...baseParams.evaluationOptions,
          ...customParams.evaluationOptions,
        },
      }
    : baseParams;

  return { findBestMove, params };
}

async function main(): Promise<void> {
  const { worktreePath } = data;

  const { findBestMove, params } = await loadCpuFromWorktree(worktreePath);

  // 初期化完了を通知
  parentPort?.postMessage({ ready: true });

  // 着手要求を処理（同期的にCPUを呼び出す）
  parentPort?.on("message", (msg: MoveRequest) => {
    const { requestId, board, color } = msg;
    const startTime = performance.now();

    try {
      const result = findBestMove(
        board,
        color,
        params.depth,
        params.timeLimit,
        params.randomFactor,
        params.evaluationOptions,
        params.maxNodes,
      );

      const thinkingTimeMs = performance.now() - startTime;

      const response: MoveResponse = {
        requestId,
        position: result.position,
        score: result.score,
        depth: result.completedDepth,
        thinkingTimeMs,
        interrupted: result.interrupted,
      };

      parentPort?.postMessage(response);
    } catch (err: unknown) {
      const errorResponse: ErrorResponse = {
        requestId,
        error: err instanceof Error ? err.message : String(err),
      };
      parentPort?.postMessage(errorResponse);
    }
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[cpu-bridge-worker] Initialization failed: ${message}`);
  process.exit(1);
});
