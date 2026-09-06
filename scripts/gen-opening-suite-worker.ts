/**
 * gen-opening-suite.ts の評価 worker（node:worker_threads）。
 *
 * 1 worker が 1 つの WasmSearchEngine を持ち、親から受け取ったリクエストを処理する。
 *
 * - kind "eval"（v1、bench-precision-2026-09-04.md §2.2 手順 4）:
 *   (i)   白番 root スコア（hard 実機 findBestMoveWithParams、depth 7 / 100k nodes）
 *         で |score| <= scoreAbsMax
 *   (ii)  白番に VCF/VCT が無い（forcedWinCheck.ts の予算）
 *   (iii) (i) の着手後に黒の VCF/VCT が無い（checkForcedWinAfterMove）
 * - kind "ply"（v2、§5.2 の 4 手整合フィルタ）:
 *   hard 実機で白から交互に N 手進め、各手の着手・score・completedDepth と
 *   途中終局（五連 / 黒の禁手着手 / 着手なし）を記録する。採否判定は親側
 *   （lib/openingSuite.ts の classifyPlyCheck）。
 */
import { parentPort, workerData } from "node:worker_threads";

import type { BoardState, Position } from "@/types/game";

import { applyMove, getOppositeColor } from "@/logic/cpu/core/boardUtils";
import {
  getForbiddenType,
  preloadForbiddenWasm,
} from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import {
  encodeEvalOptions,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { formatMove } from "@/logic/gameRecordParser";
import { checkWin } from "@/logic/renjuRules";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

import {
  checkForcedWinAfterMove,
  VCF_MAX_DEPTH,
  VCF_MAX_NODES,
  VCF_TIME_LIMIT_MS,
  VCT_MAX_DEPTH,
  VCT_MAX_NODES,
  VCT_TIME_LIMIT_MS,
} from "./lib/forcedWinCheck.ts";
import {
  parseBoardKey,
  type PlyCheckResult,
  type PlyRecord,
  type SuiteRejectReason,
} from "./lib/openingSuite.ts";

export interface PlyCheckWorkerConfig {
  plies: number;
  nodes: number;
  depth: number;
  timeLimitMs: number;
}

export interface SuiteWorkerData {
  scoreAbsMax: number;
  depth: number;
  nodes: number;
  /** 安全弁（実態は Zig の絶対上限 10 s が先に効く） */
  timeLimitMs: number;
  /** kind "ply" の設定。使わなければ null */
  plyCheck: PlyCheckWorkerConfig | null;
}

export interface SuiteEvalRequest {
  kind: "eval";
  index: number;
  key: string;
}

export interface SuitePlyRequest {
  kind: "ply";
  index: number;
  key: string;
}

export type SuiteRequest = SuiteEvalRequest | SuitePlyRequest;

export interface SuiteEvalResponse {
  kind: "eval";
  index: number;
  score: number;
  bestMove: string;
  reject: SuiteRejectReason | null;
  elapsedMs: number;
}

export interface SuitePlyResponse {
  kind: "ply";
  index: number;
  result: PlyCheckResult;
}

export type SuiteResponse = SuiteEvalResponse | SuitePlyResponse;

const HARD_EVAL_FLAGS = encodeEvalOptions(
  DIFFICULTY_PARAMS.hard.evaluationOptions,
);

function hasForcedWin(
  engine: WasmSearchEngine,
  board: BoardState,
  side: "black" | "white",
): boolean {
  const vcf = engine.findVCFSequence(
    board,
    side,
    VCF_MAX_DEPTH,
    VCF_TIME_LIMIT_MS,
    VCF_MAX_NODES,
  );
  if (vcf) {
    return true;
  }
  const vct = engine.findVCTSequence(
    board,
    side,
    VCT_MAX_DEPTH,
    VCT_TIME_LIMIT_MS,
    VCT_MAX_NODES,
    false,
  );
  return vct !== null;
}

function evaluateCandidate(
  engine: WasmSearchEngine,
  data: SuiteWorkerData,
  req: SuiteEvalRequest,
): SuiteEvalResponse {
  const start = Date.now();
  const { board, sideToMove } = parseBoardKey(req.key);
  if (sideToMove !== "white") {
    throw new Error(`白番でない候補: ${req.key}`);
  }
  const result = engine.findBestMoveWithParams(
    board,
    "white",
    data.depth,
    data.timeLimitMs,
    data.nodes,
    HARD_EVAL_FLAGS,
  );
  const bestMove: Position = result.position;
  const base = {
    kind: "eval" as const,
    index: req.index,
    score: result.score,
    bestMove: formatMove(bestMove),
  };
  const done = (reject: SuiteRejectReason | null): SuiteEvalResponse => ({
    ...base,
    reject,
    elapsedMs: Date.now() - start,
  });

  if (Math.abs(result.score) > data.scoreAbsMax) {
    return done("score");
  }
  if (hasForcedWin(engine, board, "white")) {
    return done("whiteWin");
  }
  const after = checkForcedWinAfterMove(engine, board, "white", bestMove);
  if (after.forcedWinKind !== null) {
    return done("blackWin");
  }
  return done(null);
}

function isOnBoard(board: BoardState, pos: Position): boolean {
  return board[pos.row]?.[pos.col] === null;
}

/** hard 実機で白から交互に N 手進める。終局したらそこで止める。 */
function plyCheck(
  engine: WasmSearchEngine,
  cfg: PlyCheckWorkerConfig,
  req: SuitePlyRequest,
): SuitePlyResponse {
  const start = Date.now();
  const parsed = parseBoardKey(req.key);
  if (parsed.sideToMove !== "white") {
    throw new Error(`白番でない候補: ${req.key}`);
  }
  let { board } = parsed;
  let side: "black" | "white" = "white";
  const plies: PlyRecord[] = [];
  let terminal: PlyCheckResult["terminal"] = null;
  for (let i = 0; i < cfg.plies; i++) {
    const r = engine.findBestMoveWithParams(
      board,
      side,
      cfg.depth,
      cfg.timeLimitMs,
      cfg.nodes,
      HARD_EVAL_FLAGS,
    );
    if (!isOnBoard(board, r.position)) {
      terminal = "noMove";
      break;
    }
    plies.push({
      move: formatMove(r.position),
      score: r.score,
      completedDepth: r.completedDepth,
    });
    if (
      side === "black" &&
      getForbiddenType(board, r.position.row, r.position.col) !== null
    ) {
      terminal = "forbidden";
      break;
    }
    board = applyMove(board, r.position, side);
    if (checkWin(board, r.position, side)) {
      terminal = "five";
      break;
    }
    side = getOppositeColor(side);
  }
  return {
    kind: "ply",
    index: req.index,
    result: { plies, terminal, elapsedMs: Date.now() - start },
  };
}

function handle(
  engine: WasmSearchEngine,
  data: SuiteWorkerData,
  req: SuiteRequest,
): SuiteResponse {
  switch (req.kind) {
    case "eval":
      return evaluateCandidate(engine, data, req);
    case "ply": {
      if (!data.plyCheck) {
        throw new Error("plyCheck 設定なしで kind=ply を受信");
      }
      return plyCheck(engine, data.plyCheck, req);
    }
    default: {
      const never: never = req;
      throw new Error(`未知のリクエスト: ${JSON.stringify(never)}`);
    }
  }
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error("worker として起動してください");
  }
  const port = parentPort;
  const data = workerData as SuiteWorkerData;
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const engine = new WasmSearchEngine(await loadWasmModule());

  port.on("message", (req: SuiteRequest) => {
    port.postMessage(handle(engine, data, req));
  });
  port.postMessage({ ready: true });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
