/**
 * P3 コーパス抽出: 既存 commit-bench 棋譜から quiet 局面をサンプルし、
 * 空点プロスペクト特徴ベクトル（i32×34）と勝敗ラベルを JSONL に dump する
 * （docs/plans/prospect-texel-p3-2026-07-15.md の事前登録フィルタ定義に従う）。
 *
 * Rapfi 評価値ラベルは別スクリプト（scripts/rapfi/labelCorpus.ts、
 * gitignore 対象のローカル運用）が本出力の JSONL に付与する。
 * そのため各行に black/white の石リストも含める（ラベラー側で盤面再構築不要）。
 *
 * quiet フィルタ（事前登録）:
 *   1. ply ∈ [minPly, 終局−endMargin]
 *   2. 手番側に即五なし / 3. 相手側に即五なし（必須防御局面の除外）
 *   4. hasVCF(手番側) が false（maxNodes=200 予算）
 *   5. |Rapfi eval| 上限カットはラベラー側で適用
 *   6. 盤面キー + 手番でグローバル dedup
 *   7. 1局あたり sampleInterval ply 間隔・最大 maxPerGame 局面
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/prospect-corpus.ts --input=/path/to/bench-results \
 *     --out=bench-results/prospect-corpus.jsonl
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { hasVCF } from "@/logic/cpu/search/vcfCheck";
import { boardStateToWasm, colorToWasm } from "@/logic/cpu/wasm/boardAdapter";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatLoader";
import { checkWin, createEmptyBoard } from "@/logic/renjuRules";

const FEATURE_COUNT = 34;

interface BenchMove {
  row: number;
  col: number;
  isOpening: boolean;
}

interface BenchGame {
  winner: "A" | "B" | "draw";
  reason: string;
  moveHistory: BenchMove[];
  isABlack: boolean;
  jushuName: string;
}

interface CorpusRow {
  /** 盤面キー + 手番（dedup 用。ラベラー・回帰側では未使用）。 */
  key: string;
  source: { file: string; gameIdx: number; ply: number; jushu: string };
  /** 手番側の色。特徴・ラベルはすべてこの視点。 */
  stm: "black" | "white";
  black: Position[];
  white: Position[];
  /** extractProspectFeatures(stm, stmIsPerspective=1) の i32×34。 */
  features: number[];
  /** 勝敗ラベル（stm 視点 1 / 0.5 / 0）。 */
  outcome: number;
}

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? Number.parseInt(raw.slice(name.length + 3), 10) : fallback;
}

function parseStringArg(name: string): string | undefined {
  return process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

function cellChar(cell: StoneColor | null): string {
  if (cell === "black") {
    return "b";
  }
  if (cell === "white") {
    return "w";
  }
  return ".";
}

function boardKey(board: BoardState, stm: StoneColor): string {
  let key = stm === "black" ? "b:" : "w:";
  for (const row of board) {
    for (const cell of row) {
      key += cellChar(cell);
    }
  }
  return key;
}

/** color がどこかの空点に置いて即座に五（勝ち）を作れるか。 */
function hasImmediateFive(
  board: BoardState,
  color: "black" | "white",
): boolean {
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board.length; col++) {
      if (board[row]![col] !== null) {
        continue;
      }
      board[row]![col] = color;
      const wins = checkWin(board, { row, col }, color);
      board[row]![col] = null;
      if (wins) {
        return true;
      }
    }
  }
  return false;
}

function extractFeatures(
  wasm: WasmModuleContext,
  board: BoardState,
  stm: "black" | "white",
): number[] {
  boardStateToWasm(wasm, board);
  const count = wasm.extractProspectFeatures(colorToWasm(stm), 1);
  if (count !== FEATURE_COUNT) {
    throw new Error(`特徴数不一致: got ${count}, want ${FEATURE_COUNT}`);
  }
  const ptr = wasm.getProspectFeatureBuffer();
  const view = new DataView(wasm.memory.buffer);
  const features: number[] = [];
  for (let i = 0; i < count; i++) {
    features.push(view.getInt32(ptr + i * 4, true));
  }
  return features;
}

interface FilterStats {
  candidates: number;
  rejectedFiveStm: number;
  rejectedFiveOpp: number;
  rejectedVcf: number;
  rejectedDup: number;
  emitted: number;
}

function sampleGame(
  wasm: WasmModuleContext,
  game: BenchGame,
  file: string,
  gameIdx: number,
  opts: {
    minPly: number;
    endMargin: number;
    sampleInterval: number;
    maxPerGame: number;
  },
  seen: Set<string>,
  stats: FilterStats,
  emit: (row: CorpusRow) => void,
): void {
  const len = game.moveHistory.length;
  const maxPly = len - opts.endMargin;
  const board: BoardState = createEmptyBoard();
  const blackStones: Position[] = [];
  const whiteStones: Position[] = [];

  let winnerColor: StoneColor | null = null;
  if (game.winner !== "draw") {
    winnerColor = (game.winner === "A") === game.isABlack ? "black" : "white";
  }

  let sampled = 0;
  let lastSampledPly = -Infinity;

  for (let ply = 0; ply < len; ply++) {
    // ply 手置かれた状態（= moveHistory[ply] を置く直前）を検討する。
    if (
      ply >= opts.minPly &&
      ply <= maxPly &&
      sampled < opts.maxPerGame &&
      ply - lastSampledPly >= opts.sampleInterval
    ) {
      const stm: "black" | "white" = ply % 2 === 0 ? "black" : "white";
      const opp: "black" | "white" = stm === "black" ? "white" : "black";
      stats.candidates++;

      const key = boardKey(board, stm);
      if (seen.has(key)) {
        stats.rejectedDup++;
      } else if (hasImmediateFive(board, stm)) {
        stats.rejectedFiveStm++;
      } else if (hasImmediateFive(board, opp)) {
        stats.rejectedFiveOpp++;
      } else if (
        // timeLimit はノード予算より十分大きくし、実質 maxNodes=200 のみで
        // 打ち切る（wall-clock 打ち切りが混じるとマシン速度でコーパスが
        // 変わる＝非決定になるため。perf レビュー指摘対応）。
        hasVCF(board, stm, 0, undefined, { maxNodes: 200, timeLimit: 10000 })
      ) {
        stats.rejectedVcf++;
      } else {
        seen.add(key);
        let outcome = 0.5;
        if (winnerColor !== null) {
          outcome = winnerColor === stm ? 1 : 0;
        }
        emit({
          key,
          source: { file, gameIdx, ply, jushu: game.jushuName },
          stm,
          black: [...blackStones],
          white: [...whiteStones],
          features: extractFeatures(wasm, board, stm),
          outcome,
        });
        stats.emitted++;
        sampled++;
        lastSampledPly = ply;
      }
    }

    const move = game.moveHistory[ply]!;
    const color: StoneColor = ply % 2 === 0 ? "black" : "white";
    board[move.row]![move.col] = color;
    (color === "black" ? blackStones : whiteStones).push({
      row: move.row,
      col: move.col,
    });
  }
}

async function main(): Promise<void> {
  const inputDir = parseStringArg("input");
  const outPath =
    parseStringArg("out") ?? "bench-results/prospect-corpus.jsonl";
  if (!inputDir) {
    console.error(
      "使い方: prospect-corpus.ts --input=<commit-bench-*.json のあるディレクトリ> [--out=...]",
    );
    process.exit(1);
  }
  const opts = {
    minPly: parseArg("min-ply", 8),
    endMargin: parseArg("end-margin", 4),
    sampleInterval: parseArg("sample-interval", 2),
    maxPerGame: parseArg("max-per-game", 12),
  };
  const maxGames = parseArg("max-games", Infinity);

  const wasm = await loadWasmModule();
  // hasVCF（quiet フィルタ）が threat/forbidden wasm を要求する
  await preloadThreatWasm();
  await preloadForbiddenWasm();

  const files = readdirSync(inputDir)
    .filter((f) => f.startsWith("commit-bench-") && f.endsWith(".json"))
    .sort();
  console.log(`入力: ${files.length} ファイル（${inputDir}）`);

  const seen = new Set<string>();
  const stats: FilterStats = {
    candidates: 0,
    rejectedFiveStm: 0,
    rejectedFiveOpp: 0,
    rejectedVcf: 0,
    rejectedDup: 0,
    emitted: 0,
  };
  const lines: string[] = [];
  let gameCount = 0;

  for (const file of files) {
    const data = JSON.parse(readFileSync(join(inputDir, file), "utf8")) as {
      games: BenchGame[];
    };
    for (let gameIdx = 0; gameIdx < data.games.length; gameIdx++) {
      if (gameCount >= maxGames) {
        break;
      }
      sampleGame(
        wasm,
        data.games[gameIdx]!,
        file,
        gameIdx,
        opts,
        seen,
        stats,
        (row) => lines.push(JSON.stringify(row)),
      );
      gameCount++;
    }
    console.log(`  ${file}: 累計 ${stats.emitted} 局面`);
  }

  writeFileSync(outPath, `${lines.join("\n")}\n`);
  console.log(
    `\n完了: ${gameCount} 局中 candidates=${stats.candidates} → emitted=${stats.emitted}` +
      `（dup=${stats.rejectedDup}, 即五stm=${stats.rejectedFiveStm}, ` +
      `即五opp=${stats.rejectedFiveOpp}, vcf=${stats.rejectedVcf}）`,
  );
  console.log(`出力: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
