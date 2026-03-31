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
 *
 * WASMバイナリが利用可能な場合はWASM版で探索し、
 * なければTS版にフォールバックする。
 */

import * as fs from "node:fs";
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

/** findBestMoveIterativeWithTT の結果型 */
interface FindBestMoveResult {
  position: Position;
  score: number;
  completedDepth: number;
  interrupted: boolean;
}

/** 新シグネチャ（パラメータオブジェクト版） */
type FindBestMoveFnNew = (params: {
  board: BoardState;
  color: "black" | "white";
  maxDepth: number;
  timeLimit: number;
  randomFactor?: number;
  evaluationOptions?: unknown;
  maxNodes?: number;
}) => FindBestMoveResult;

/** 旧シグネチャ（位置引数版、古いコミットとの互換用） */
type FindBestMoveFnOld = (
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  randomFactor?: number,
  evaluationOptions?: unknown,
  maxNodes?: number,
) => FindBestMoveResult;

type FindBestMoveFn = FindBestMoveFnNew | FindBestMoveFnOld;

/** WASMモジュールの最低限のインターフェース（worktreeの型定義に依存しない） */
interface WasmModuleExports {
  memory: WebAssembly.Memory;
  boardInit: () => void;
  boardSet: (row: number, col: number, value: number) => void;
  findBestMove: (
    color: number,
    maxDepth: number,
    timeLimitMs: number,
    maxNodes: number,
    absoluteTimeLimitMs: number,
    aspirationMode: number,
  ) => void;
  getResultBuffer: () => number;
  ttClear: () => void;
}

/** WASM探索のハンドラ */
interface WasmSearchHandler {
  search: (
    board: BoardState,
    color: "black" | "white",
    params: DifficultyParams,
  ) => FindBestMoveResult;
}

// WASM cell constants (matching Zig Cell enum)
const CELL_BLACK = 1;
const CELL_WHITE = 2;

// ============================================================================
// 実装
// ============================================================================

const data = workerData as BridgeWorkerData;

/**
 * 盤面をWASMメモリにコピー
 */
function boardStateToWasm(wasm: WasmModuleExports, board: BoardState): void {
  wasm.boardInit();
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      const cell = board[row]?.[col];
      if (cell === "black") {
        wasm.boardSet(row, col, CELL_BLACK);
      } else if (cell === "white") {
        wasm.boardSet(row, col, CELL_WHITE);
      }
    }
  }
}

/**
 * WASMバイナリを読み込んでインスタンス化
 * @returns WASMエクスポート、またはロード失敗時にnull
 */
async function loadWasmFromWorktree(
  worktreePath: string,
): Promise<WasmModuleExports | null> {
  const wasmPath = path.join(
    worktreePath,
    "zig",
    "zig-out",
    "bin",
    "cpu-engine.wasm",
  );

  if (!fs.existsSync(wasmPath)) {
    return null;
  }

  try {
    const buffer = fs.readFileSync(wasmPath);
    const imports = {
      env: {
        getTimestampMsExternal: () => Math.round(performance.now()),
      },
    };
    const { instance } = await WebAssembly.instantiate(buffer, imports);
    return instance.exports as unknown as WasmModuleExports;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cpu-bridge-worker] WASM load failed: ${msg}`);
    return null;
  }
}

/**
 * WASM探索ハンドラを作成
 */
function createWasmSearchHandler(wasm: WasmModuleExports): WasmSearchHandler {
  return {
    search(
      board: BoardState,
      color: "black" | "white",
      params: DifficultyParams,
    ): FindBestMoveResult {
      boardStateToWasm(wasm, board);
      wasm.ttClear();
      wasm.findBestMove(
        color === "black" ? CELL_BLACK : CELL_WHITE,
        params.depth,
        params.timeLimit,
        params.maxNodes,
        0, // absoluteTimeLimitMs
        0, // aspirationMode
      );

      // 結果バッファから読み取り
      const ptr = wasm.getResultBuffer();
      const view = new DataView(wasm.memory.buffer);
      const row = view.getUint8(ptr);
      const col = view.getUint8(ptr + 1);
      const score = view.getInt32(ptr + 2, true);
      const completedDepth = view.getUint8(ptr + 6);

      return {
        position: { row, col },
        score,
        completedDepth,
        interrupted: false,
      };
    },
  };
}

/**
 * 難易度パラメータをworktreeから読み込み
 */
async function loadDifficultyParams(
  worktreePath: string,
): Promise<DifficultyParams> {
  const cpuTypesUrl = pathToFileURL(
    path.join(worktreePath, "src", "types", "cpu.ts"),
  ).href;

  const cpuTypesModule = (await import(cpuTypesUrl)) as {
    DIFFICULTY_PARAMS?: Record<string, DifficultyParams>;
  };

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
  return customParams
    ? {
        ...baseParams,
        ...customParams,
        evaluationOptions: {
          ...baseParams.evaluationOptions,
          ...customParams.evaluationOptions,
        },
      }
    : baseParams;
}

/**
 * worktreeからTS版CPUモジュールを動的import
 */
async function loadTsCpuFromWorktree(
  worktreePath: string,
): Promise<FindBestMoveFn> {
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

  const iterativeModule = (await import(iterativeDeepeningUrl)) as {
    findBestMoveIterativeWithTT?: FindBestMoveFn;
  };

  const findBestMove = iterativeModule.findBestMoveIterativeWithTT;
  if (typeof findBestMove !== "function") {
    throw new Error(
      `findBestMoveIterativeWithTT not found in ${iterativeDeepeningUrl}. ` +
        `Available exports: ${Object.keys(iterativeModule).join(", ")}`,
    );
  }

  return findBestMove;
}

/**
 * TS版findBestMoveを新旧シグネチャ判別して呼び出す
 */
function callTsFindBestMove(
  fn: FindBestMoveFn,
  board: BoardState,
  color: "black" | "white",
  params: DifficultyParams,
): FindBestMoveResult {
  // fn.length === 1 → パラメータオブジェクト版（新）
  if (fn.length === 1) {
    return (fn as FindBestMoveFnNew)({
      board,
      color,
      maxDepth: params.depth,
      timeLimit: params.timeLimit,
      randomFactor: params.randomFactor,
      evaluationOptions: params.evaluationOptions,
      maxNodes: params.maxNodes,
    });
  }
  return (fn as FindBestMoveFnOld)(
    board,
    color,
    params.depth,
    params.timeLimit,
    params.randomFactor,
    params.evaluationOptions,
    params.maxNodes,
  );
}

async function main(): Promise<void> {
  const { worktreePath } = data;

  // 難易度パラメータを読み込み
  const params = await loadDifficultyParams(worktreePath);

  // WASM版を試行、失敗時はTS版にフォールバック
  const wasm = await loadWasmFromWorktree(worktreePath);
  let wasmHandler: WasmSearchHandler | null = null;
  let tsFindBestMove: FindBestMoveFn | null = null;

  if (wasm) {
    wasmHandler = createWasmSearchHandler(wasm);
    console.log(`[cpu-bridge-worker] WASM engine loaded for ${worktreePath}`);
  } else {
    tsFindBestMove = await loadTsCpuFromWorktree(worktreePath);
    console.log(
      `[cpu-bridge-worker] TS fallback engine loaded for ${worktreePath}`,
    );
  }

  // 初期化完了を通知
  parentPort?.postMessage({ ready: true });

  // 着手要求を処理（同期的にCPUを呼び出す）
  parentPort?.on("message", (msg: MoveRequest) => {
    const { requestId, board, color } = msg;
    const startTime = performance.now();

    try {
      const result: FindBestMoveResult = wasmHandler
        ? wasmHandler.search(board, color, params)
        : callTsFindBestMove(tsFindBestMove!, board, color, params);

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
