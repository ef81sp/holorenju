/**
 * gen-opening-suite.ts の評価 worker（node:worker_threads）。
 *
 * 1 worker が 1 つの WasmSearchEngine を持ち、親から受け取った候補（ブックの
 * entries キー）を bench-precision-2026-09-04.md §2.2 手順 4 の順で評価する:
 *   (i)   白番 root スコア（hard 実機 findBestMoveWithParams、depth 7 / 100k nodes）
 *         で |score| <= scoreAbsMax
 *   (ii)  白番に VCF/VCT が無い（forcedWinCheck.ts の予算）
 *   (iii) (i) の着手後に黒の VCF/VCT が無い（checkForcedWinAfterMove）
 */
import { parentPort, workerData } from "node:worker_threads";

import type { BoardState, Position } from "@/types/game";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import {
  encodeEvalOptions,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { formatMove } from "@/logic/gameRecordParser";
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
import { parseBoardKey, type SuiteRejectReason } from "./lib/openingSuite.ts";

export interface SuiteWorkerData {
  scoreAbsMax: number;
  depth: number;
  nodes: number;
  /** 安全弁（maxNodes が実質上限） */
  timeLimitMs: number;
}

export interface SuiteEvalRequest {
  index: number;
  key: string;
}

export interface SuiteEvalResponse {
  index: number;
  score: number;
  bestMove: string;
  reject: SuiteRejectReason | null;
  elapsedMs: number;
}

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
  const evalFlags = encodeEvalOptions(DIFFICULTY_PARAMS.hard.evaluationOptions);
  const result = engine.findBestMoveWithParams(
    board,
    "white",
    data.depth,
    data.timeLimitMs,
    data.nodes,
    evalFlags,
  );
  const bestMove: Position = result.position;
  const base = {
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

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error("worker として起動してください");
  }
  const port = parentPort;
  const data = workerData as SuiteWorkerData;
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const engine = new WasmSearchEngine(await loadWasmModule());

  port.on("message", (req: SuiteEvalRequest) => {
    port.postMessage(evaluateCandidate(engine, data, req));
  });
  port.postMessage({ ready: true });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
