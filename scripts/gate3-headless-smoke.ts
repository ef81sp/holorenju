#!/usr/bin/env node
/**
 * Gate 3（実用チェック）: hard 難易度（evalBasis=prospect）でのヘッドレス自己対局スモーク
 *
 * cpu.worker.ts が実対局で使うのと同じ経路（WasmSearchEngine.findBestMove(board, color, "hard")）
 * を直接叩き、クラッシュ・盤外/占有マスへの着手がないことを確認する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/gate3-headless-smoke.ts --moves=30
 */

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import {
  type WasmSearchResult,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { formatMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

function parseArgs(): { moveCount: number } {
  const args = process.argv.slice(2);
  let moveCount = 30;
  for (const arg of args) {
    if (arg.startsWith("--moves=")) {
      moveCount = parseInt(arg.slice("--moves=".length), 10);
    }
  }
  return { moveCount };
}

const { moveCount } = parseArgs();

function safeFindBestMove(
  engine: WasmSearchEngine,
  board: ReturnType<typeof createEmptyBoard>,
  color: "black" | "white",
): WasmSearchResult | undefined {
  try {
    return engine.findBestMove(board, color, "hard");
  } catch (err) {
    console.error(`findBestMove 例外 (${color})`, err);
    return undefined;
  }
}

async function main(): Promise<void> {
  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  const board = createEmptyBoard();
  const record: string[] = [];
  let color: "black" | "white" = "black";
  let errors = 0;

  console.log(
    `=== Gate 3: ヘッドレス自己対局スモーク（hard, ${moveCount}手） ===`,
  );

  for (let i = 0; i < moveCount; i++) {
    const t0 = performance.now();
    const result = safeFindBestMove(engine, board, color);
    if (!result) {
      errors++;
      break;
    }
    const elapsed = performance.now() - t0;

    const { row, col } = result.position;
    if (row < 0 || row > 14 || col < 0 || col > 14) {
      console.error(`手${i + 1} (${color}): 盤外着手 row=${row} col=${col}`);
      errors++;
      break;
    }
    const cell = board[row]?.[col];
    if (cell !== null && cell !== undefined) {
      console.error(
        `手${i + 1} (${color}): 占有マスへの着手 row=${row} col=${col} (既存石=${cell})`,
      );
      errors++;
      break;
    }

    board[row]![col] = color;
    const moveStr = formatMove({ row, col });
    record.push(moveStr);
    console.log(
      `  手${i + 1} (${color}): ${moveStr} score=${result.score} depth=${result.completedDepth} ${Math.round(elapsed)}ms`,
    );

    if (result.score >= 100000 - 1) {
      console.log(`  → 勝ち確定スコア検出、対局終了`);
      break;
    }

    color = color === "black" ? "white" : "black";
  }

  console.log("");
  console.log(`=== 結果 ===`);
  console.log(`着手数: ${record.length}, エラー: ${errors}`);
  console.log(`棋譜: ${record.join(" ")}`);
  if (errors > 0) {
    console.error("スモークテスト失敗");
    process.exit(1);
  }
  console.log("スモークテスト成功（クラッシュ・不正着手なし）");
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
