/**
 * 簡易棋譜記録ベンチ
 *
 * 数局プレイし、各手のスコア・深度を記録した JSON を出力する。
 * 弱点分析のための生データ取得用。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/quick-kifu-bench.ts --games=4
 */

import * as fs from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { getAllJushuNames, getJushuPositions } from "@/logic/cpu/opening";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import {
  checkForbiddenMove,
  checkWin,
  createEmptyBoard,
} from "@/logic/renjuRules";

const DRAW_MOVE_LIMIT = 70;

interface MoveRecord {
  moveNumber: number;
  color: "black" | "white";
  position: Position;
  positionLabel: string; // 例: H8
  score: number;
  depth: number;
  timeMs: number;
}

interface GameRecord {
  gameIndex: number;
  jushuName: string;
  winner: "black" | "white" | "draw";
  moveCount: number;
  moves: MoveRecord[];
  kifu: string; // スペース区切りの座標表記
}

function posToLabel(pos: Position): string {
  // 左下原点。col=0 は A、row=0 は 15 (上端)
  // 標準表記: 列(文字)→行(数字) 例: H8
  const colChar = String.fromCharCode("A".charCodeAt(0) + pos.col);
  const rowNum = 15 - pos.row;
  return `${colChar}${rowNum}`;
}

function playGame(
  engine: WasmSearchEngine,
  jushuName: string,
  openingMoves: [Position, Position, Position],
  gameIndex: number,
): GameRecord {
  const board: BoardState = createEmptyBoard();
  const colors: StoneColor[] = ["black", "white"];
  let moveCount = 0;
  const moves: MoveRecord[] = [];

  for (const pos of openingMoves) {
    const color = colors[moveCount % 2] as "black" | "white";
    board[pos.row]![pos.col] = color;
    moves.push({
      moveNumber: moveCount + 1,
      color,
      position: pos,
      positionLabel: posToLabel(pos),
      score: 0,
      depth: 0,
      timeMs: 0,
    });
    moveCount++;
  }

  let winner: "black" | "white" | "draw" = "draw";

  while (moveCount < DRAW_MOVE_LIMIT) {
    const color = colors[moveCount % 2] as "black" | "white";
    const start = performance.now();
    const result = engine.findBestMove(board, color, "hard");
    const elapsed = performance.now() - start;
    const pos = result.position;

    if (color === "black") {
      const forbidden = checkForbiddenMove(board, pos.row, pos.col);
      if (forbidden.isForbidden) {
        winner = "white";
        break;
      }
    }

    board[pos.row]![pos.col] = color;
    moves.push({
      moveNumber: moveCount + 1,
      color,
      position: pos,
      positionLabel: posToLabel(pos),
      score: result.score,
      depth: result.completedDepth,
      timeMs: elapsed,
    });
    moveCount++;

    if (checkWin(board, pos, color)) {
      winner = color;
      break;
    }
  }

  return {
    gameIndex,
    jushuName,
    winner,
    moveCount,
    moves,
    kifu: moves.map((m) => m.positionLabel).join(" "),
  };
}

async function main(): Promise<void> {
  const maxGames = parseInt(
    process.argv.find((a) => a.startsWith("--games="))?.slice(8) ?? "4",
    10,
  );

  console.log(`=== 簡易棋譜記録ベンチ (${maxGames}局) ===\n`);

  const wasm: WasmModuleContext = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);
  const startTime = performance.now();
  const names = getAllJushuNames();

  const games: GameRecord[] = [];
  let gameCount = 0;

  for (const name of names) {
    if (gameCount >= maxGames) {break;}
    const positions = getJushuPositions(name, true);
    if (!positions) {continue;}

    engine.clearTT();
    const game = playGame(engine, name, positions, gameCount);
    games.push(game);
    gameCount++;
    process.stdout.write(`\r  ${gameCount}/${maxGames} 完了`);
  }

  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`\n\n実行時間: ${elapsed.toFixed(1)}秒`);

  const blackWins = games.filter((g) => g.winner === "black").length;
  const whiteWins = games.filter((g) => g.winner === "white").length;
  const draws = games.filter((g) => g.winner === "draw").length;
  console.log(`勝敗: 黒 ${blackWins} - 白 ${whiteWins} - 引分 ${draws}`);

  // JSON 保存
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `bench-results/quick-kifu-${timestamp}.json`;
  if (!fs.existsSync("bench-results")) {fs.mkdirSync("bench-results");}
  fs.writeFileSync(outPath, JSON.stringify({ games }, null, 2));
  console.log(`\n保存先: ${outPath}`);

  // 棋譜を簡易表示
  console.log(`\n=== 棋譜一覧 ===`);
  for (const g of games) {
    console.log(
      `\n[${g.gameIndex + 1}] ${g.jushuName} (${g.winner}, ${g.moveCount}手)`,
    );
    console.log(`  ${g.kifu}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
