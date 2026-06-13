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

import { EVAL_PARAM_IDS } from "./lib/evalParams.ts";

// ============================================================================
// 型定義
// ============================================================================

interface BridgeWorkerData {
  worktreePath: string;
  difficulty: string;
  customParams?: Partial<DifficultyParams>;
  /**
   * eval 形系重みの実行時注入（weight-bench 用）。キー名は EVAL_PARAM_IDS。
   * wasm が setEvalParam を export していれば適用、無ければ warn してスキップ
   * （setEvalParam 非対応の古い commit を読む commit-bench と後方互換）。
   */
  evalWeights?: Record<string, number>;
}

interface MoveRequest {
  requestId: number;
  board: BoardState;
  color: "black" | "white";
}

interface WasmSearchStats {
  nodes: number;
  ttHits: number;
  ttCutoffs: number;
  betaCutoffs: number;
  nullMoveTrials: number;
  nullMoveCutoffs: number;
  futilityPrunes: number;
  threatExtensions: number;
  lmrTrials: number;
  lmrResearches: number;
  qSearchNodes: number;
  threatProbeCutoffs: number;
}

interface MoveResponse {
  requestId: number;
  position: Position;
  score: number;
  depth: number;
  thinkingTimeMs: number;
  interrupted: boolean;
  stats?: WasmSearchStats;
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
  stats?: WasmSearchStats;
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
    evalOptionsFlags?: number,
  ) => void;
  getResultBuffer: () => number;
  getStatsBuffer?: () => number;
  ttClear: () => void;
  // eval 重み実行時注入（新しい wasm のみ。古い commit には存在しない＝optional）
  setEvalParam?: (id: number, value: number) => void;
  getEvalParam?: (id: number) => number;
  resetEvalParams?: () => void;
}

/** WASM探索のハンドラ */
interface WasmSearchHandler {
  search: (
    board: BoardState,
    color: "black" | "white",
    params: DifficultyParams,
  ) => FindBestMoveResult;
}

/**
 * EvaluationOptions → WASM用ビットマスク
 * Zig main.zig findBestMove のビットレイアウトと一致させる。
 *
 * ビットレイアウト（u32）:
 *   bits 0-8:   position_eval.EvalOptions（ムーブオーダリング用フラグ）
 *   bits 9-16:  葉評価 single_four_penalty_multiplier
 *               （0=未指定→100、255=センチネル→0、1-254=そのまま）
 *   bit 17:     enable_leaf_mise（現在は未使用）
 */
function encodeEvalOptionsForWasm(opts: {
  enableMise?: boolean;
  enableForbiddenTrap?: boolean;
  enableMultiThreat?: boolean;
  enableCounterFour?: boolean;
  enableNullMovePruning?: boolean;
  enableFutilityPruning?: boolean;
  enableMandatoryDefense?: boolean;
  enableSingleFourPenalty?: boolean;
  singleFourPenaltyMultiplier?: number;
  enableMiseThreat?: boolean;
  enableDoubleThreeThreat?: boolean;
  enableForbiddenVulnerability?: boolean;
}): number {
  const bits: boolean[] = [
    opts.enableMise ?? false,
    opts.enableForbiddenTrap ?? false,
    opts.enableMultiThreat ?? false,
    (opts.enableCounterFour ?? false) ||
      (opts.enableNullMovePruning ?? false) ||
      (opts.enableFutilityPruning ?? false),
    opts.enableMandatoryDefense ?? false,
    opts.enableSingleFourPenalty ?? false,
    opts.enableMiseThreat ?? false,
    opts.enableDoubleThreeThreat ?? false,
    opts.enableForbiddenVulnerability ?? false,
  ];
  let flags = bits.reduce((acc, bit, i) => acc + (bit ? 2 ** i : 0), 0);

  // bits 9-16: 葉評価 singleFourPenaltyMultiplier
  // センチネル規則（Zig main.zig findBestMove と対称）:
  //   enableSingleFourPenalty が false → 0（未指定 = デフォルト 100）
  //   multiplier === 0 → 255（センチネル: 完全ペナルティ）
  //   その他 → Math.round(m * 100)（1-254）
  if (opts.enableSingleFourPenalty) {
    const m = opts.singleFourPenaltyMultiplier ?? 1.0;
    const raw = m === 0 ? 255 : Math.round(m * 100);
    flags |= (raw & 0xff) << 9;
  }

  return flags;
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
      const evalFlags = params.evaluationOptions
        ? encodeEvalOptionsForWasm(params.evaluationOptions)
        : 0;
      wasm.findBestMove(
        color === "black" ? CELL_BLACK : CELL_WHITE,
        params.depth,
        params.timeLimit,
        params.maxNodes,
        0, // absoluteTimeLimitMs
        0, // aspirationMode
        evalFlags,
      );

      // 結果バッファから読み取り
      const ptr = wasm.getResultBuffer();
      const view = new DataView(wasm.memory.buffer);
      const row = view.getUint8(ptr);
      const col = view.getUint8(ptr + 1);
      const score = view.getInt32(ptr + 2, true);
      const completedDepth = view.getUint8(ptr + 6);

      // 統計バッファから読み取り（getStatsBuffer がないWASMとの互換性）
      let stats: WasmSearchStats | undefined = undefined;
      if (wasm.getStatsBuffer) {
        const statsPtr = wasm.getStatsBuffer();
        stats = {
          nodes: view.getUint32(statsPtr, true),
          ttHits: view.getUint32(statsPtr + 4, true),
          ttCutoffs: view.getUint32(statsPtr + 8, true),
          betaCutoffs: view.getUint32(statsPtr + 12, true),
          nullMoveTrials: view.getUint32(statsPtr + 16, true),
          nullMoveCutoffs: view.getUint32(statsPtr + 20, true),
          futilityPrunes: view.getUint32(statsPtr + 24, true),
          threatExtensions: view.getUint32(statsPtr + 28, true),
          lmrTrials: view.getUint32(statsPtr + 32, true),
          lmrResearches: view.getUint32(statsPtr + 36, true),
          qSearchNodes: view.getUint32(statsPtr + 40, true),
          threatProbeCutoffs: view.getUint32(statsPtr + 44, true),
        };
      }

      return {
        position: { row, col },
        score,
        completedDepth,
        interrupted: false,
        stats,
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

/**
 * eval 形系重みを wasm に注入する（純粋関数）。
 * setEvalParam export があれば resetEvalParams→各 setEvalParam を適用、無ければ
 * warn してスキップ（setEvalParam 非対応の古い commit を読む commit-bench と後方互換）。
 * baseline 側（weights 空）でも resetEvalParams を呼びクリーンな既定を保証する。
 */
function applyEvalWeights(
  wasm: WasmModuleExports,
  weights: Record<string, number> | undefined,
): void {
  if (
    typeof wasm.setEvalParam !== "function" ||
    typeof wasm.resetEvalParams !== "function"
  ) {
    if (weights && Object.keys(weights).length > 0) {
      console.warn(
        "[cpu-bridge-worker] この wasm は setEvalParam 非対応。evalWeights を無視します。",
      );
    }
    return;
  }
  wasm.resetEvalParams();
  for (const [name, value] of Object.entries(weights ?? {})) {
    const id = (EVAL_PARAM_IDS as Record<string, number>)[name];
    if (id === undefined) {
      console.warn(`[cpu-bridge-worker] 不明な eval 重みキー: ${name}（無視）`);
      continue;
    }
    wasm.setEvalParam(id, value);
  }
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
    // eval 形系重みを注入（baseline は weights 空＝reset のみでクリーン既定）
    applyEvalWeights(wasm, data.evalWeights);
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
        stats: result.stats,
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
