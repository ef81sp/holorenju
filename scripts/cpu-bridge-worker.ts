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

import { mergeDifficultyParams } from "./lib/difficultyParamsMerge.ts";
import { EVAL_PARAM_IDS } from "./lib/evalParams.ts";
import { mulberry32 } from "./lib/mulberry32.ts";
import {
  countStones,
  loadOpeningBookFromWorktree,
} from "./lib/openingBookBridge.ts";
import { encodeEvalOptionsForWasm } from "./lib/wasmEvalOptionsEncoder.ts";

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
  /**
   * オープニングブック（opening-book-2026-07-16.md ★v2プラン B3）を有効化するか。
   * 既定 OFF（未指定時は従来どおり探索のみ）。ON でもモジュール/資産が
   * worktree に存在しなければ自動的に book-OFF として続行する（クラッシュしない）。
   */
  bookEnabled?: boolean;
  /**
   * 脅威プローブ（threat_probe_enabled）を無効化して探索させる。
   * 既定 true=従来挙動。false の時は WASM ロード後に `setThreatProbeEnabled(0)` を
   * 呼び、プローブ抜きの深度を計測する。export が無い古い wasm では warn してスキップ。
   *
   * prospect 基底下で probe OFF（NPS×17・深度5→12 が既測）が Elo に転換するかを
   * commit-bench で再検証するための実行時レバー。
   */
  threatProbeEnabled?: boolean;
}

interface MoveRequest {
  requestId: number;
  board: BoardState;
  color: "black" | "white";
  /**
   * テスト用: true の場合、応答を返さず沈黙する（bench の timeout→dump→respawn
   * 回復パスを実際に発火させる）。本番パスに影響しない差し込み口で、
   * runCommitGame の HangInjectSpec から立てられる。
   */
  hangInject?: boolean;
  /**
   * この1手用の PRNG seed。指定時、randomFactor 適用の近傍ランダム選択に
   * `mulberry32(moveSeed)` を使い、同一シード同一棋譜を保証する。
   * 未指定なら Math.random にフォールバック（従来挙動）。
   */
  moveSeed?: number;
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
  /**
   * 脅威プローブの有効/無効を切り替える（Gate 0 計測用、zig/src/main.zig）。
   * 1=有効（既定）、0=無効。無効化した wasm では NPS×17・深度が上がる傾向がある
   * が Elo に転換するかは要検証。古い wasm には無い＝optional。
   */
  setThreatProbeEnabled?: (enabled: number) => void;
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

  return mergeDifficultyParams(baseParams, data.customParams);
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

// ============================================================================
// randomFactor 適用（cpu.worker.ts のブラウザ側実装を鏡写しに再現）
// ============================================================================

interface RandomizationModule {
  selectMoveWithRandomization: (opts: {
    bestMove: Position;
    bestMoveScore?: number;
    criticalScoreThreshold?: number;
    randomFactor: number;
    pickRandomMove: () => Position | null;
    random?: () => number;
  }) => Position;
  listChebyshevNeighbors: (
    center: Position,
    radius: number,
    boardSize?: number,
  ) => Position[];
}

interface ForbiddenAdapterModule {
  isForbiddenForBlack: (board: BoardState, row: number, col: number) => boolean;
  /** 禁手判定 wasm を事前ロード。未ロードで isForbiddenForBlack を呼ぶと throw する。 */
  preloadForbiddenWasm: () => Promise<void>;
}

interface RandomizationBundle {
  randomization: RandomizationModule;
  forbidden: ForbiddenAdapterModule;
}

const RANDOM_NEIGHBOR_RADIUS = 3;

/**
 * worktree から randomization.ts と forbiddenAdapter.ts を動的 import する。
 * 古い commit（randomization.ts が無い）では null を返し、randomFactor は
 * 無視される（既存挙動と同等）。
 */
async function loadRandomizationFromWorktree(
  worktreePath: string,
): Promise<RandomizationBundle | null> {
  const randomizationPath = path.join(
    worktreePath,
    "src",
    "logic",
    "cpu",
    "randomization.ts",
  );
  const forbiddenPath = path.join(
    worktreePath,
    "src",
    "logic",
    "cpu",
    "wasm",
    "forbiddenAdapter.ts",
  );
  if (!fs.existsSync(randomizationPath) || !fs.existsSync(forbiddenPath)) {
    return null;
  }
  try {
    const [randomizationMod, forbiddenMod] = await Promise.all([
      import(pathToFileURL(randomizationPath).href) as Promise<
        Partial<RandomizationModule>
      >,
      import(pathToFileURL(forbiddenPath).href) as Promise<
        Partial<ForbiddenAdapterModule>
      >,
    ]);
    if (
      typeof randomizationMod.selectMoveWithRandomization !== "function" ||
      typeof randomizationMod.listChebyshevNeighbors !== "function" ||
      typeof forbiddenMod.isForbiddenForBlack !== "function" ||
      typeof forbiddenMod.preloadForbiddenWasm !== "function"
    ) {
      console.warn(
        "[cpu-bridge-worker] randomization/forbidden の期待 export がありません。randomFactor を無視します。",
      );
      return null;
    }
    // 禁手判定 wasm を事前ロード（isForbiddenForBlack は未ロードで throw する）。
    // 動的 import した forbiddenAdapter は独立モジュールインスタンスなので、
    // 上位（commit-game-runner）の preloadForbiddenWasm() では初期化されない。
    await forbiddenMod.preloadForbiddenWasm();
    return {
      randomization: randomizationMod as RandomizationModule,
      forbidden: forbiddenMod as ForbiddenAdapterModule,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[cpu-bridge-worker] randomization ロード失敗（randomFactor 無視）: ${msg}`,
    );
    return null;
  }
}

/**
 * bestMove とスコアから、cpu.worker.ts と同じ手順で近傍 Chebyshev≤3 の
 * 合法空き点からランダム選択を掛ける。黒手番は禁手を除外。moveSeed が
 * あれば `mulberry32(moveSeed)` で決定的にする。
 */
function applyRandomization(
  bundle: RandomizationBundle | null,
  bestMove: Position,
  bestMoveScore: number,
  board: BoardState,
  color: "black" | "white",
  randomFactor: number,
  criticalScoreThreshold: number | undefined,
  moveSeed: number | undefined,
): Position {
  if (!bundle || randomFactor <= 0) {
    return bestMove;
  }
  const random = moveSeed === undefined ? undefined : mulberry32(moveSeed);
  const neighbors = bundle.randomization.listChebyshevNeighbors(
    bestMove,
    RANDOM_NEIGHBOR_RADIUS,
  );
  const candidates = neighbors.filter((p) => {
    if (board[p.row]?.[p.col] !== null) {
      return false;
    }
    if (
      color === "black" &&
      bundle.forbidden.isForbiddenForBlack(board, p.row, p.col)
    ) {
      return false;
    }
    return true;
  });
  return bundle.randomization.selectMoveWithRandomization({
    bestMove,
    bestMoveScore,
    criticalScoreThreshold,
    randomFactor,
    random,
    pickRandomMove: () => {
      if (candidates.length === 0) {
        return null;
      }
      const draw = random ? random() : Math.random();
      const idx = Math.floor(draw * candidates.length);
      return candidates[idx] ?? null;
    },
  });
}

async function main(): Promise<void> {
  const { worktreePath } = data;

  // 難易度パラメータを読み込み
  const params = await loadDifficultyParams(worktreePath);

  // オープニングブック（B3仕様③: 同一バイナリでbook-ON/OFFをフラグ切替できるよう、
  // コミット差ではなく workerData.bookEnabled で分岐する）
  const bookBridge = data.bookEnabled
    ? await loadOpeningBookFromWorktree(worktreePath)
    : null;
  if (data.bookEnabled) {
    console.log(
      `[cpu-bridge-worker] book=${bookBridge ? "ON" : "OFF(unavailable)"} for ${worktreePath}`,
    );
  }

  // randomFactor 用の worktree モジュール（無ければ null＝randomFactor 無視）。
  // 既存の commit-bench では params.randomFactor は WASM パスで完全に無視されていた
  // ため、この配線が「WASM 対局に randomFactor が効くようにする」修正の本体。
  const randomizationBundle = await loadRandomizationFromWorktree(worktreePath);
  if (params.randomFactor > 0) {
    console.log(
      `[cpu-bridge-worker] randomFactor=${params.randomFactor} randomization=${randomizationBundle ? "ON" : "OFF(unavailable)"} criticalScoreThreshold=${params.randomCriticalScoreThreshold ?? "unset"} for ${worktreePath}`,
    );
  }

  // WASM版を試行、失敗時はTS版にフォールバック
  const wasm = await loadWasmFromWorktree(worktreePath);
  let wasmHandler: WasmSearchHandler | null = null;
  let tsFindBestMove: FindBestMoveFn | null = null;

  if (wasm) {
    wasmHandler = createWasmSearchHandler(wasm);
    // eval 形系重みを注入（baseline は weights 空＝reset のみでクリーン既定）
    applyEvalWeights(wasm, data.evalWeights);
    // 脅威プローブトグル（Gate 0 計測用）。既定 true=従来挙動、false のときのみ
    // 明示 off。setThreatProbeEnabled が無い古い wasm は warn してスキップ。
    let threatProbeState = "ON(default)";
    if (data.threatProbeEnabled === false) {
      if (typeof wasm.setThreatProbeEnabled === "function") {
        wasm.setThreatProbeEnabled(0);
        threatProbeState = "OFF(runtime)";
      } else {
        console.warn(
          "[cpu-bridge-worker] この wasm は setThreatProbeEnabled 非対応。--probe-off を無視して既定 ON で走ります。",
        );
        threatProbeState = "ON(fallback, no-export)";
      }
    }
    // evalBasis 配線の silent 事故防止: 実際に search に渡る evaluationOptions を
    // エンコードした flags と bit18 (eval_basis) の状態を必ず1行ログに出す。
    // worktreePath のディレクトリ名（A-<sha>/B-<sha>）で A/B 側を判別できる。
    // search 経路（createWasmSearchHandler）と同じく evaluationOptions 未定義を許容する
    const evalFlags = params.evaluationOptions
      ? encodeEvalOptionsForWasm(params.evaluationOptions)
      : 0;
    const basis = params.evaluationOptions?.evalBasis ?? "legacy";
    const bit18 = (evalFlags & (1 << 18)) === 0 ? "legacy" : "prospect";
    console.log(
      `[cpu-bridge-worker] WASM engine loaded for ${worktreePath} | evalBasis=${basis} evalFlags=${evalFlags} bit18=${bit18} threatProbe=${threatProbeState}`,
    );
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
    const { requestId, board, color, hangInject, moveSeed } = msg;
    // テスト用: hangInject が立っていれば応答せず沈黙 → 呼び出し側が timeout する
    if (hangInject) {
      console.warn(
        `[cpu-bridge-worker] HANG_INJECT active (requestId=${requestId}) — 応答を返しません`,
      );
      return;
    }
    const startTime = performance.now();

    try {
      if (bookBridge) {
        const moveCount = countStones(board);
        if (bookBridge.isBookEligible(data.difficulty, color, moveCount)) {
          const bookMove = bookBridge.getBookMove(board, color);
          if (bookMove) {
            const response: MoveResponse = {
              requestId,
              position: bookMove,
              score: 0, // ブックの手は評価スコアなし（cpu.worker.ts と同じ扱い）
              depth: 0, // 探索なし
              thinkingTimeMs: performance.now() - startTime,
              interrupted: false,
            };
            parentPort?.postMessage(response);
            return;
          }
        }
      }

      const result: FindBestMoveResult = wasmHandler
        ? wasmHandler.search(board, color, params)
        : callTsFindBestMove(tsFindBestMove!, board, color, params);

      // randomFactor 適用（WASM/TS どちらの探索結果にも掛かる）。
      // cpu.worker.ts と同じ手順で近傍ランダム化 + 黒番の禁手除外。
      const finalPosition = applyRandomization(
        randomizationBundle,
        result.position,
        result.score,
        board,
        color,
        params.randomFactor,
        params.randomCriticalScoreThreshold,
        moveSeed,
      );

      const thinkingTimeMs = performance.now() - startTime;

      const response: MoveResponse = {
        requestId,
        position: finalPosition,
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
