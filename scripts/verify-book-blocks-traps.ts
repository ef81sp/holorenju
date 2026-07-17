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
 *
 *   # 黒番severity-Aレコードも合わせて検証する
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/verify-book-blocks-traps.ts --records=bench-results/opening-traps-run2.jsonl \
 *     --black-records=bench-results/opening-traps-black-run1.jsonl
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
  verifyBlackRecordBlocked,
  verifyRecordBlocked,
  type BlackTrapRecordForVerify,
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

interface BlackTrapMiningRecordFile {
  canonicalKeyBeforeBlack7: string;
  route: string;
  moves: string[];
  severity: "A";
  forcedWinKind: "VCF" | "VCT";
}

function parseArgs(): {
  recordsPath: string;
  bookPath: string;
  blackRecordsPath: string | null;
} {
  const args = process.argv.slice(2);
  let recordsPath: string | null = null;
  let bookPath = "src/assets/opening-book-hard.json";
  let blackRecordsPath: string | null = null;
  for (const arg of args) {
    if (arg.startsWith("--records=")) {
      recordsPath = arg.slice("--records=".length);
    } else if (arg.startsWith("--book=")) {
      bookPath = arg.slice("--book=".length);
    } else if (arg.startsWith("--black-records=")) {
      blackRecordsPath = arg.slice("--black-records=".length);
    }
  }
  if (!recordsPath) {
    throw new Error(
      "--records=<path> は必須です（trap-mining.ts --out の severity-A JSONL）",
    );
  }
  return { recordsPath, bookPath, blackRecordsPath };
}

async function main(): Promise<void> {
  const { recordsPath, bookPath, blackRecordsPath } = parseArgs();

  console.log("========================================");
  console.log(" ゲート1: ブックによるトラップ封鎖検証");
  console.log("========================================");
  console.log(`records: ${recordsPath}`);
  console.log(`book:    ${bookPath}`);
  if (blackRecordsPath) {
    console.log(`black-records: ${blackRecordsPath}`);
  }

  const lines = readFileSync(recordsPath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const records = lines.map((line) => JSON.parse(line) as TrapMiningRecordFile);
  console.log(`レコード数（白）: ${records.length}`);

  const blackRecords = blackRecordsPath
    ? readFileSync(blackRecordsPath, "utf-8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as BlackTrapMiningRecordFile)
    : [];
  if (blackRecordsPath) {
    console.log(`レコード数（黒）: ${blackRecords.length}`);
  }

  const bookAsset = JSON.parse(
    readFileSync(path.resolve(bookPath), "utf-8"),
  ) as OpeningBookAsset;
  setOpeningBookAsset(bookAsset);
  console.log(`ブックエントリ数: ${Object.keys(bookAsset.entries).length}`);

  await Promise.all([preloadThreatWasm(), preloadForbiddenWasm()]);
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  const book: BookLookup = {
    candidateMoves(board, color) {
      const candidates = getBookMoveCandidates(board, color);
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
    color: "white" | "black";
    route: string;
    canonicalKey: string;
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
        color: "white",
        route: result.route,
        canonicalKey: result.canonicalKeyPly8,
        branches: result.branches.filter((b) => !b.blocked),
      });
    }
  }

  for (const record of blackRecords) {
    const verifyRecord: BlackTrapRecordForVerify = {
      route: record.route,
      canonicalKeyBeforeBlack7: record.canonicalKeyBeforeBlack7,
      moves: record.moves,
    };
    const result = verifyBlackRecordBlocked(verifyRecord, book, checker);
    if (result.blocked) {
      passCount++;
    } else {
      failCount++;
      failures.push({
        color: "black",
        route: result.route,
        canonicalKey: result.canonicalKeyBeforeBlack7,
        branches: result.branches.filter((b) => !b.blocked),
      });
    }
  }

  const totalRecords = records.length + blackRecords.length;
  console.log("");
  console.log(`PASS: ${passCount} / ${totalRecords}`);
  console.log(`FAIL: ${failCount} / ${totalRecords}`);
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
