/**
 * VCF偽陽性デバッグスクリプト
 *
 * ベンチマーク結果から VCF 検出局面を再現し、
 * findVCFSequence のルートをダンプして偽陽性の原因を特定する。
 *
 * Usage:
 *   pnpm debug:vcf <benchfile> <gameIndex> <moveNumber>
 *   pnpm debug:vcf bench-results/bench-2026-02-20T03-15-21-203Z.json 185 15
 */

import * as fs from "node:fs";

import type { BoardState, Position } from "@/types/game";

import { findMiseVCFSequence } from "@/logic/cpu/search/miseVcf";
import { createsFour } from "@/logic/cpu/search/threatMoves";
import {
  findFourMoves,
  getFourDefensePosition,
} from "@/logic/cpu/search/threatPatterns";
import { findVCFSequence } from "@/logic/cpu/search/vcf";
import {
  checkFive,
  checkForbiddenMove,
  createEmptyBoard,
} from "@/logic/renjuRules";

interface MoveRecord {
  row: number;
  col: number;
  score?: number;
  depth?: number;
}

interface GameResult {
  winner: "A" | "B" | "draw";
  reason: string;
  moves: number;
  moveHistory: MoveRecord[];
  isABlack: boolean;
}

interface BenchData {
  games: GameResult[];
}

function toCoord(row: number, col: number): string {
  return String.fromCharCode(65 + col) + (15 - row);
}

function posToStr(p: Position): string {
  return toCoord(p.row, p.col);
}

function printBoard(board: BoardState): void {
  console.log("   A B C D E F G H I J K L M N O");
  for (let r = 0; r < 15; r++) {
    const rowNum = String(15 - r).padStart(2);
    const cells: string[] = [];
    for (let c = 0; c < 15; c++) {
      const cell = board[r]?.[c];
      if (cell === "black") {
        cells.push("X");
      } else if (cell === "white") {
        cells.push("O");
      } else {
        cells.push(".");
      }
    }
    console.log(`${rowNum} ${cells.join(" ")}`);
  }
}

/**
 * VCFルートを1手ずつ検証し、破綻箇所を特定
 */
function verifyVCFSequence(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
): void {
  const opponentColor = color === "black" ? "white" : "black";

  console.log("\n=== VCFルート検証 ===");

  // ボードをコピー
  const testBoard: BoardState = board.map((row) => [...row]);

  for (let i = 0; i < sequence.length; i++) {
    const pos = sequence[i];
    if (!pos) {
      break;
    }

    const isAttack = i % 2 === 0;
    const moveColor = isAttack ? color : opponentColor;
    const label = isAttack
      ? `攻撃${Math.floor(i / 2) + 1}`
      : `防御${Math.floor(i / 2) + 1}`;

    console.log(`\nStep ${i + 1} (${label}): ${posToStr(pos)} [${moveColor}]`);

    // 既に石がある場合
    if (testBoard[pos.row]?.[pos.col] !== null) {
      console.log("  *** ERROR: 既に石がある位置に着手 ***");
      console.log(`  石: ${testBoard[pos.row]?.[pos.col]}`);
      return;
    }

    // 攻撃手の検証
    if (isAttack) {
      // 禁手チェック（黒攻撃の場合）
      if (moveColor === "black") {
        const forbidden = checkForbiddenMove(testBoard, pos.row, pos.col);
        if (forbidden.isForbidden) {
          console.log(
            `  *** ERROR: 黒の攻撃手が禁手 (${forbidden.reason}) ***`,
          );
          return;
        }
      }

      // 石を置く
      const row = testBoard[pos.row];
      if (row) {
        row[pos.col] = moveColor;
      }

      // 五連チェック
      if (checkFive(testBoard, pos.row, pos.col, moveColor)) {
        console.log("  -> 五連完成！ VCF成功");
        return;
      }

      // 四を作るかチェック
      if (!createsFour(testBoard, pos.row, pos.col, moveColor)) {
        console.log("  *** ERROR: 攻撃手が四を作っていない ***");
        // 周辺の状況を表示
        const fourMoves = findFourMoves(testBoard, moveColor);
        console.log(
          `  利用可能な四を作る手: ${fourMoves.map(posToStr).join(", ") || "なし"}`,
        );
        return;
      }
      console.log("  -> 四を形成");

      // 防御位置の確認
      const defensePos = getFourDefensePosition(testBoard, pos, moveColor);
      if (!defensePos) {
        console.log("  -> 活四（防御不能）！ VCF成功");
        return;
      }
      console.log(`  防御位置: ${posToStr(defensePos)}`);

      // 白攻撃の場合、黒の防御位置が禁手かチェック
      if (moveColor === "white") {
        const forbidden = checkForbiddenMove(
          testBoard,
          defensePos.row,
          defensePos.col,
        );
        if (forbidden.isForbidden) {
          console.log(
            `  -> 防御位置が禁手 (${forbidden.reason})！ 禁手追い込み成功`,
          );
          return;
        }
      }

      // 次の手が防御手と一致するか確認
      const nextPos = sequence[i + 1];
      if (nextPos) {
        if (nextPos.row !== defensePos.row || nextPos.col !== defensePos.col) {
          console.log(
            `  *** WARNING: VCFルートの防御手 ${posToStr(nextPos)} が期待防御位置 ${posToStr(defensePos)} と不一致 ***`,
          );
        }
      }
    } else {
      // 防御手
      const row = testBoard[pos.row];
      if (row) {
        row[pos.col] = moveColor;
      }

      // 防御手で五連完成？
      if (checkFive(testBoard, pos.row, pos.col, moveColor)) {
        console.log("  *** 防御手で相手が五連完成！ VCF失敗 ***");
        return;
      }

      // 防御手でカウンターフォー？
      if (createsFour(testBoard, pos.row, pos.col, moveColor)) {
        console.log("  *** 防御手がカウンターフォーを形成！ VCF中断リスク ***");
        // カウンターフォーの詳細
        const counterDefense = getFourDefensePosition(
          testBoard,
          pos,
          moveColor,
        );
        if (counterDefense) {
          console.log(
            `    カウンターフォーの防御位置: ${posToStr(counterDefense)}`,
          );
        } else {
          console.log("    カウンターフォーが活四！ VCF失敗");
          return;
        }
      }
    }
  }

  console.log("\n=== VCFルートの全手順を検証完了 ===");
}

/**
 * 盤面を再現してVCF探索を実行
 */
function debugGame(
  game: GameResult,
  gameIndex: number,
  moveNumber: number,
): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Game ${gameIndex}: ${game.winner} wins by ${game.reason} (${game.moves} moves)`,
  );
  console.log(`isABlack: ${game.isABlack}`);
  console.log(`VCF検出手: m${moveNumber}`);
  console.log(`${"=".repeat(60)}`);

  // 盤面を再構築（moveNumber-1手目まで）
  const board = createEmptyBoard();
  const moveIndex = moveNumber - 1; // 0-indexed

  for (let mi = 0; mi < moveIndex; mi++) {
    const m = game.moveHistory[mi];
    if (!m) {
      continue;
    }
    const color: "black" | "white" = mi % 2 === 0 ? "black" : "white";
    const row = board[m.row];
    if (row) {
      row[m.col] = color;
    }
  }

  const currentColor: "black" | "white" =
    moveIndex % 2 === 0 ? "black" : "white";
  const vcfMove = game.moveHistory[moveIndex];

  console.log(`\n着手番: ${currentColor}`);
  console.log(
    `実際の着手: ${vcfMove ? toCoord(vcfMove.row, vcfMove.col) : "不明"} (score=${vcfMove?.score}, depth=${vcfMove?.depth})`,
  );
  console.log(`\n盤面 (m${moveNumber}着手前):`);
  printBoard(board);

  // VCF探索を実行
  console.log(`\n--- VCF探索 (${currentColor}) ---`);
  const startTime = performance.now();
  const vcfResult = findVCFSequence(board, currentColor, {
    maxDepth: 12, // 深い探索で再現確認
    timeLimit: 5000, // 十分な時間を確保
  });
  const elapsed = performance.now() - startTime;

  if (vcfResult) {
    console.log(`VCF発見！ (${elapsed.toFixed(1)}ms)`);
    console.log(`  最初の手: ${posToStr(vcfResult.firstMove)}`);
    console.log(`  禁手追い込み: ${vcfResult.isForbiddenTrap}`);
    console.log(`  手順 (${vcfResult.sequence.length}手):`);
    for (let i = 0; i < vcfResult.sequence.length; i++) {
      const p = vcfResult.sequence[i];
      if (!p) {
        break;
      }
      const isAttack = i % 2 === 0;
      const label = isAttack ? "攻撃" : "防御";
      console.log(`    ${i + 1}. ${label}: ${posToStr(p)}`);
    }

    // ルートを検証
    verifyVCFSequence(board, currentColor, vcfResult.sequence);
  } else {
    console.log(`VCF見つからず (${elapsed.toFixed(1)}ms)`);
  }

  // Mise-VCF探索も実行
  console.log(`\n--- Mise-VCF探索 (${currentColor}) ---`);
  const miseStart = performance.now();
  const miseResult = findMiseVCFSequence(board, currentColor, {
    vcfOptions: { maxDepth: 12, timeLimit: 1000 },
    timeLimit: 3000,
  });
  const miseElapsed = performance.now() - miseStart;

  if (miseResult) {
    console.log(`Mise-VCF発見！ (${miseElapsed.toFixed(1)}ms)`);
    console.log(`  ミセ手: ${posToStr(miseResult.miseMove)}`);
    console.log(`  防御手: ${posToStr(miseResult.defenseMove)}`);
    console.log(`  禁手追い込み: ${miseResult.isForbiddenTrap}`);
    console.log(`  手順: ${miseResult.sequence.map(posToStr).join(" -> ")}`);
  } else {
    console.log(`Mise-VCFなし (${miseElapsed.toFixed(1)}ms)`);
  }

  // 相手のVCFも確認
  const opponentColor = currentColor === "black" ? "white" : "black";
  console.log(`\n--- 相手VCF探索 (${opponentColor}) ---`);
  const oppStart = performance.now();
  const oppVcf = findVCFSequence(board, opponentColor, {
    maxDepth: 12,
    timeLimit: 5000,
  });
  const oppElapsed = performance.now() - oppStart;

  if (oppVcf) {
    console.log(`相手VCF発見！ (${oppElapsed.toFixed(1)}ms)`);
    console.log(`  最初の手: ${posToStr(oppVcf.firstMove)}`);
    console.log(`  禁手追い込み: ${oppVcf.isForbiddenTrap}`);
    console.log(`  手順: ${oppVcf.sequence.map(posToStr).join(" -> ")}`);
  } else {
    console.log(`相手VCFなし (${oppElapsed.toFixed(1)}ms)`);
  }

  // m+1 (実際の着手後) の盤面でもVCFを確認
  if (vcfMove) {
    const boardAfterMove = board.map((r) => [...r]);
    const moveRow = boardAfterMove[vcfMove.row];
    if (moveRow) {
      moveRow[vcfMove.col] = currentColor;
    }

    console.log(`\n--- m${moveNumber}着手後のVCF探索 (${opponentColor}番) ---`);
    const afterStart = performance.now();
    const afterVcf = findVCFSequence(boardAfterMove, opponentColor, {
      maxDepth: 12,
      timeLimit: 5000,
    });
    const afterElapsed = performance.now() - afterStart;

    if (afterVcf) {
      console.log(`VCF発見！ (${afterElapsed.toFixed(1)}ms)`);
      console.log(`  最初の手: ${posToStr(afterVcf.firstMove)}`);
      console.log(`  手順: ${afterVcf.sequence.map(posToStr).join(" -> ")}`);
    } else {
      console.log(`VCFなし (${afterElapsed.toFixed(1)}ms)`);
    }
  }

  // m+2 後のVCFも確認（次の相手着手後）
  if (vcfMove && game.moveHistory[moveIndex + 1]) {
    const m2 = game.moveHistory[moveIndex + 1];
    if (!m2) {
      return;
    }
    const boardAfter2 = board.map((r) => [...r]);
    const row1 = boardAfter2[vcfMove.row];
    if (row1) {
      row1[vcfMove.col] = currentColor;
    }
    const row2 = boardAfter2[m2.row];
    if (row2) {
      row2[m2.col] = opponentColor;
    }

    console.log(
      `\n--- m${moveNumber + 1}着手後 (${opponentColor} ${toCoord(m2.row, m2.col)}) のVCF探索 (${currentColor}番) ---`,
    );
    const after2Start = performance.now();
    const after2Vcf = findVCFSequence(boardAfter2, currentColor, {
      maxDepth: 12,
      timeLimit: 5000,
    });
    const after2Elapsed = performance.now() - after2Start;

    if (after2Vcf) {
      console.log(`VCF発見！ (${after2Elapsed.toFixed(1)}ms)`);
      console.log(`  最初の手: ${posToStr(after2Vcf.firstMove)}`);
      console.log(`  手順: ${after2Vcf.sequence.map(posToStr).join(" -> ")}`);
    } else {
      console.log(`VCFなし (${after2Elapsed.toFixed(1)}ms) ← ここでVCFが消失`);
    }
  }
}

// メイン処理
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: pnpm debug:vcf <benchfile> <gameIndex> <moveNumber>");
  console.log("  pnpm debug:vcf bench-results/bench-*.json 185 15");
  console.log("\nAll 3 known false positive games:");
  console.log(
    "  pnpm debug:vcf bench-results/bench-2026-02-20T03-15-21-203Z.json all",
  );
  process.exit(1);
}

const benchFile = args[0] ?? "";
const data: BenchData = JSON.parse(fs.readFileSync(benchFile, "utf-8"));

if (args[1] === "all") {
  // 既知の3ゲームを全て分析
  const targets = [
    { gameIndex: 185, moveNumber: 15 },
    { gameIndex: 156, moveNumber: 49 },
    { gameIndex: 121, moveNumber: 42 },
  ];
  for (const { gameIndex, moveNumber } of targets) {
    const game = data.games[gameIndex];
    if (game) {
      debugGame(game, gameIndex, moveNumber);
    }
  }
} else {
  const gameIndex = parseInt(args[1] ?? "0", 10);
  const moveNumber = parseInt(args[2] ?? "0", 10);
  const game = data.games[gameIndex];
  if (!game) {
    console.error(`Game ${gameIndex} not found`);
    process.exit(1);
  }
  debugGame(game, gameIndex, moveNumber);
}
