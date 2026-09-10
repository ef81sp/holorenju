/**
 * P3-c: Texel 流ロジスティック回帰 CLI。
 *
 * 空点プロスペクト基底の重み（カテゴリ17×手番2 = 34個）を、
 * scripts/prospect-corpus.ts が出力した quiet フィルタ済み局面
 * （+ 別スクリプトが付与した Rapfi ラベル）へのロジスティック回帰で決める。
 * docs/plans/eval-basis-prospect-2026-07-13.md §4、
 * docs/plans/prospect-texel-p3-2026-07-15.md（P3-c）に対応する。
 *
 * 教師ごとに group k-fold（対局単位、局面リーク防止）で過学習をチェックし、
 * 最後に全データで最終 fit する。現行 PROSPECT_SCORE_DEFAULT（wasm から
 * 実行時取得）の損失も同じデータで計算し、回帰が手調整より良いかを
 * その場で判定できるようにする。
 *
 * 入力 JSONL の各行は "dropped" フィールドを持つ場合があり（ラベラー側の破棄行）、
 * これはスキップする。rapfiEval を欠く行は --teacher=rapfi の学習対象から除外する
 * （--teacher=outcome / both の outcome 側では引き続き使う）。
 *
 * 源 kind（source.kind = kifu|book|prefix）の選別と、fold 平均 val 損失の
 * 源 kind × 月（kifu はファイル名の YYYY-MM）集計（eval-r4-2026-09-11.md §3 (i) / §4）:
 *   --include-source=<kind[,kind]>  指定 kind の行だけを使う
 *   --exclude-source=<kind[,kind]>  指定 kind の行を除く（include の後に適用）
 *   セグメント集計は kfold.segments として JSON にも保存する（既存キーは不変）。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/prospect-texel.ts --in=bench-results/corpus/prospect-corpus-labeled.jsonl \
 *     --k=5 --teacher=both --K=200 [--include-source=kifu] [--exclude-source=book]
 */

import { mkdirSync, writeFileSync } from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";

import { loadWasmModule } from "@/logic/cpu/wasm/loader";

import type { CorpusRow } from "./types/prospectCorpus.ts";

import {
  PROSPECT_FEATURE_COUNT,
  PROSPECT_PARAM_ID_BASE,
} from "./lib/evalParams.ts";
import {
  filterRowsBySelector,
  formatHoldoutLoss,
  formatSegmentLoss,
  type HoldoutSegmentSummary,
  matchesSelector,
  parseSelectorList,
  readCorpusRows,
  segmentKey,
  type SegmentLossSummary,
  summarizeHoldoutLoss,
  summarizeSegmentLoss,
} from "./lib/prospectCorpusRows.ts";
import {
  fitLogistic,
  type FitLogisticResult,
  groupKFold,
  meanSquaredLoss,
  rapfiTeacherLabel,
} from "./lib/texelFit.ts";
import { readCString } from "./lib/wasmCString.ts";

const FEATURE_COUNT = PROSPECT_FEATURE_COUNT;

type Teacher = "rapfi" | "outcome";
type TeacherArg = Teacher | "both";

function parseStringArg(name: string): string | undefined {
  return process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
}

function parseIntArg(name: string, fallback: number): number {
  const raw = parseStringArg(name);
  return raw === undefined ? fallback : Number.parseInt(raw, 10);
}

function parseTeacherArg(): TeacherArg {
  const raw = parseStringArg("teacher") ?? "both";
  if (raw === "rapfi" || raw === "outcome" || raw === "both") {
    return raw;
  }
  console.error(
    `不明な --teacher 値: "${raw}"（rapfi|outcome|both のいずれか）`,
  );
  process.exit(1);
}

/** prospect id (100..133) の正準名34個を取得する（getEvalParamName 経由、SSoT は prospect.zig）。 */
function getWeightNames(wasm: WasmModuleContext): string[] {
  const names: string[] = [];
  for (let i = 0; i < FEATURE_COUNT; i++) {
    names.push(
      readCString(wasm, wasm.getEvalParamName(PROSPECT_PARAM_ID_BASE + i)),
    );
  }
  return names;
}

/** 現行 PROSPECT_SCORE_DEFAULT（wasm 実行時取得、量子化済み手調整重み）。 */
function getBaselineWeights(wasm: WasmModuleContext): number[] {
  const weights: number[] = [];
  for (let i = 0; i < FEATURE_COUNT; i++) {
    weights.push(wasm.getEvalParam(PROSPECT_PARAM_ID_BASE + i));
  }
  return weights;
}

interface Dataset {
  X: number[][];
  labels: number[];
  groups: string[];
  /** 行ごとの源 kind × 月セグメント（診断用集計のキー）。 */
  segments: string[];
}

/** 対局単位のグループキー（同一対局の局面が train/val にまたがらないための groupKFold 入力）。 */
function groupKey(row: CorpusRow): string {
  return `${row.source.file}#${row.source.gameIdx}`;
}

function buildDataset(rows: CorpusRow[], teacher: Teacher, K: number): Dataset {
  const filtered =
    teacher === "rapfi" ? rows.filter((r) => r.rapfiEval !== undefined) : rows;
  return {
    X: filtered.map((r) => r.features),
    labels:
      teacher === "rapfi"
        ? filtered.map((r) => rapfiTeacherLabel(r.rapfiEval!, K))
        : filtered.map((r) => r.outcome),
    groups: filtered.map(groupKey),
    segments: filtered.map((r) => segmentKey(r.source)),
  };
}

interface FoldResult {
  fold: number;
  trainCount: number;
  valCount: number;
  trainLoss: number;
  valLoss: number;
}

interface KFoldRun {
  results: FoldResult[];
  /** fold ごとの fit 重み（セグメント集計用。JSON には出さない） */
  weights: number[][];
  folds: ReturnType<typeof groupKFold>;
}

function runKFold(dataset: Dataset, k: number, K: number): KFoldRun {
  const folds = groupKFold(dataset.groups, k);
  const results: FoldResult[] = [];
  const weights: number[][] = [];
  folds.forEach((fold, i) => {
    const trainX = fold.train.map((idx) => dataset.X[idx]!);
    const trainY = fold.train.map((idx) => dataset.labels[idx]!);
    const valX = fold.val.map((idx) => dataset.X[idx]!);
    const valY = fold.val.map((idx) => dataset.labels[idx]!);
    const fit = fitLogistic(trainX, trainY, K);
    results.push({
      fold: i,
      trainCount: trainX.length,
      valCount: valX.length,
      trainLoss: fit.trainLoss,
      valLoss: meanSquaredLoss(valX, valY, fit.weights, K),
    });
    weights.push(fit.weights);
  });
  return { results, weights, folds };
}

interface TeacherReport {
  rowCount: number;
  baselineLoss: number;
  kfold: {
    k: number;
    folds: FoldResult[];
    avgTrainLoss: number;
    avgValLoss: number;
    /** 源 kind × 月ごとの baseline 損失と fold 平均 val 損失（診断用、追加キー） */
    segments: SegmentLossSummary[];
  } | null;
  finalFit: FitLogisticResult;
  finalVsBaseline: "改善" | "非改善";
  /** holdout 行（学習に使わなかった行）の final fit 重みでのセグメント別損失。holdout 無しなら [] */
  holdout: HoldoutSegmentSummary[];
}

function runTeacher(
  rows: CorpusRow[],
  holdoutRows: CorpusRow[],
  teacher: Teacher,
  requestedK: number,
  K: number,
  baselineWeights: number[],
): TeacherReport {
  const dataset = buildDataset(rows, teacher, K);
  console.log(`\n=== 教師: ${teacher}（${dataset.X.length} 局面） ===`);

  const baselineLoss = meanSquaredLoss(
    dataset.X,
    dataset.labels,
    baselineWeights,
    K,
  );
  console.log(
    `ベースライン（PROSPECT_SCORE_DEFAULT）損失: ${baselineLoss.toFixed(6)}`,
  );

  const uniqueGroupCount = new Set(dataset.groups).size;
  const effectiveK = Math.min(requestedK, uniqueGroupCount);
  let kfold: TeacherReport["kfold"] = null;
  if (effectiveK >= 2) {
    if (effectiveK !== requestedK) {
      console.log(
        `  グループ数(${uniqueGroupCount})が k(${requestedK})未満のため k=${effectiveK} に縮小`,
      );
    }
    const run = runKFold(dataset, effectiveK, K);
    const folds = run.results;
    for (const f of folds) {
      console.log(
        `  fold${f.fold}: train=${f.trainCount}(loss=${f.trainLoss.toFixed(6)}) ` +
          `val=${f.valCount}(loss=${f.valLoss.toFixed(6)})`,
      );
    }
    const avgTrainLoss =
      folds.reduce((s, f) => s + f.trainLoss, 0) / folds.length;
    const avgValLoss = folds.reduce((s, f) => s + f.valLoss, 0) / folds.length;
    console.log(
      `  平均: train=${avgTrainLoss.toFixed(6)} val=${avgValLoss.toFixed(6)}` +
        `（val>>trainなら過学習の兆候）`,
    );
    const segments = summarizeSegmentLoss({
      segments: dataset.segments,
      X: dataset.X,
      labels: dataset.labels,
      folds: run.folds,
      foldWeights: run.weights,
      baselineWeights,
      K,
    });
    console.log(
      "  源 kind × 月 セグメント損失（baseline=全行, val=fold 平均）:",
    );
    console.log(
      formatSegmentLoss(segments)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
    kfold = { k: effectiveK, folds, avgTrainLoss, avgValLoss, segments };
  } else {
    console.log(
      `  グループ数(${uniqueGroupCount})が2未満のため k-fold をスキップ（局面数が少なすぎる）`,
    );
  }

  const finalFit = fitLogistic(dataset.X, dataset.labels, K);
  console.log(
    `全データ最終 fit: trainLoss=${finalFit.trainLoss.toFixed(6)} iterations=${finalFit.iterations}`,
  );
  const finalVsBaseline = finalFit.trainLoss < baselineLoss ? "改善" : "非改善";
  console.log(
    `  vs ベースライン: ${finalVsBaseline}（${baselineLoss.toFixed(6)} → ${finalFit.trainLoss.toFixed(6)}）`,
  );

  const holdoutSet = buildDataset(holdoutRows, teacher, K);
  const holdout = summarizeHoldoutLoss({
    segments: holdoutSet.segments,
    X: holdoutSet.X,
    labels: holdoutSet.labels,
    baselineWeights,
    finalWeights: finalFit.weights,
    K,
  });
  if (holdout.length > 0) {
    console.log(`holdout 評価（${holdoutSet.X.length} 局面、final fit 重み）:`);
    console.log(
      formatHoldoutLoss(holdout)
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
    );
  }

  return {
    rowCount: dataset.X.length,
    baselineLoss,
    kfold,
    finalFit,
    finalVsBaseline,
    holdout,
  };
}

async function main(): Promise<void> {
  const inPath = parseStringArg("in");
  if (!inPath) {
    console.error(
      "使い方: prospect-texel.ts --in=<labeled.jsonl> [--k=5] [--teacher=rapfi|outcome|both] [--K=200]",
    );
    process.exit(1);
  }
  const k = parseIntArg("k", 5);
  const teacherArg = parseTeacherArg();
  const K = parseIntArg("K", 200);
  const teachers: Teacher[] =
    teacherArg === "both" ? ["rapfi", "outcome"] : [teacherArg];
  const includeSource = parseSelectorList(parseStringArg("include-source"));
  const excludeSource = parseSelectorList(parseStringArg("exclude-source"));
  const holdoutTokens = parseSelectorList(parseStringArg("holdout"));

  console.log("=== P3-c: Texel 回帰 ===");
  console.log(
    `条件: in=${inPath}, k=${k}, teacher=${teacherArg}, K=${K}` +
      `, include-source=${includeSource.join(",") || "(全源)"}` +
      `, exclude-source=${excludeSource.join(",") || "(なし)"}` +
      `, holdout=${holdoutTokens.join(",") || "(include/exclude で落とした行)"}`,
  );

  const wasm = await loadWasmModule();
  const weightNames = getWeightNames(wasm);
  const baselineWeights = getBaselineWeights(wasm);

  const allRows: CorpusRow[] = readCorpusRows(inPath);
  const selected = filterRowsBySelector(allRows, includeSource, excludeSource);
  // holdout: 明示トークンがあればそれに該当する行（学習からも除く）。無ければ選別で落ちた行。
  const rows =
    holdoutTokens.length > 0
      ? selected.filter((r) => !matchesSelector(r.source, holdoutTokens))
      : selected;
  const holdoutRows =
    holdoutTokens.length > 0
      ? allRows.filter((r) => matchesSelector(r.source, holdoutTokens))
      : allRows.filter((r) => !selected.includes(r));
  console.log(
    `読み込み: ${allRows.length} 局面（破棄行を除く）→ 学習 ${rows.length} 局面 / holdout ${holdoutRows.length} 局面`,
  );

  const teacherReports: Partial<Record<Teacher, TeacherReport>> = {};
  for (const teacher of teachers) {
    teacherReports[teacher] = runTeacher(
      rows,
      holdoutRows,
      teacher,
      k,
      K,
      baselineWeights,
    );
  }

  mkdirSync("bench-results", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `bench-results/texel-fit-${timestamp}.json`;
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        condition: {
          inPath,
          k,
          teacher: teacherArg,
          K,
          rowCount: rows.length,
          includeSource,
          excludeSource,
          holdout: holdoutTokens,
          holdoutRowCount: holdoutRows.length,
        },
        weightNames,
        baselineWeights,
        teachers: teacherReports,
      },
      null,
      2,
    ),
  );
  console.log(`\n結果を ${outPath} に保存しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
