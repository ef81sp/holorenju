/**
 * VCT探索 診断スクリプト
 *
 * VCT探索の発動状況、打ち切り原因、hasOpenThreeの呼び出し回数を計測する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/diagnose-vct.ts
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/diagnose-vct.ts --record="H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11"
 */

import type { BoardState, StoneColor } from "../src/types/game.ts";

import { countStones } from "../src/logic/cpu/core/boardUtils.ts";
import { findVCFMove } from "../src/logic/cpu/search/vcf.ts";
import { hasVCT } from "../src/logic/cpu/search/vct.ts";
import { hasOpenThree } from "../src/logic/cpu/search/vctHelpers.ts";
import { boardToAscii } from "./lib/boardDisplay.ts";
import { loadPosition } from "./lib/positionLoader.ts";

// =============================================================================
// hasOpenThree のモンキーパッチ計測
// =============================================================================

let _hasOpenThreeCalls = 0;
const boardHashes = new Map<string, number>();

// 盤面の簡易ハッシュ（診断用）
function simpleBoardHash(board: BoardState): string {
  let h = "";
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = board[r]?.[c];
      if (cell === "black") {
        h += "B";
      } else if (cell === "white") {
        h += "W";
      } else {
        h += ".";
      }
    }
  }
  return h;
}

// オリジナルを保持
const originalHasOpenThree = hasOpenThree;

// パッチ版
function _patchedHasOpenThree(
  board: BoardState,
  color: "black" | "white",
): boolean {
  _hasOpenThreeCalls++;
  const key = `${simpleBoardHash(board)}:${color}`;
  boardHashes.set(key, (boardHashes.get(key) ?? 0) + 1);
  return originalHasOpenThree(board, color);
}

// vctHelpers のエクスポートをパッチ — モジュールバインディング変更は不可なので
// vct.ts が import した hasOpenThree を差し替える方法は使えない。
// 代わりに、hasVCT を直接呼ぶ前後で計測する。

function _resetCounters(): void {
  _hasOpenThreeCalls = 0;
  boardHashes.clear();
}

// =============================================================================
// VCT 直接テスト（hasOpenThree をラップしたバージョン）
// =============================================================================

function diagnoseVCT(
  board: BoardState,
  color: StoneColor,
  label: string,
): void {
  console.log(`\n=== ${label} (${color}番) ===`);
  console.log(`石数: ${countStones(board)}`);

  // まず hasOpenThree 自体のコスト計測
  const hotStart = performance.now();
  const hotResult = originalHasOpenThree(
    board,
    color === "black" ? "white" : "black",
  );
  const hotTime = performance.now() - hotStart;
  console.log(
    `hasOpenThree(${color === "black" ? "white" : "black"}): ${hotResult} (${hotTime.toFixed(3)}ms)`,
  );

  // VCF チェック
  const vcfStart = performance.now();
  const vcfResult = findVCFMove(board, color, {
    maxDepth: 8,
    maxNodes: 200,
    timeLimit: 50,
  });
  const vcfTime = performance.now() - vcfStart;
  console.log(
    `VCF: ${vcfResult ? `found (${vcfResult.row},${vcfResult.col})` : "not found"} (${vcfTime.toFixed(1)}ms)`,
  );

  // VCT チェック — 各種予算で
  for (const budget of [
    {
      maxDepth: 4,
      maxNodes: 400,
      timeLimit: 50,
      label: "default(d4,n400,t50)",
    },
    {
      maxDepth: 5,
      maxNodes: 800,
      timeLimit: 150,
      label: "medium(d5,n800,t150)",
    },
    {
      maxDepth: 6,
      maxNodes: 2000,
      timeLimit: 500,
      label: "large(d6,n2000,t500)",
    },
    {
      maxDepth: 8,
      maxNodes: 10000,
      timeLimit: 2000,
      label: "huge(d8,n10000,t2000)",
    },
  ]) {
    const start = performance.now();
    const result = hasVCT(board, color, 0, undefined, {
      maxDepth: budget.maxDepth,
      maxNodes: budget.maxNodes,
      timeLimit: budget.timeLimit,
    });
    const elapsed = performance.now() - start;
    console.log(`VCT [${budget.label}]: ${result} (${elapsed.toFixed(1)}ms)`);
  }
}

// =============================================================================
// テスト局面
// =============================================================================

function parseArgs(): { record: string } {
  const args = process.argv.slice(2);
  let record =
    "H8 H9 I8 G8 I9 I10 F7 G7 G9 H10 F9 J11 G10 H7 F10 E10 H6 I5 G6 F5";
  for (const arg of args) {
    if (arg.startsWith("--record=")) {
      record = arg.slice("--record=".length);
    }
  }
  return { record };
}

// =============================================================================
// メイン
// =============================================================================

function main(): void {
  const { record } = parseArgs();
  const pos = loadPosition(record);

  console.log("=== 局面 ===");
  console.log(boardToAscii(pos.board));
  console.log(`手数: ${pos.moveCount}, 次手番: ${pos.nextColor}`);

  // 現在の局面でVCT診断
  diagnoseVCT(pos.board, pos.nextColor, "現在の局面");

  // 相手番でもチェック
  const otherColor: StoneColor = pos.nextColor === "black" ? "white" : "black";
  diagnoseVCT(pos.board, otherColor, "相手番");

  // 追加: いくつかの手を戻した局面でもチェック
  if (pos.moveCount >= 4) {
    const earlierRecord = record.split(" ").slice(0, -4).join(" ");
    if (earlierRecord) {
      const earlierPos = loadPosition(earlierRecord);
      console.log("\n=== 4手前の局面 ===");
      console.log(boardToAscii(earlierPos.board));
      diagnoseVCT(earlierPos.board, earlierPos.nextColor, "4手前");
    }
  }
}

main();
