#!/usr/bin/env node
/**
 * ゲート1（opening-book-2026-07-16.md §5-1）検証CLI。
 *
 * severity-A トラップレコード（trap-mining.ts --out の JSONL）を読み込み、
 * 序盤定石ブック（src/assets/opening-book-hard.json）有効時に、記録された
 * 黒の攻め手順が強制勝ちを再現しないことを検証する。ランダム候補
 * （randomPool）は1つを乱数選択せず、全件を決定的に列挙してそれぞれ検証する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/verify-book-blocks-traps.ts --records=bench-results/opening-traps-run2.jsonl
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  getBookMoveCandidates,
  setOpeningBookAsset,
  type OpeningBookAsset,
} from "@/logic/cpu/openingBook";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";
import { formatMove } from "@/logic/gameRecordParser";

import { checkForcedWinAfterMove } from "./lib/forcedWinCheck";
import {
  verifyRecordBlocked,
  type BookLookup,
  type ForcedWinChecker,
  type TrapRecordForVerify,
} from "./lib/verifyBookBlocksTraps";

interface TrapMiningRecordFile {
  canonicalKeyPly8: string;
  route: string;
  moves: string[];
  severity: "A";
  forcedWinKind: "VCF" | "VCT";
}

function parseArgs(): { recordsPath: string; bookPath: string } {
  const args = process.argv.slice(2);
  let recordsPath: string | null = null;
  let bookPath = "src/assets/opening-book-hard.json";
  for (const arg of args) {
    if (arg.startsWith("--records=")) {
      recordsPath = arg.slice("--records=".length);
    } else if (arg.startsWith("--book=")) {
      bookPath = arg.slice("--book=".length);
    }
  }
  if (!recordsPath) {
    throw new Error(
      "--records=<path> は必須です（trap-mining.ts --out の severity-A JSONL）",
    );
  }
  return { recordsPath, bookPath };
}

async function main(): Promise<void> {
  const { recordsPath, bookPath } = parseArgs();

  console.log("========================================");
  console.log(" ゲート1: ブックによるトラップ封鎖検証");
  console.log("========================================");
  console.log(`records: ${recordsPath}`);
  console.log(`book:    ${bookPath}`);

  const lines = readFileSync(recordsPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const records = lines.map((line) => JSON.parse(line) as TrapMiningRecordFile);
  console.log(`レコード数: ${records.length}`);

  const bookAsset = JSON.parse(
    readFileSync(path.resolve(bookPath), "utf-8"),
  ) as OpeningBookAsset;
  setOpeningBookAsset(bookAsset);
  console.log(`ブックエントリ数: ${Object.keys(bookAsset.entries).length}`);

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  const book: BookLookup = {
    candidateMoves(board) {
      const candidates = getBookMoveCandidates(board, "white");
      return candidates ? candidates.map(formatMove) : null;
    },
  };
  const checker: ForcedWinChecker = {
    check(board, sideToMove, move) {
      return checkForcedWinAfterMove(engine, board, sideToMove, move)
        .forcedWinKind;
    },
  };

  let passCount = 0;
  let failCount = 0;
  const failures: {
    route: string;
    canonicalKeyPly8: string;
    branches: unknown;
  }[] = [];

  for (const record of records) {
    const verifyRecord: TrapRecordForVerify = {
      route: record.route,
      canonicalKeyPly8: record.canonicalKeyPly8,
      moves: record.moves,
    };
    const result = verifyRecordBlocked(verifyRecord, book, checker);
    if (result.blocked) {
      passCount++;
    } else {
      failCount++;
      failures.push({
        route: result.route,
        canonicalKeyPly8: result.canonicalKeyPly8,
        branches: result.branches.filter((b) => !b.blocked),
      });
    }
  }

  console.log("");
  console.log(`PASS: ${passCount} / ${records.length}`);
  console.log(`FAIL: ${failCount} / ${records.length}`);
  if (failures.length > 0) {
    console.log("");
    console.log("── 失敗レコード ──────────────────────");
    for (const f of failures) {
      console.log(JSON.stringify(f));
    }
  }
  console.log("========================================");

  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
