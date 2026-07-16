#!/usr/bin/env node
/**
 * 彗星ルート個別対応（opening-book-2026-07-16.md §4）。
 *
 * --dump-book の権威ダンプから彗星型 ply8 ノード（forcedWinKind有り・
 * survivorMoves 空配列 = 生存手ゼロ）を特定し、その1つ前の白手番（white6）まで
 * 遡って代替候補（PRECISE 上位4〜5、実選択を除く）を試す。各代替 white6 について、
 * 配下の黒7（攻め側フィルタ ≤20本）× white8 チェック（checkForcedWin + 生存手導出）
 * を実行し、「配下に生存手ゼロの ply8（彗星）を持たない white6」を探す。
 *
 * 見つかった場合は build-opening-book.ts --patch で読み込める JSONL を出力する。
 * 全代替候補がダメだった場合は、その旨をログに出すだけで patch は出力しない
 * （「黒必勝級の可能性」としてボス報告が必要）。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/comet-mini-mining.ts --dump=bench-results/opening-book-dump.jsonl \
 *     --out=bench-results/comet-patch.jsonl
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { BoardState } from "@/types/game";

import { canonicalKey } from "@/logic/boardSymmetry";
import { applyMove } from "@/logic/cpu/core/boardUtils";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import {
  createBoardFromRecord,
  formatMove,
  parseMove,
} from "@/logic/gameRecordParser";

import type { OpeningBookPatchEntry } from "./lib/buildOpeningBook";

import { checkForcedWin } from "./lib/forcedWinCheck";
import {
  candidateRankingPrecise,
  findSurvivorMoves,
} from "./lib/survivorMoves";
import { selectAttackerMoves } from "./lib/trapFilters";
import { candidateRanking, type BookDumpNode } from "./lib/trapPipeline";

// ─── CLI 引数 ──────────────────────────────────────────

interface CliOptions {
  dumpPath: string;
  outPath: string;
  /** white6 代替候補の試行数（PRECISE上位、実選択を除く）。 */
  white6AltCount: number;
  /** 黒7 攻め側フィルタの出力上限（trap-mining.ts の b7 既定値と揃える）。 */
  black7Budget: number;
  randomSeed: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dumpPath: "bench-results/opening-book-dump.jsonl",
    outPath: "bench-results/comet-patch.jsonl",
    white6AltCount: 5,
    black7Budget: 20,
    randomSeed: 20260716,
  };
  for (const arg of args) {
    if (arg.startsWith("--dump=")) {
      opts.dumpPath = arg.slice("--dump=".length);
    } else if (arg.startsWith("--out=")) {
      opts.outPath = arg.slice("--out=".length);
    } else if (arg.startsWith("--white6-alt=")) {
      opts.white6AltCount = parseInt(arg.slice("--white6-alt=".length), 10);
    } else if (arg.startsWith("--b7=")) {
      opts.black7Budget = parseInt(arg.slice("--b7=".length), 10);
    } else if (arg.startsWith("--seed=")) {
      opts.randomSeed = parseInt(arg.slice("--seed=".length), 10);
    }
  }
  return opts;
}

// ─── ダンプ読み込み ─────────────────────────────────────

interface DumpFile {
  nodes: BookDumpNode[];
}

function readDumpNodes(dumpPath: string): DumpFile {
  const lines = readFileSync(dumpPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  // 先頭行はメタデータ（type:"metadata"）。BookDumpNode には type フィールドが
  // 無いため、"type" キーを持つ行を除外して判別する。
  const nodes = lines
    .map((line) => JSON.parse(line) as BookDumpNode & { type?: string })
    .filter((n) => n.type === undefined) as BookDumpNode[];
  return { nodes };
}

function isCometNode(node: BookDumpNode): boolean {
  return (
    node.ply === 8 &&
    node.forcedWinKind !== null &&
    (node.survivorMoves?.length ?? -1) === 0
  );
}

// ─── ミニ採掘本体 ──────────────────────────────────────

interface SubtreeCheckEntry {
  black7: string;
  status: "safe-no-forced-win" | "safe-has-survivors";
  forcedWinKind?: "VCF" | "VCT";
  survivorCount?: number;
}

/**
 * 1つの white6 代替候補について、配下（攻め側フィルタで絞った黒7 × white8）に
 * 彗星（生存手ゼロの forced win）が無いか調べる。見つかり次第（安全と判明した
 * 分岐だけを積み上げるか、彗星が見つかった時点で）早期終了する。
 */
function checkWhite6Alternative(
  engine: WasmSearchEngine,
  boardAfterWhite6Alt: BoardState,
  black7Budget: number,
  randomSeed: number,
): { hasComet: boolean; checked: SubtreeCheckEntry[] } {
  const black7Candidates0 = candidateRanking(
    engine,
    boardAfterWhite6Alt,
    "black",
  );
  const black7Selected = selectAttackerMoves({
    board: boardAfterWhite6Alt,
    color: "black",
    candidates: black7Candidates0,
    topK: black7Budget,
    maxTotal: black7Budget,
    randomSlotCount: Math.max(1, Math.round(black7Budget * 0.25)),
    randomSeed,
  });

  const checked: SubtreeCheckEntry[] = [];
  for (const b7 of black7Selected) {
    const boardAfterBlack7 = applyMove(
      boardAfterWhite6Alt,
      b7.position,
      "black",
    );
    const fw = checkForcedWin(engine, boardAfterBlack7, "white");
    const black7Str = formatMove(b7.position);

    if (fw.forcedWinKind === null) {
      checked.push({ black7: black7Str, status: "safe-no-forced-win" });
      continue;
    }

    const survivors = findSurvivorMoves(
      engine,
      boardAfterBlack7,
      "white",
      fw.chosenMove,
    );
    if (survivors.survivors.length === 0) {
      // 彗星: このwhite6代替は不合格。即座に打ち切る。
      return { hasComet: true, checked };
    }
    checked.push({
      black7: black7Str,
      status: "safe-has-survivors",
      forcedWinKind: fw.forcedWinKind,
      survivorCount: survivors.survivors.length,
    });
  }

  return { hasComet: false, checked };
}

// ─── メイン ────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  console.log("========================================");
  console.log(" 彗星ルート個別対応: white6 差し替えミニ採掘");
  console.log("========================================");
  console.log(`dump: ${opts.dumpPath}`);
  console.log(`out:  ${opts.outPath}`);

  const { nodes } = readDumpNodes(opts.dumpPath);
  const comets = nodes.filter(isCometNode);
  console.log(`彗星型ノード: ${comets.length}件`);
  for (const c of comets) {
    console.log(
      `  route=${c.route} moves=${c.movesUpToHere.join(" ")} hardMove(ply8)=${c.hardMove}`,
    );
  }

  if (comets.length === 0) {
    console.log("彗星型ノードなし。何もしません。");
    return;
  }

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  const patches: OpeningBookPatchEntry[] = [];
  const unresolved: BookDumpNode[] = [];

  for (const comet of comets) {
    console.log("");
    console.log(`=== 彗星ノード対応: route=${comet.route} ===`);
    console.log(`手順（黒1..黒7）: ${comet.movesUpToHere.join(" ")}`);

    if (comet.movesUpToHere.length !== 7) {
      console.log(
        `  警告: movesUpToHere が7手ではありません（${comet.movesUpToHere.length}手）。` +
          `white6を特定できないためスキップします。`,
      );
      unresolved.push(comet);
      continue;
    }

    const movesUpToBlack5 = comet.movesUpToHere.slice(0, 5);
    const recordedWhite6Str = comet.movesUpToHere[5]!;
    const { board: boardAfterBlack5 } = createBoardFromRecord(
      movesUpToBlack5.join(" "),
    );

    const recordedWhite6 = parseMove(recordedWhite6Str);
    const white6Ranked = candidateRankingPrecise(
      engine,
      boardAfterBlack5,
      "white",
    );
    const altWhite6 = white6Ranked
      .filter(
        (p) => !(p.row === recordedWhite6.row && p.col === recordedWhite6.col),
      )
      .slice(0, opts.white6AltCount);

    console.log(
      `white6代替候補（実選択 ${recordedWhite6Str} を除く）: ${altWhite6.map(formatMove).join(", ")}`,
    );

    let solved = false;
    for (const alt of altWhite6) {
      const altStr = formatMove(alt);
      console.log(`  試行: white6=${altStr} ...`);
      const boardAfterWhite6Alt = applyMove(boardAfterBlack5, alt, "white");

      const { hasComet, checked } = checkWhite6Alternative(
        engine,
        boardAfterWhite6Alt,
        opts.black7Budget,
        opts.randomSeed,
      );

      if (hasComet) {
        console.log(`    ✗ 配下に彗星あり（黒7=${checked.at(-1)?.black7}）`);
        continue;
      }

      console.log(`    ✓ 配下に彗星なし（検証${checked.length}件）→ 採用`);
      patches.push({
        type: "patch",
        canonicalKey: canonicalKey(boardAfterBlack5, "white"),
        route: comet.route,
        movesUpToHere: movesUpToBlack5,
        replacementMove: altStr,
        reason: `彗星型ply8ノード（${comet.hardMove}選択時にVCF/VCT+生存手ゼロ）の回避（white6差し替え）`,
        verifiedSubtree: checked,
      });
      solved = true;
      break;
    }

    if (!solved) {
      console.log(
        `  白6の全代替候補（${altWhite6.length}件）で彗星が残存 → 黒必勝級の可能性`,
      );
      unresolved.push(comet);
    }
  }

  console.log("");
  console.log("========================================");
  console.log(
    ` 結果: 解決 ${patches.length}件 / 未解決 ${unresolved.length}件`,
  );
  console.log("========================================");

  if (patches.length > 0) {
    mkdirSync(path.dirname(opts.outPath), { recursive: true });
    const lines = patches.map((p) => JSON.stringify(p));
    writeFileSync(opts.outPath, `${lines.join("\n")}\n`);
    console.log(`patch を ${opts.outPath} に出力しました`);
  }

  if (unresolved.length > 0) {
    console.log("");
    console.log("── 未解決（黒必勝級の可能性・ボス報告用） ──────────");
    for (const u of unresolved) {
      console.log(
        `  route=${u.route} moves=${u.movesUpToHere.join(" ")} ` +
          `forcedWinKind=${u.forcedWinKind} sequence=${u.forcedWinSequenceStr}`,
      );
    }
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
