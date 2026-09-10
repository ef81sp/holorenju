/**
 * prospect コーパス抽出: ベンチ棋譜・オープニングブック・開局スイート prefix から
 * quiet 局面をサンプルし、空点プロスペクト特徴ベクトル（i32×34）と勝敗ラベルを
 * JSONL に dump する（docs/plans/eval-r4-2026-09-11.md §1〜§2。quiet フィルタは
 * prospect-texel-p3-2026-07-15.md の事前登録定義と同じ）。
 *
 * 3 源（処理順もこの順。dedup は源横断なので、重複局面は先に処理した源に帰属する）:
 *   1. 棋譜（kifu）: `--input=<dir>` の `commit-bench-*.json` / `weight-bench-*.json`
 *      （`{games:[...]}` 形・トップレベル配列形の両方。`valid:false` の run は除外）。
 *      グループキー = file#gameIdx（同一対局の局面は同じ fold）。
 *   2. ブック（book）: `--book=<json>` の entries（白番 ply 3/5/7。`--min-ply` を石数に適用）。
 *   3. 序盤 prefix（prefix）: `--suite-prefix=<json,...>` の各開局 moves を
 *      `--prefix-plies` の各 n 手で切った局面（黒番 n 偶数 / 白番 n 奇数）。
 *      plies が明示指定なので `--min-ply` は適用しない。
 *   dedup と回帰除外は canonical key（8 対称の最小）で照合する。
 *   book / prefix は 1 局面 1 グループ、outcome 0.5 固定（ラベルは Rapfi 評価）。
 *
 * 回帰ゲート局面（scripts/lib/regressionPositions.ts）は再生して得た key を
 * 除外集合に事前投入し、出力から除く（stats の rejectedRegression）。
 *
 * Rapfi 評価値ラベルは別スクリプト（scripts/rapfi/labelCorpus.ts、gitignore 対象の
 * ローカル運用）が本出力の JSONL に付与する。各行に black/white の石リストを含める
 * （ラベラー側で盤面再構築不要）。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/prospect-corpus.ts --input=bench-results \
 *     --book=src/assets/opening-book-hard.json \
 *     --suite-prefix=scripts/data/opening-suite-v1.json,scripts/data/opening-suite-v2.json \
 *     --prefix-plies=4,5,6 --min-ply=4 --sample-interval=1 --max-per-game=24
 *
 * オプション:
 *   --input=<dir>            棋譜 JSON のディレクトリ
 *   --limit-files=<n>        棋譜ファイルを名前順の先頭 n 本に絞る（スモーク用）
 *   --max-games=<n>          棋譜の局数上限
 *   --book=<json>            オープニングブック JSON
 *   --suite-prefix=<a,b,..>  開局スイート JSON（カンマ区切り）
 *   --prefix-plies=<a,b,..>  prefix の手数（既定 4,5,6）
 *   --out=<jsonl>            既定 bench-results/corpus/prospect-corpus.jsonl
 *   --min-ply=<n>            候補にする最小手数/石数（既定 8）
 *   --end-margin=<n>         終局からこの手数以内は候補にしない（既定 4）
 *   --sample-interval=<n>    1 局内のサンプル間隔（既定 2）
 *   --max-per-game=<n>       1 局あたりの上限（既定 12）
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import type { OpeningBookAsset } from "@/logic/cpu/openingBook";

import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatLoader";

import type { CorpusSourceKind } from "./types/prospectCorpus.ts";

import { loadOpeningSuite } from "./lib/openingSuiteLoader.ts";
import {
  createFilterStats,
  createRowTable,
  formatRowTable,
  type GameSampleOptions,
  type QuietEmitContext,
  readBenchGames,
  regressionPositionKeys,
  sampleBook,
  sampleGame,
  samplePrefix,
  tallyRow,
} from "./lib/prospectCorpus.ts";

const DEFAULT_OUT = "bench-results/corpus/prospect-corpus.jsonl";
const INPUT_PREFIXES = ["commit-bench-", "weight-bench-"] as const;

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? Number.parseInt(raw.slice(name.length + 3), 10) : fallback;
}

function parseStringArg(name: string): string | undefined {
  return process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

function parseListArg(name: string): string[] {
  const raw = parseStringArg(name);
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parsePlies(raw: string[]): number[] {
  const plies = raw.map((s) => Number.parseInt(s, 10));
  if (plies.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new Error(`--prefix-plies が不正: ${raw.join(",")}`);
  }
  return plies;
}

function listKifuFiles(inputDir: string, limit: number): string[] {
  const files = readdirSync(inputDir)
    .filter(
      (f) => INPUT_PREFIXES.some((p) => f.startsWith(p)) && f.endsWith(".json"),
    )
    .sort();
  return Number.isFinite(limit) ? files.slice(0, limit) : files;
}

function readBookKeys(bookPath: string): string[] {
  const asset = JSON.parse(
    readFileSync(bookPath, "utf8"),
  ) as Partial<OpeningBookAsset>;
  const { entries } = asset;
  if (
    typeof entries !== "object" ||
    entries === null ||
    Array.isArray(entries)
  ) {
    throw new Error(`${bookPath}: entries がオブジェクトでない`);
  }
  return Object.keys(entries);
}

function usage(): never {
  console.error(
    "使い方: prospect-corpus.ts [--input=<dir>] [--book=<json>] [--suite-prefix=<json,...>] [--out=...]\n" +
      "  --input / --book / --suite-prefix のいずれか 1 つ以上が必要",
  );
  return process.exit(1);
}

async function main(): Promise<void> {
  const inputDir = parseStringArg("input");
  const bookPath = parseStringArg("book");
  const suitePaths = parseListArg("suite-prefix");
  if (!inputDir && !bookPath && suitePaths.length === 0) {
    usage();
  }
  const outPath = parseStringArg("out") ?? DEFAULT_OUT;
  const opts: GameSampleOptions = {
    minPly: parseArg("min-ply", 8),
    endMargin: parseArg("end-margin", 4),
    sampleInterval: parseArg("sample-interval", 2),
    maxPerGame: parseArg("max-per-game", 12),
  };
  const maxGames = parseArg("max-games", Infinity);
  const limitFiles = parseArg("limit-files", Infinity);
  const prefixPliesRaw = parseListArg("prefix-plies");
  const prefixPlies = parsePlies(
    prefixPliesRaw.length > 0 ? prefixPliesRaw : ["4", "5", "6"],
  );

  console.log("=== prospect コーパス抽出 ===");
  const extra = [
    Number.isFinite(maxGames) ? `maxGames=${maxGames}` : "",
    Number.isFinite(limitFiles) ? `limitFiles=${limitFiles}` : "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");
  console.log(
    `条件: minPly=${opts.minPly} endMargin=${opts.endMargin} sampleInterval=${opts.sampleInterval} maxPerGame=${opts.maxPerGame} ${extra}`.trimEnd(),
  );

  const wasm = await loadWasmModule();
  // hasVCF（quiet フィルタ）が threat/forbidden wasm を要求する
  await preloadThreatWasm();
  await preloadForbiddenWasm();

  const lines: string[] = [];
  const table = createRowTable();
  const emittedByKind: Record<CorpusSourceKind, number> = {
    kifu: 0,
    book: 0,
    prefix: 0,
  };
  const ctx: QuietEmitContext = {
    wasm,
    seen: new Set<string>(),
    excluded: new Set<string>(regressionPositionKeys()),
    stats: createFilterStats(),
    emit: (row) => {
      lines.push(JSON.stringify(row));
      tallyRow(table, row);
      emittedByKind[row.source.kind]++;
    },
  };
  console.log(`回帰ゲート局面 ${ctx.excluded.size} 件を除外集合に投入`);

  // 1. 棋譜
  let gameCount = 0;
  if (inputDir) {
    const files = listKifuFiles(inputDir, limitFiles);
    console.log(`\n棋譜: ${files.length} ファイル（${inputDir}）`);
    for (const file of files) {
      if (gameCount >= maxGames) {
        break;
      }
      const { games, skipped } = readBenchGames(join(inputDir, file));
      if (skipped !== null) {
        console.log(
          `  ${file}: ${skipped === "invalid" ? "valid:false" : "games なし"} としてスキップ`,
        );
        continue;
      }
      let used = 0;
      for (let gameIdx = 0; gameIdx < games.length; gameIdx++) {
        if (gameCount >= maxGames) {
          break;
        }
        sampleGame(ctx, games[gameIdx]!, file, gameIdx, opts);
        gameCount++;
        used++;
      }
      console.log(
        `  ${file}: ${used}/${games.length} 局 → 累計 ${ctx.stats.emitted} 局面`,
      );
    }
  }

  // 2. ブック
  if (bookPath) {
    const keys = readBookKeys(bookPath);
    const emitted = sampleBook(ctx, keys, basename(bookPath), {
      minPly: opts.minPly,
    });
    console.log(
      `\nブック: ${bookPath}（${keys.length} entries）→ ${emitted} 局面`,
    );
  }

  // 3. 開局スイート prefix
  for (const suitePath of suitePaths) {
    const suite = loadOpeningSuite(suitePath, process.cwd());
    const emitted = samplePrefix(
      ctx,
      suite.openings,
      basename(suitePath),
      prefixPlies,
    );
    console.log(
      `\nprefix: ${suitePath}（${suite.count} 開局 × ply ${prefixPlies.join("/")}）→ ${emitted} 局面`,
    );
    if (emitted === 0) {
      console.warn(
        `  警告: ${suitePath} の prefix 行が 0 件（全て dedup/quiet 落ち、または --prefix-plies が開局の手数を超えている）`,
      );
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${lines.join("\n")}\n`);

  const s = ctx.stats;
  console.log(
    `\n完了: 棋譜 ${gameCount} 局 / candidates=${s.candidates} → emitted=${s.emitted}` +
      `（regression=${s.rejectedRegression}, dup=${s.rejectedDup}, 即五stm=${s.rejectedFiveStm}, ` +
      `即五opp=${s.rejectedFiveOpp}, vcf=${s.rejectedVcf}）`,
  );
  console.log(
    `源別: kifu=${emittedByKind.kifu} book=${emittedByKind.book} prefix=${emittedByKind.prefix}`,
  );
  console.log("\n源 kind × ply 帯 × 手番 行数表:");
  console.log(formatRowTable(table));
  console.log(`\n出力: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
