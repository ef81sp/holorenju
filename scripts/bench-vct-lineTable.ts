/**
 * VCT lineTable 高速化の効果測定
 *
 * node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/bench-vct-lineTable.ts
 */
import { buildLineTable } from "@/logic/cpu/lineTable/lineTable.ts";
import { findVCTMove, hasVCT } from "@/logic/cpu/search/vct.ts";
import { findThreatMoves } from "@/logic/cpu/search/vctHelpers.ts";
import { createBoardFromRecord } from "@/logic/gameRecordParser.ts";

function loadBoard(record: string): ReturnType<typeof createBoardFromRecord> {
  return createBoardFromRecord(record);
}

function bench(label: string, fn: () => void, runs = 20): number {
  // warmup
  for (let i = 0; i < 3; i++) {
    fn();
  }
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)]!;
  console.log(
    `  ${label}: median=${median.toFixed(3)}ms (min=${times[0]!.toFixed(3)}, max=${times[times.length - 1]!.toFixed(3)})`,
  );
  return median;
}

const records = [
  {
    label: "ct=three局面(20手)",
    record: "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11 G10 H7 F10 E10 H6 I5 G6 F5",
  },
  {
    label: "中盤局面(12手)",
    record: "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11",
  },
];

for (const { label, record } of records) {
  const board = loadBoard(record);
  const lt = buildLineTable(board);
  const color =
    record.split(" ").length % 2 === 0
      ? ("black" as const)
      : ("white" as const);

  console.log(`\n=== ${label} (${color}番, ${record.split(" ").length}手) ===`);

  // findThreatMoves 比較
  console.log("findThreatMoves:");
  const slowTime = bench("slow (no lineTable)", () => {
    findThreatMoves(board, color);
  }, 100);
  const fastTime = bench("fast (lineTable)   ", () => {
    findThreatMoves(board, color, lt);
  }, 100);
  console.log(`  → speedup: ${(slowTime / fastTime).toFixed(1)}x`);

  // hasVCT 比較
  const vctOpts = { maxDepth: 4, maxNodes: 400, timeLimit: 500 };
  console.log("hasVCT:");
  bench("no lineTable  ", () => {
    hasVCT(board, color, 0, undefined, vctOpts);
  });
  bench("with lineTable", () => {
    hasVCT(board, color, 0, undefined, vctOpts, undefined, lt);
  });

  // findVCTMove 比較
  const fvOpts = { maxDepth: 5, maxNodes: 800, timeLimit: 500 };
  console.log("findVCTMove:");
  bench("no lineTable  ", () => {
    findVCTMove(board, color, fvOpts);
  });
  bench("with lineTable", () => {
    findVCTMove(board, color, fvOpts, lt);
  });
}
