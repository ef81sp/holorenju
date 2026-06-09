/**
 * 簡易ベンチマーク（hard vs hard）
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/profile-bench.ts
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/profile-bench.ts --games=10
 */

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { getAllJushuNames, getJushuPositions } from "@/logic/cpu/opening";
import {
  isForbiddenForBlack,
  preloadForbiddenWasm,
} from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { checkWin, createEmptyBoard } from "@/logic/renjuRules";

const DRAW_MOVE_LIMIT = 70;

interface SimpleGameResult {
  winner: "black" | "white" | "draw";
  moveCount: number;
}

function playGame(
  engine: WasmSearchEngine,
  openingMoves: [Position, Position, Position],
): SimpleGameResult {
  const board: BoardState = createEmptyBoard();
  const colors: StoneColor[] = ["black", "white"];
  let moveCount = 0;

  for (const pos of openingMoves) {
    const color = colors[moveCount % 2];
    board[pos.row]![pos.col] = color;
    moveCount++;
  }

  while (moveCount < DRAW_MOVE_LIMIT) {
    const color = colors[moveCount % 2] as "black" | "white";
    const result = engine.findBestMove(board, color, "hard");
    const pos = result.position;

    if (color === "black" && isForbiddenForBlack(board, pos.row, pos.col)) {
      return { winner: "white", moveCount };
    }

    board[pos.row]![pos.col] = color;
    moveCount++;

    if (checkWin(board, pos, color)) {
      return { winner: color, moveCount };
    }
  }

  return { winner: "draw", moveCount: DRAW_MOVE_LIMIT };
}

async function main(): Promise<void> {
  // #43 PR-6: 禁手判定は pure-wasm のため先にロード。
  await preloadForbiddenWasm();
  const maxGames = parseInt(
    process.argv.find((a) => a.startsWith("--games="))?.slice(8) ?? "52",
    10,
  );

  console.log("=== 簡易ベンチマーク ===");
  console.log(`条件: hard vs hard, 最大${maxGames}局\n`);

  const wasm: WasmModuleContext = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  const startTime = performance.now();
  const names = getAllJushuNames();

  let gameCount = 0;
  let blackWins = 0;
  let whiteWins = 0;
  let draws = 0;
  let totalMoves = 0;

  for (const name of names) {
    if (gameCount >= maxGames) {
      break;
    }
    const positions = getJushuPositions(name, true);
    if (!positions) {
      continue;
    }

    for (let i = 0; i < 2; i++) {
      if (gameCount >= maxGames) {
        break;
      }

      engine.clearTT();
      const result = playGame(engine, positions);
      totalMoves += result.moveCount;

      if (result.winner === "black") {
        blackWins++;
      } else if (result.winner === "white") {
        whiteWins++;
      } else {
        draws++;
      }

      gameCount++;
      process.stdout.write(`\r  ${gameCount}/${maxGames} games completed`);
    }
  }

  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`\n実行時間: ${elapsed.toFixed(1)}秒`);

  console.log(`\n=== 結果 ===`);
  console.log(`対局数: ${gameCount}`);
  console.log(`勝敗: 黒 ${blackWins} - 白 ${whiteWins} - 引分 ${draws}`);
  console.log(
    `総手数: ${totalMoves} (平均 ${(totalMoves / gameCount).toFixed(1)}/game)`,
  );
  console.log(`秒/局: ${(elapsed / gameCount).toFixed(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
