#!/usr/bin/env node
/**
 * 局面脅威分析 CLI
 *
 * 棋譜文字列を受け取り、局面の脅威（VCF/VCT/Mise-VCF/活三/四）を分析する。
 *
 * 使用例:
 *   pnpm analyze:position "H8 G7 I9 I7 J8 K7"
 *   pnpm analyze:position "H8 G7 I9 I7 J8 K7" --move=4     # 4手目まで
 *   pnpm analyze:position "H8 G7 I9 I7 J8 K7" --color=black # 黒の脅威のみ
 *   pnpm analyze:position "H8 G7 I9 I7 J8 K7" --deep        # 深い探索
 */

import type { StoneColor } from "../src/types/game.ts";

import { findMiseVCFSequence } from "../src/logic/cpu/search/miseVcf.ts";
import { findFourMoves, findVCFSequence } from "../src/logic/cpu/search/vcf.ts";
import {
  findVCTSequence,
  hasOpenThree,
  countStones,
  VCT_STONE_THRESHOLD,
} from "../src/logic/cpu/search/vct.ts";
import { formatMove } from "../src/logic/gameRecordParser.ts";
import { formatPositionSummary, loadPosition } from "./lib/positionLoader.ts";

// === CLI引数解析 ===

const args = process.argv.slice(2);
const record = args.find((a) => !a.startsWith("--"));

if (!record) {
  console.log(
    "使い方: pnpm analyze:position <棋譜> [--move=N] [--color=black|white] [--deep]",
  );
  console.log("");
  console.log("例:");
  console.log('  pnpm analyze:position "H8 G7 I9 I7 J8 K7"');
  console.log('  pnpm analyze:position "H8 G7 I9 I7" --move=2');
  console.log('  pnpm analyze:position "H8 G7 I9 I7" --deep');
  process.exit(1);
}

const moveArg = args.find((a) => a.startsWith("--move="));
const upToMove = moveArg ? parseInt(moveArg.split("=")[1]!, 10) : undefined;

const colorArg = args.find((a) => a.startsWith("--color="));
const filterColor = colorArg
  ? (colorArg.split("=")[1] as StoneColor)
  : undefined;

const isDeep = args.includes("--deep");

// === 局面ロード ===

const pos = loadPosition(record, upToMove);

console.log("========================================");
console.log(" 局面脅威分析");
console.log("========================================");
console.log(formatPositionSummary(pos));
console.log("");

// === 分析 ===

const colors: StoneColor[] = filterColor
  ? [filterColor]
  : [pos.nextColor, pos.nextColor === "black" ? "white" : "black"];

const vcfOptions = isDeep
  ? { maxDepth: 16, timeLimit: 5000 }
  : { maxDepth: 8, timeLimit: 1000 };

const vctOptions = isDeep
  ? {
      maxDepth: 6,
      timeLimit: 5000,
      vcfOptions: { maxDepth: 16, timeLimit: 5000 },
    }
  : {
      maxDepth: 4,
      timeLimit: 1000,
      vcfOptions: { maxDepth: 8, timeLimit: 1000 },
    };

for (const color of colors) {
  const label = color === "black" ? "黒" : "白";
  const opponent: StoneColor = color === "black" ? "white" : "black";

  console.log(`--- ${label}番の分析 ---`);

  // 活三チェック
  const openThree = hasOpenThree(pos.board, color);
  console.log(`  活三: ${openThree ? "あり" : "なし"}`);

  // 四を作れる位置
  const fourMoves = findFourMoves(pos.board, color);
  if (fourMoves.length > 0) {
    const fourNotations = fourMoves.map((m) => formatMove(m));
    console.log(
      `  四が作れる位置: ${fourNotations.join(", ")} (${fourMoves.length}箇所)`,
    );
  } else {
    console.log("  四が作れる位置: なし");
  }

  // VCF
  const vcfResult = findVCFSequence(pos.board, color, vcfOptions);
  if (vcfResult) {
    const seq = vcfResult.sequence.map((m) => formatMove(m)).join(" ");
    console.log(
      `  VCF: あり (${vcfResult.sequence.length}手) ${vcfResult.isForbiddenTrap ? "[禁手追い込み]" : ""}`,
    );
    console.log(`    手順: ${seq}`);
  } else {
    console.log(`  VCF: なし`);
  }

  // Mise-VCF
  const opponentHasOpenThree = hasOpenThree(pos.board, opponent);
  const miseResult = findMiseVCFSequence(pos.board, color);
  if (miseResult) {
    const seq = miseResult.sequence.map((m) => formatMove(m)).join(" ");
    console.log(
      `  Mise-VCF: あり (ミセ手: ${formatMove(miseResult.firstMove)})`,
    );
    console.log(`    手順: ${seq}`);
  } else if (opponentHasOpenThree) {
    console.log(
      `  Mise-VCF: スキップ (相手に活三あり → ミセの強制応手が成立しない)`,
    );
  } else {
    console.log(`  Mise-VCF: なし`);
  }

  // VCT（石数閾値チェック）
  const stones = countStones(pos.board);
  if (stones >= VCT_STONE_THRESHOLD) {
    const vctResult = findVCTSequence(pos.board, color, vctOptions);
    if (vctResult) {
      const seq = vctResult.sequence.map((m) => formatMove(m)).join(" ");
      console.log(
        `  VCT: あり (${vctResult.sequence.length}手) ${vctResult.isForbiddenTrap ? "[禁手追い込み]" : ""}`,
      );
      console.log(`    手順: ${seq}`);
    } else if (opponentHasOpenThree) {
      console.log(`  VCT: スキップ (相手に活三あり → VCFでしか勝てない)`);
    } else {
      console.log(`  VCT: なし`);
    }
  } else {
    console.log(`  VCT: スキップ (石数${stones} < 閾値${VCT_STONE_THRESHOLD})`);
  }

  console.log("");
}
