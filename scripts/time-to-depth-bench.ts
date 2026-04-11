/**
 * 時間制限を無効化して、固定深度に到達する時間を計測するベンチ。
 *
 * 目的: NPS 改善が depth 到達速度にどう反映されるかを直接観測する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/time-to-depth-bench.ts --games=4 --depth=5
 */

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { getAllJushuNames, getJushuPositions } from "@/logic/cpu/opening";
import { boardStateToWasm, colorToWasm } from "@/logic/cpu/wasm/boardAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import {
  WasmSearchEngine,
  type WasmSearchResult,
} from "@/logic/cpu/wasm/searchEngine";
import {
  checkForbiddenMove,
  checkWin,
  createEmptyBoard,
} from "@/logic/renjuRules";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

const DRAW_MOVE_LIMIT = 70;

interface MoveStat {
  timeMs: number;
  depth: number;
}

interface GameResult {
  winner: "black" | "white" | "draw";
  moveCount: number;
  moves: MoveStat[];
}

function encodeHardEvalOptions(): number {
  // hard 設定相当のフラグをエンコード（searchEngine.ts と同じ順序）
  const opts = DIFFICULTY_PARAMS.hard.evaluationOptions;
  const bits: boolean[] = [
    opts.enableMise,
    opts.enableForbiddenTrap,
    opts.enableMultiThreat,
    opts.enableCounterFour ||
      opts.enableNullMovePruning ||
      opts.enableFutilityPruning,
    opts.enableMandatoryDefense,
    opts.enableSingleFourPenalty,
    opts.enableMiseThreat,
    opts.enableDoubleThreeThreat,
    opts.enableForbiddenVulnerability,
  ];
  return bits.reduce((flags, bit, i) => flags + (bit ? 2 ** i : 0), 0);
}

function callWasm(
  wasm: ReturnType<typeof loadWasmModule> extends Promise<infer T> ? T : never,
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  maxNodes: number,
  absoluteTimeLimit: number,
  evalFlags: number,
): WasmSearchResult {
  boardStateToWasm(wasm, board);
  wasm.ttClear();
  wasm.findBestMove(
    colorToWasm(color),
    maxDepth,
    timeLimit,
    maxNodes,
    absoluteTimeLimit,
    0,
    evalFlags,
  );
  // readResult は private なので簡易的に再構築
  const buf = wasm.getResultBuffer();
  const view = new DataView(wasm.memory.buffer, buf, 8);
  return {
    position: { row: view.getUint8(0), col: view.getUint8(1) },
    score: view.getInt32(2, true),
    completedDepth: view.getUint8(6),
  };
}

function playGame(
  wasm: ReturnType<typeof loadWasmModule> extends Promise<infer T> ? T : never,
  engine: WasmSearchEngine,
  openingMoves: [Position, Position, Position],
  maxDepth: number,
  timeLimit: number,
  maxNodes: number,
  absoluteTimeLimit: number,
  evalFlags: number,
): GameResult {
  const board: BoardState = createEmptyBoard();
  const colors: StoneColor[] = ["black", "white"];
  let moveCount = 0;
  const moves: MoveStat[] = [];

  for (const pos of openingMoves) {
    const color = colors[moveCount % 2];
    board[pos.row]![pos.col] = color;
    moveCount++;
  }

  while (moveCount < DRAW_MOVE_LIMIT) {
    const color = colors[moveCount % 2] as "black" | "white";
    const start = performance.now();
    const result = callWasm(
      wasm,
      engine,
      board,
      color,
      maxDepth,
      timeLimit,
      maxNodes,
      absoluteTimeLimit,
      evalFlags,
    );
    const elapsed = performance.now() - start;
    moves.push({ timeMs: elapsed, depth: result.completedDepth });

    const pos = result.position;

    if (color === "black") {
      const forbidden = checkForbiddenMove(board, pos.row, pos.col);
      if (forbidden.isForbidden) {
        return { winner: "white", moveCount, moves };
      }
    }

    board[pos.row]![pos.col] = color;
    moveCount++;

    if (checkWin(board, pos, color)) {
      return { winner: color, moveCount, moves };
    }
  }

  return { winner: "draw", moveCount: DRAW_MOVE_LIMIT, moves };
}

async function main(): Promise<void> {
  const maxGames = parseInt(
    process.argv.find((a) => a.startsWith("--games="))?.slice(8) ?? "4",
    10,
  );
  const depth = parseInt(
    process.argv.find((a) => a.startsWith("--depth="))?.slice(8) ?? "7",
    10,
  );
  const timeLimit = parseInt(
    process.argv.find((a) => a.startsWith("--time="))?.slice(7) ?? "10000",
    10,
  );
  const absoluteTimeLimit = timeLimit; // time と同じ
  const maxNodes = 0; // 0 = 無制限

  const evalFlags = encodeHardEvalOptions();

  console.log("=== 時間-到達深度ベンチ ===");
  console.log(
    `条件: depth=${depth}, timeLimit=${timeLimit}ms, maxNodes=無制限`,
  );
  console.log(`対局数: ${maxGames}\n`);

  const wasm: WasmModuleContext = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  const startTime = performance.now();
  const names = getAllJushuNames();

  let gameCount = 0;
  let totalMoves = 0;
  const allMoveTimes: number[] = [];
  const allMoveDepths: number[] = [];

  for (const name of names) {
    if (gameCount >= maxGames) {
      break;
    }
    const positions = getJushuPositions(name, true);
    if (!positions) {
      continue;
    }

    engine.clearTT();
    const result = playGame(
      wasm,
      engine,
      positions,
      depth,
      timeLimit,
      maxNodes,
      absoluteTimeLimit,
      evalFlags,
    );
    totalMoves += result.moveCount;
    for (const m of result.moves) {
      allMoveTimes.push(m.timeMs);
      allMoveDepths.push(m.depth);
    }

    gameCount++;
    process.stdout.write(`\r  ${gameCount}/${maxGames} games completed`);
  }

  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`\n\n=== 結果 ===`);
  console.log(`実行時間: ${elapsed.toFixed(1)}秒`);
  console.log(`対局数: ${gameCount}`);
  console.log(`総手数: ${totalMoves}`);

  // 着手時間統計
  allMoveTimes.sort((a, b) => a - b);
  const sum = allMoveTimes.reduce((s, t) => s + t, 0);
  const avg = sum / allMoveTimes.length;
  const median = allMoveTimes[Math.floor(allMoveTimes.length / 2)] ?? 0;
  const p90 = allMoveTimes[Math.floor(allMoveTimes.length * 0.9)] ?? 0;
  const max = allMoveTimes[allMoveTimes.length - 1] ?? 0;

  console.log(`\n--- 着手時間統計 ---`);
  console.log(`平均: ${avg.toFixed(0)}ms`);
  console.log(`中央値: ${median.toFixed(0)}ms`);
  console.log(`p90: ${p90.toFixed(0)}ms`);
  console.log(`最大: ${max.toFixed(0)}ms`);
  console.log(`合計: ${sum.toFixed(0)}ms`);

  // 深度統計
  const sumDepth = allMoveDepths.reduce((s, d) => s + d, 0);
  const avgDepth = sumDepth / allMoveDepths.length;
  const depthCounts = new Map<number, number>();
  for (const d of allMoveDepths) {
    depthCounts.set(d, (depthCounts.get(d) ?? 0) + 1);
  }
  const sortedDepths = [...depthCounts.entries()].sort((a, b) => a[0] - b[0]);

  console.log(`\n--- 深度統計 ---`);
  console.log(`平均深度: ${avgDepth.toFixed(2)}`);
  console.log(`深度分布:`);
  for (const [d, c] of sortedDepths) {
    const pct = ((c / allMoveDepths.length) * 100).toFixed(1);
    console.log(`  depth=${d}: ${c}手 (${pct}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
