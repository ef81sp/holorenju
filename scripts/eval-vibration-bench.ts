/**
 * 評価値振動分解スクリプト（Phase 0）
 *
 * 棋譜分析で観測した「評価値振動 627/手」が
 *   (a) 静的評価のノイズ
 *   (b) horizon effect / depth 不足
 * のどちらに由来するかを切り分ける。
 *
 * 既存棋譜の中盤局面を再構築し、各局面で:
 *   - 静的評価値（depth=0、evaluateBoard を直接呼ぶ）
 *   - 探索後評価値（depth=5/6/7 で findBestMove）
 * を取得し、同じプレイヤーの連続手の差分絶対値平均（mean abs diff）を比較する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/eval-vibration-bench.ts
 */

import * as fs from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position } from "@/types/game";

import { WasmBoardEvaluator } from "@/logic/cpu/wasm/bridge";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { createEmptyBoard } from "@/logic/renjuRules";

interface KifuMove {
  moveNumber: number;
  color: "black" | "white";
  position: Position;
  positionLabel: string;
  score: number;
  depth: number;
  timeMs: number;
}

interface KifuGame {
  gameIndex: number;
  jushuName: string;
  winner: "black" | "white" | "draw";
  moveCount: number;
  moves: KifuMove[];
}

interface KifuData {
  games: KifuGame[];
}

/** 棋譜から N 手目までの盤面を構築 */
function buildBoardAt(moves: KifuMove[], upToMoveNumber: number): BoardState {
  const board = createEmptyBoard();
  for (const m of moves) {
    if (m.moveNumber >= upToMoveNumber) {
      break;
    }
    board[m.position.row]![m.position.col] = m.color;
  }
  return board;
}

interface PositionEval {
  moveNumber: number;
  color: "black" | "white";
  staticScore: number;
  searchScores: { depth: number; score: number; timeMs: number }[];
}

const MATE_THRESHOLD = 50000; // mate score を除外する閾値

/** 同じプレイヤーの連続手の評価値の差分絶対値平均（mate score を除外） */
function meanAbsDiff(values: number[]): number {
  // mate score (|score| > 50000) を除外
  const filtered = values.filter((v) => Math.abs(v) < MATE_THRESHOLD);
  if (filtered.length < 2) {
    return 0;
  }
  let total = 0;
  for (let i = 1; i < filtered.length; i++) {
    total += Math.abs(filtered[i]! - filtered[i - 1]!);
  }
  return total / (filtered.length - 1);
}

function analyzeGame(
  game: KifuGame,
  evaluator: WasmBoardEvaluator,
  searchEngine: WasmSearchEngine,
  midRange: { from: number; to: number },
  searchDepths: number[],
): PositionEval[] {
  const results: PositionEval[] = [];

  for (let mn = midRange.from; mn <= midRange.to; mn++) {
    const move = game.moves.find((m) => m.moveNumber === mn);
    if (!move) {
      continue;
    }
    // mn 手目を打つ「直前」の盤面を構築
    const board = buildBoardAt(game.moves, mn);
    const {color} = move;

    // 静的評価
    const staticScore = evaluator.evaluateBoard(board, color);

    // 探索後評価（depth ごとに）
    const searchScores: { depth: number; score: number; timeMs: number }[] = [];
    for (const depth of searchDepths) {
      searchEngine.clearTT();
      const start = performance.now();
      // 時間制限を非常に大きくして depth で完走させる
      const result = searchEngine.findBestMoveWithParams(
        board,
        color,
        depth,
        600_000,
        0,
      );
      const elapsed = performance.now() - start;
      searchScores.push({ depth, score: result.score, timeMs: elapsed });
    }

    results.push({ moveNumber: mn, color, staticScore, searchScores });
  }

  return results;
}

function summarize(name: string, evals: PositionEval[]): void {
  console.log(`\n=== ${name} ===`);
  console.log(
    `move | color | static  | d=5     | d=6     | d=7     | s_time(ms)`,
  );

  // 同じプレイヤーの値を集める
  const blackStatic: number[] = [];
  const whiteStatic: number[] = [];
  const blackSearch: Record<number, number[]> = { 5: [], 6: [], 7: [] };
  const whiteSearch: Record<number, number[]> = { 5: [], 6: [], 7: [] };

  for (const e of evals) {
    const sCells = [5, 6, 7].map((d) => {
      const sc = e.searchScores.find((x) => x.depth === d);
      return sc ? sc.score : 0;
    });
    const sTime = e.searchScores.find((x) => x.depth === 7)?.timeMs ?? 0;
    console.log(
      `${e.moveNumber.toString().padStart(4)} | ${e.color.padEnd(5)} | ${e.staticScore
        .toString()
        .padStart(7)} | ${sCells[0]!.toString().padStart(7)} | ${sCells[1]!
        .toString()
        .padStart(
          7,
        )} | ${sCells[2]!.toString().padStart(7)} | ${sTime.toFixed(0)}`,
    );

    if (e.color === "black") {
      blackStatic.push(e.staticScore);
      for (const d of [5, 6, 7]) {
        const sc = e.searchScores.find((x) => x.depth === d);
        if (sc) {blackSearch[d]!.push(sc.score);}
      }
    } else {
      whiteStatic.push(e.staticScore);
      for (const d of [5, 6, 7]) {
        const sc = e.searchScores.find((x) => x.depth === d);
        if (sc) {whiteSearch[d]!.push(sc.score);}
      }
    }
  }

  // 振動 (mean abs diff) を計算
  const stBlack = meanAbsDiff(blackStatic);
  const stWhite = meanAbsDiff(whiteStatic);
  const stAvg = (stBlack + stWhite) / 2;

  console.log(
    `\n--- 振動 (mean abs diff between consecutive same-color moves) ---`,
  );
  console.log(
    `静的評価:     black=${stBlack.toFixed(0)}, white=${stWhite.toFixed(0)}, 平均=${stAvg.toFixed(0)}`,
  );
  for (const d of [5, 6, 7]) {
    const sb = meanAbsDiff(blackSearch[d]!);
    const sw = meanAbsDiff(whiteSearch[d]!);
    const avg = (sb + sw) / 2;
    const ratio = avg > 0 ? (stAvg / avg).toFixed(2) : "n/a";
    console.log(
      `探索 d=${d}:     black=${sb.toFixed(0)}, white=${sw.toFixed(0)}, 平均=${avg.toFixed(0)}, 静的/探索=${ratio}`,
    );
  }
}

async function main(): Promise<void> {
  const kifuPath =
    process.argv.find((a) => a.startsWith("--kifu="))?.slice(7) ??
    "bench-results/quick-kifu-2026-04-10T10-40-39-752Z.json";
  const data: KifuData = JSON.parse(fs.readFileSync(kifuPath, "utf8"));

  console.log(`=== 評価値振動分解 ===`);
  console.log(`棋譜: ${kifuPath}`);
  console.log(`対象: 中盤局面 (move 8〜18)\n`);

  const wasm: WasmModuleContext = await loadWasmModule();
  const evaluator = new WasmBoardEvaluator(wasm);
  const engine = new WasmSearchEngine(wasm);

  // 対照群: 不安定 / 最大揺れ / 安定
  const targets = [
    { name: "ゲーム4 (雲月, 不安定, 揺れ平均893)", index: 3 },
    { name: "ゲーム3 (恒星, 最大揺れ11530)", index: 2 },
    { name: "ゲーム11 (彗星, 安定, 揺れ平均139)", index: 10 },
  ];

  const allResults: { name: string; evals: PositionEval[] }[] = [];

  for (const t of targets) {
    const game = data.games[t.index];
    if (!game) {
      console.log(`Game ${t.index + 1} not found`);
      continue;
    }
    process.stdout.write(`分析中: ${t.name}...`);
    const evals = analyzeGame(
      game,
      evaluator,
      engine,
      { from: 8, to: 18 },
      [5, 6, 7],
    );
    process.stdout.write(` 完了\n`);
    allResults.push({ name: t.name, evals });
  }

  for (const r of allResults) {
    summarize(r.name, r.evals);
  }

  // 全体集計
  console.log(`\n\n=== 全体集計 ===`);
  let totalStaticDiff = 0;
  let totalStaticCount = 0;
  const totalSearchDiff: Record<number, number> = { 5: 0, 6: 0, 7: 0 };
  const totalSearchCount: Record<number, number> = { 5: 0, 6: 0, 7: 0 };

  for (const r of allResults) {
    const blackStatic: number[] = [];
    const whiteStatic: number[] = [];
    const blackSearch: Record<number, number[]> = { 5: [], 6: [], 7: [] };
    const whiteSearch: Record<number, number[]> = { 5: [], 6: [], 7: [] };

    for (const e of r.evals) {
      if (e.color === "black") {
        blackStatic.push(e.staticScore);
        for (const d of [5, 6, 7]) {
          const sc = e.searchScores.find((x) => x.depth === d);
          if (sc) {blackSearch[d]!.push(sc.score);}
        }
      } else {
        whiteStatic.push(e.staticScore);
        for (const d of [5, 6, 7]) {
          const sc = e.searchScores.find((x) => x.depth === d);
          if (sc) {whiteSearch[d]!.push(sc.score);}
        }
      }
    }

    if (blackStatic.length >= 2) {
      totalStaticDiff += meanAbsDiff(blackStatic) * (blackStatic.length - 1);
      totalStaticCount += blackStatic.length - 1;
    }
    if (whiteStatic.length >= 2) {
      totalStaticDiff += meanAbsDiff(whiteStatic) * (whiteStatic.length - 1);
      totalStaticCount += whiteStatic.length - 1;
    }
    for (const d of [5, 6, 7]) {
      if (blackSearch[d]!.length >= 2) {
        totalSearchDiff[d]! +=
          meanAbsDiff(blackSearch[d]!) * (blackSearch[d]!.length - 1);
        totalSearchCount[d]! += blackSearch[d]!.length - 1;
      }
      if (whiteSearch[d]!.length >= 2) {
        totalSearchDiff[d]! +=
          meanAbsDiff(whiteSearch[d]!) * (whiteSearch[d]!.length - 1);
        totalSearchCount[d]! += whiteSearch[d]!.length - 1;
      }
    }
  }

  const totalStaticAvg =
    totalStaticCount > 0 ? totalStaticDiff / totalStaticCount : 0;
  console.log(`静的評価 振動: ${totalStaticAvg.toFixed(0)} / 手`);
  for (const d of [5, 6, 7]) {
    const avg =
      totalSearchCount[d]! > 0 ? totalSearchDiff[d]! / totalSearchCount[d]! : 0;
    const ratio = avg > 0 ? (totalStaticAvg / avg).toFixed(2) : "n/a";
    console.log(`探索 d=${d} 振動: ${avg.toFixed(0)} / 手, 静的/探索=${ratio}`);
  }

  console.log(`\n--- 判定 ---`);
  const d7 =
    totalSearchCount[7]! > 0 ? totalSearchDiff[7]! / totalSearchCount[7]! : 0;
  if (d7 === 0) {
    console.log("d=7 のサンプルが不足");
  } else {
    const ratio = totalStaticAvg / d7;
    if (ratio > 0.7) {
      console.log(`静的振動が支配的 (ratio=${ratio.toFixed(2)} > 0.7)`);
      console.log("→ Phase B/D で静的評価を改善する価値あり");
    } else if (ratio > 0.3) {
      console.log(
        `静的・探索の両方が寄与 (0.3 < ratio=${ratio.toFixed(2)} <= 0.7)`,
      );
      console.log("→ Phase B/D でも一定の効果は期待できる");
    } else {
      console.log(
        `探索（horizon effect）が支配的 (ratio=${ratio.toFixed(2)} <= 0.3)`,
      );
      console.log("→ Phase B/D の効果は限定的。探索改善の方が重要");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
