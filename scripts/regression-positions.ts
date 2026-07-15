#!/usr/bin/env node
/**
 * 重み・評価変更後の手動回帰チェック: 過去に実戦・振り返りで発覚した
 * 「CPU が強制負けにつながる手を選んだ」局面を集めて回帰確認する。
 *
 * 各局面について hard CPU（実機経路: WasmSearchEngine.findBestMove、実機時間
 * = DIFFICULTY_PARAMS.hard の depth/timeLimit/maxNodes）に着手させ、選んだ手を
 * 打った後の局面で相手側に VCF/VCT（強制勝ち手順）が生じないことを確認する。
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

import type { BoardState, Position, StoneColor } from "@/types/game";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

type Side = Exclude<StoneColor, null>;

/**
 * 回帰チェック対象の局面。
 * 実戦・振り返りで「CPU が強制負けにつながる手を選んだ」ことが判明するたびに
 * ここへ追加していく（拡張前提のレジストリ）。
 */
interface RegressionPosition {
  /** 一意なID（ログ・--only フィルタで使用） */
  id: string;
  /** 局面までの棋譜（開始局面からの手順、スペース区切り） */
  kifuPrefix: string;
  /** kifuPrefix 終了時点の手番（kifuPrefix の手数と矛盾していないか実行時に検証する） */
  sideToMove: Side;
  /** どういう局面で何が問題だったか */
  description: string;
  /** 出典（実戦棋譜全体・発覚日など） */
  source: string;
}

const REGRESSION_POSITIONS: RegressionPosition[] = [
  {
    id: "p6-white-j6-collapse",
    kifuPrefix: "H8 I9 I8 G8 H7 G6 I7",
    sideToMove: "white",
    description:
      "白8手目 J6 が敗着。J6 を打った後、黒に11手の VCT（強制勝ち手順）が生じる。",
    source:
      "2026-07-15 ボス実戦棋譜（黒=人間の勝ち）: " +
      "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7 H6 H9 G5 F4 H4 H5 E7 F7 F6 I3 D8",
  },
];

// investigate-white-collapse.ts の調査時に使用した予算と同等（十分な探索深度・時間）
const VCF_MAX_DEPTH = 16;
const VCF_TIME_LIMIT_MS = 5000;
const VCF_MAX_NODES = 500_000;
const VCT_MAX_DEPTH = 6;
const VCT_TIME_LIMIT_MS = 5000;
const VCT_MAX_NODES = 500_000;

function parseArgs(): { only: string | null } {
  const args = process.argv.slice(2);
  let only: string | null = null;
  for (const arg of args) {
    if (arg.startsWith("--only=")) {
      only = arg.slice("--only=".length);
    }
  }
  return { only };
}

function opponentOf(color: Side): Side {
  return color === "black" ? "white" : "black";
}

function applyMove(board: BoardState, pos: Position, color: Side): BoardState {
  const next = board.map((row) => [...row]) as BoardState;
  const targetRow = next[pos.row];
  if (!targetRow) {
    throw new Error(`invalid row: ${pos.row}`);
  }
  targetRow[pos.col] = color;
  return next;
}

interface CheckResult {
  pass: boolean;
  chosenMove: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequence: string | null;
  elapsedMs: number;
}

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

  // 実機経路・実機時間: DIFFICULTY_PARAMS.hard の depth/timeLimit/maxNodes/evaluationOptions を使用
  const result = engine.findBestMove(board, pos.sideToMove, "hard");
  const chosenMove = formatMove(result.position);

  const opponent = opponentOf(pos.sideToMove);
  const afterMove = applyMove(board, result.position, pos.sideToMove);

  const vcf = engine.findVCFSequence(
    afterMove,
    opponent,
    VCF_MAX_DEPTH,
    VCF_TIME_LIMIT_MS,
    VCF_MAX_NODES,
  );
  const forcedWin =
    vcf ??
    engine.findVCTSequence(
      afterMove,
      opponent,
      VCT_MAX_DEPTH,
      VCT_TIME_LIMIT_MS,
      VCT_MAX_NODES,
      false,
    );

  const elapsedMs = Date.now() - start;
  if (!forcedWin) {
    return {
      pass: true,
      chosenMove,
      forcedWinKind: null,
      forcedWinSequence: null,
      elapsedMs,
    };
  }
  return {
    pass: false,
    chosenMove,
    forcedWinKind: vcf ? "VCF" : "VCT",
    forcedWinSequence: forcedWin.sequence.map(formatMove).join(" "),
    elapsedMs,
  };
}

async function main(): Promise<void> {
  const { only } = parseArgs();
  const targets = only
    ? REGRESSION_POSITIONS.filter((p) => p.id === only)
    : REGRESSION_POSITIONS;
  if (targets.length === 0) {
    console.error(`該当する局面が見つかりません: --only=${only}`);
    process.exit(1);
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
    console.log(
      `  hard の選択手: ${result.chosenMove}（${(result.elapsedMs / 1000).toFixed(1)}秒）`,
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
