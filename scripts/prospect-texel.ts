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
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/prospect-texel.ts --in=bench-results/prospect-corpus-labeled.jsonl \
 *     --k=5 --teacher=both --K=200
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";

import { loadWasmModule } from "@/logic/cpu/wasm/loader";

import {
  fitLogistic,
  type FitLogisticResult,
  groupKFold,
  meanSquaredLoss,
  rapfiTeacherLabel,
} from "./lib/texelFit.ts";

/** prospect id 空間のオフセット（main.zig の PROSPECT_PARAM_ID_BASE と一致）。 */
const PROSPECT_PARAM_ID_BASE = 100;
const FEATURE_COUNT = 34;

type Teacher = "rapfi" | "outcome";
type TeacherArg = Teacher | "both";

interface CorpusRow {
  key: string;
  source: { file: string; gameIdx: number; ply: number; jushu: string };
  stm: "black" | "white";
  features: number[];
  outcome: number;
  rapfiEval?: number;
  /** ラベラー側の破棄行マーカー（存在すれば学習対象から除外）。 */
  dropped?: string;
}

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

/** JSONL を読み込み、破棄行（dropped フィールド持ち）を除いて返す。 */
function readCorpus(path: string): CorpusRow[] {
  const text = readFileSync(path, "utf8");
  const rows: CorpusRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const row = JSON.parse(trimmed) as CorpusRow;
    if (row.dropped !== undefined) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

/** wasm メモリ上の null 終端文字列（[*:0]const u8）を読む。 */
function readCString(wasm: WasmModuleContext, ptr: number): string {
  const bytes = new Uint8Array(wasm.memory.buffer);
  let end = ptr;
  while (bytes[end] !== 0) {
    end++;
  }
  return new TextDecoder().decode(bytes.subarray(ptr, end));
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
  };
}

interface FoldResult {
  fold: number;
  trainCount: number;
  valCount: number;
  trainLoss: number;
  valLoss: number;
}

function runKFold(dataset: Dataset, k: number, K: number): FoldResult[] {
  const folds = groupKFold(dataset.groups, k);
  return folds.map((fold, i) => {
    const trainX = fold.train.map((idx) => dataset.X[idx]!);
    const trainY = fold.train.map((idx) => dataset.labels[idx]!);
    const valX = fold.val.map((idx) => dataset.X[idx]!);
    const valY = fold.val.map((idx) => dataset.labels[idx]!);
    const fit = fitLogistic(trainX, trainY, K);
    return {
      fold: i,
      trainCount: trainX.length,
      valCount: valX.length,
      trainLoss: fit.trainLoss,
      valLoss: meanSquaredLoss(valX, valY, fit.weights, K),
    };
  });
}

interface TeacherReport {
  rowCount: number;
  baselineLoss: number;
  kfold: {
    k: number;
    folds: FoldResult[];
    avgTrainLoss: number;
    avgValLoss: number;
  } | null;
  finalFit: FitLogisticResult;
  finalVsBaseline: "改善" | "非改善";
}

function runTeacher(
  rows: CorpusRow[],
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
    const folds = runKFold(dataset, effectiveK, K);
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
    kfold = { k: effectiveK, folds, avgTrainLoss, avgValLoss };
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

  return {
    rowCount: dataset.X.length,
    baselineLoss,
    kfold,
    finalFit,
    finalVsBaseline,
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

  console.log("=== P3-c: Texel 回帰 ===");
  console.log(`条件: in=${inPath}, k=${k}, teacher=${teacherArg}, K=${K}`);

  const wasm = await loadWasmModule();
  const weightNames = getWeightNames(wasm);
  const baselineWeights = getBaselineWeights(wasm);

  const rows = readCorpus(inPath);
  console.log(`読み込み: ${rows.length} 局面（破棄行を除く）`);

  const teacherReports: Partial<Record<Teacher, TeacherReport>> = {};
  for (const teacher of teachers) {
    teacherReports[teacher] = runTeacher(rows, teacher, k, K, baselineWeights);
  }

  mkdirSync("bench-results", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `bench-results/texel-fit-${timestamp}.json`;
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        condition: { inPath, k, teacher: teacherArg, K, rowCount: rows.length },
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
