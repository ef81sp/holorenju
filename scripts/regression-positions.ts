#!/usr/bin/env node
/**
 * 重み・評価変更後の手動回帰チェック: 過去に実戦・振り返りで発覚した
 * 「CPU が強制負けにつながる手を選んだ」局面を集めて回帰確認する。
 *
 * 局面のレジストリは scripts/lib/regressionPositions.ts（prospect-corpus.ts が
 * 学習コーパスから同一局面を除外するのにも使う）。
 *
 * 各局面について、まずオープニングブックにヒットするか確認する（ヒットすれば
 * ブックの手を、しなければ hard CPU の実機探索の手を使う。cpu.worker.ts が実際に
 * 対局で行うのと同じ経路を再現するため）。選んだ手を打った後の局面で相手側に
 * VCF/VCT（強制勝ち手順）が生じないことを確認する。
 *
 * 判定は「特定の手を打たないこと」ではなく「相手に強制勝ちを許さないこと」という
 * 性質ベース。評価重み・探索パラメータを変更しても、CPU が別の手を選ぶようになれば
 * それで良い — 重要なのは結果として相手に必勝手順を与えないこと。
 *
 * Gate 系ベンチ（gate0-bench.ts 等）の前に実行する。実機時間を使うため局面ごとに
 * 数十秒程度、全体では数分かかる（vitest には載せない。手動実行専用）。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/regression-positions.ts
 *
 *   # 特定局面のみ実行
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/regression-positions.ts --only=p6-white-j6-collapse
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { isBookEligible } from "@/logic/cpu/bookGate";
import { countStones } from "@/logic/cpu/core/boardUtils";
import {
  getBookMove,
  setOpeningBookAsset,
  type OpeningBookAsset,
} from "@/logic/cpu/openingBook";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import { checkForcedWin, checkForcedWinAfterMove } from "./lib/forcedWinCheck";
import {
  REGRESSION_POSITIONS,
  type RegressionPosition,
} from "./lib/regressionPositions.ts";

/** regression-positions.ts が想定する実機経路の難易度（hard固定）。 */
const REGRESSION_DIFFICULTY = "hard";

function parseArgs(): { only: string | null; bookPath: string } {
  const args = process.argv.slice(2);
  let only: string | null = null;
  let bookPath = "src/assets/opening-book-hard.json";
  for (const arg of args) {
    if (arg.startsWith("--only=")) {
      only = arg.slice("--only=".length);
    } else if (arg.startsWith("--book=")) {
      bookPath = arg.slice("--book=".length);
    }
  }
  return { only, bookPath };
}

interface CheckResult {
  pass: boolean;
  chosenMove: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequence: string | null;
  elapsedMs: number;
  /** オープニングブック経由の手を使ったか（false なら hard の生の探索）。 */
  viaBook: boolean;
}

/**
 * 局面を検証する。cpu.worker.ts が実際の対局で行うのと同じ経路を再現する:
 * まずオープニングブックにヒットするか確認し（対象 ply・hard 難易度のときのみ）、
 * ヒットすればブックの手を、しなければ hard の生の実機探索（実機時間）の手を使う。
 */
function checkPosition(
  engine: WasmSearchEngine,
  pos: RegressionPosition,
): CheckResult {
  const start = Date.now();
  const { board, nextColor } = createBoardFromRecord(pos.kifuPrefix);
  if (nextColor !== pos.sideToMove) {
    throw new Error(
      `${pos.id}: kifuPrefix の手数と sideToMove が矛盾しています` +
        `（棋譜から算出した手番=${nextColor}, 指定=${pos.sideToMove}）`,
    );
  }

  const moveCount = countStones(board);
  const bookMove = isBookEligible(
    REGRESSION_DIFFICULTY,
    pos.sideToMove,
    moveCount,
  )
    ? getBookMove(board, pos.sideToMove)
    : null;

  if (bookMove) {
    const afterResult = checkForcedWinAfterMove(
      engine,
      board,
      pos.sideToMove,
      bookMove,
    );
    return {
      pass: afterResult.forcedWinKind === null,
      chosenMove: formatMove(bookMove),
      forcedWinKind: afterResult.forcedWinKind,
      forcedWinSequence: afterResult.forcedWinSequenceStr,
      elapsedMs: Date.now() - start,
      viaBook: true,
    };
  }

  // フォールバック: 実機経路・実機時間（DIFFICULTY_PARAMS.hard の
  // depth/timeLimit/maxNodes/evaluationOptions）で hard の生の探索を使う。
  const result = checkForcedWin(engine, board, pos.sideToMove);

  return {
    pass: result.forcedWinKind === null,
    chosenMove: result.chosenMoveStr,
    forcedWinKind: result.forcedWinKind,
    forcedWinSequence: result.forcedWinSequenceStr,
    elapsedMs: result.elapsedMs,
    viaBook: false,
  };
}

async function main(): Promise<void> {
  const { only, bookPath } = parseArgs();
  const targets = only
    ? REGRESSION_POSITIONS.filter((p) => p.id === only)
    : REGRESSION_POSITIONS;
  if (targets.length === 0) {
    console.error(`該当する局面が見つかりません: --only=${only}`);
    process.exit(1);
  }

  try {
    const bookAsset = JSON.parse(
      readFileSync(path.resolve(bookPath), "utf-8"),
    ) as OpeningBookAsset;
    setOpeningBookAsset(bookAsset);
    console.log(
      `book: ${bookPath}（${Object.keys(bookAsset.entries).length}件）`,
    );
  } catch (err) {
    console.log(
      `book: ${bookPath} のロードに失敗しました（ブックなしで実行します）: ${String(err)}`,
    );
    setOpeningBookAsset(null);
  }

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  console.log("========================================");
  console.log(` 回帰チェック: 過去の敗着局面 (${targets.length}件)`);
  console.log("========================================");

  let allPass = true;
  for (const pos of targets) {
    console.log("");
    console.log(`--- ${pos.id} ---`);
    console.log(
      `  局面: ${pos.kifuPrefix}（${pos.sideToMove === "black" ? "黒" : "白"}番）`,
    );
    console.log(`  説明: ${pos.description}`);
    console.log(`  出典: ${pos.source}`);

    const result = checkPosition(engine, pos);
    const via = result.viaBook ? "ブック" : "hard生探索";
    console.log(
      `  選択手（${via}）: ${result.chosenMove}（${(result.elapsedMs / 1000).toFixed(1)}秒）`,
    );
    if (result.pass) {
      console.log("  → PASS（相手に強制勝ち手順なし）");
    } else {
      console.log(
        `  → FAIL（相手に${result.forcedWinKind}あり: ${result.forcedWinSequence}）`,
      );
      allPass = false;
    }
  }

  console.log("");
  console.log("========================================");
  console.log(allPass ? " 結果: 全 PASS" : " 結果: FAIL あり");
  console.log("========================================");

  process.exit(allPass ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
