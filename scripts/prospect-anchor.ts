/**
 * P3-d: スケールアンカリング量子化と重み焼き込み用スクリプト。
 *
 * P3-c の Rapfi 教師回帰重み（`bench-results/texel-fit-*.json` の
 * teachers.rapfi.finalFit.weights）を、コーパス上で legacy 葉評価と分散一致する
 * 係数 s で正規化し、i32 の PROSPECT_SCORE に焼き込むためのスニペットを出力する。
 * 特徴サポート（コーパスでの非ゼロ行数）が閾値未満の重みは回帰値を採用せず、
 * 現行 PROSPECT_SCORE_DEFAULT の値をそのまま維持する（アンカー）。
 *
 * docs/plans/eval-basis-prospect-2026-07-13.md §4.3、
 * docs/plans/prospect-texel-p3-2026-07-15.md（P3-d）に対応する。
 *
 * 使用例:
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs \
 *     scripts/prospect-anchor.ts \
 *     --corpus=bench-results/prospect-corpus-labeled.jsonl \
 *     --fit=bench-results/texel-fit-2026-07-15T00-34-46-965Z.json \
 *     --teacher=rapfi \
 *     --min-support=100 --K=200
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position } from "@/types/game";

import { WasmBoardEvaluator } from "@/logic/cpu/wasm/bridge";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

import { meanSquaredLoss, rapfiTeacherLabel } from "./lib/texelFit.ts";

/** prospect id 空間のオフセット（main.zig の PROSPECT_PARAM_ID_BASE と一致）。 */
const PROSPECT_PARAM_ID_BASE = 100;
const FEATURE_COUNT = 34;
const CAT_COUNT = 17; // CellCat の有効値数（prospect.zig と一致）
const PROSPECT_EVAL_CLAMP = 10000;

/** legacy スケール参照（scores.zig）。P3-d プランのアンカー基準値。 */
const LEAF_FOUR_THREE_THREAT = 2000;
const FOUR_THREE_BONUS = 5000;
const LEGACY_FOUR_THREE_ANCHOR = LEAF_FOUR_THREE_THREAT + FOUR_THREE_BONUS; // 7000

// カテゴリ index（PROSPECT_SCORE_DEFAULT の配列順・prospect.zig の CellCat と一致）
const CAT_INDEX = {
  NONE: 0,
  WEAK: 1,
  SOLO_B2: 2,
  SOLO_F2: 3,
  DOUBLE_F2: 4,
  SOLO_B3: 5,
  B4_F2: 6,
  SOLO_F3: 7,
  F3_F2: 8,
  F3_B3: 9,
  SOLO_B4: 10,
  DOUBLE_THREE_BLACK_RISK: 11,
  DOUBLE_THREE_WHITE: 12,
  FOUR_THREE: 13,
  SOLO_F4: 14,
  DOUBLE_FOUR_WHITE: 15,
  WIN: 16,
} as const;

type Teacher = "rapfi" | "outcome";

interface CorpusRow {
  key: string;
  source: { file: string; gameIdx: number; ply: number; jushu: string };
  stm: "black" | "white";
  black: Position[];
  white: Position[];
  features: number[];
  outcome: number;
  rapfiEval?: number;
  dropped?: string;
}

interface FitFile {
  weightNames: string[];
  baselineWeights: number[];
  teachers: Record<
    string,
    {
      finalFit: { weights: number[]; trainLoss: number; iterations: number };
      baselineLoss: number;
    }
  >;
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

function parseTeacherArg(): Teacher {
  const raw = parseStringArg("teacher") ?? "rapfi";
  if (raw === "rapfi" || raw === "outcome") {
    return raw;
  }
  console.error(`不明な --teacher 値: "${raw}"（rapfi|outcome）`);
  process.exit(1);
}

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

function reconstructBoard(row: CorpusRow): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < 15; r++) {
    board.push(Array<null>(15).fill(null));
  }
  for (const p of row.black) {
    board[p.row]![p.col] = "black";
  }
  for (const p of row.white) {
    board[p.row]![p.col] = "white";
  }
  return board;
}

/** legacy 葉評価（hard 相当）を stm 視点で計算する。 */
function legacyLeafEval(
  evaluator: WasmBoardEvaluator,
  board: BoardState,
  stm: "black" | "white",
): number {
  const hardOpts = DIFFICULTY_PARAMS.hard.evaluationOptions;
  return evaluator.evaluateBoard(board, stm, {
    evalBasis: "legacy",
    // 特徴と同じく stm-to-move 視点（perspective 側が直前に着手していない）。
    lastMoverIsPerspective: false,
    // LeafEvaluationOptions と DIFFICULTY_PARAMS.hard.evaluationOptions の交わり:
    // singleFourPenaltyMultiplier のみ（他の hard フラグは探索側で、葉評価には不関与）。
    singleFourPenaltyMultiplier: hardOpts.singleFourPenaltyMultiplier,
  });
}

/** null 終端文字列を wasm メモリから読む（prospect-texel.ts と同じ）。 */
function readCString(wasm: WasmModuleContext, ptr: number): string {
  const bytes = new Uint8Array(wasm.memory.buffer);
  let end = ptr;
  while (bytes[end] !== 0) {
    end++;
  }
  return new TextDecoder().decode(bytes.subarray(ptr, end));
}

function getWeightNames(wasm: WasmModuleContext): string[] {
  const names: string[] = [];
  for (let i = 0; i < FEATURE_COUNT; i++) {
    names.push(
      readCString(wasm, wasm.getEvalParamName(PROSPECT_PARAM_ID_BASE + i)),
    );
  }
  return names;
}

/** 現行 PROSPECT_SCORE_DEFAULT（wasm 実行時取得）。 */
function getBaselineWeights(wasm: WasmModuleContext): number[] {
  const weights: number[] = [];
  for (let i = 0; i < FEATURE_COUNT; i++) {
    weights.push(wasm.getEvalParam(PROSPECT_PARAM_ID_BASE + i));
  }
  return weights;
}

/** 内積（w · x）— 標準関数として持たないので局所定義。 */
function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) {
    s += w[i]! * x[i]!;
  }
  return s;
}

/** クランプ済み prospect eval（内積 → PROSPECT_EVAL_CLAMP でクリップ）。 */
function clampedEval(w: number[], x: number[]): number {
  const raw = dot(w, x);
  if (raw > PROSPECT_EVAL_CLAMP) {
    return PROSPECT_EVAL_CLAMP;
  }
  if (raw < -PROSPECT_EVAL_CLAMP) {
    return -PROSPECT_EVAL_CLAMP;
  }
  return raw;
}

interface DistStats {
  mean: number;
  std: number;
  p95Abs: number;
  maxAbs: number;
}

function distStats(values: number[]): DistStats {
  const n = values.length;
  if (n === 0) {
    return { mean: 0, std: 0, p95Abs: 0, maxAbs: 0 };
  }
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  const mean = sum / n;
  let variance = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= n;
  const std = Math.sqrt(variance);
  const abs = values.map((v) => Math.abs(v));
  abs.sort((a, b) => a - b);
  const p95Abs = abs[Math.min(n - 1, Math.floor(n * 0.95))]!;
  const maxAbs = abs[n - 1]!;
  return { mean, std, p95Abs, maxAbs };
}

interface AnchorReport {
  condition: {
    corpusPath: string;
    fitPath: string;
    teacher: Teacher;
    K: number;
    minSupport: number;
    rowsUsedForLegacy: number;
    rowsUsedForFeatures: number;
  };
  weightNames: string[];
  scale: number;
  support: number[];
  origin: ("regressed" | "anchored")[];
  finalWeights: number[];
  rawFitWeights: number[];
  baselineWeights: number[];
  anchorCheck: {
    prospectFourThreeWait: number;
    prospectFourThreeTurn: number;
    legacyFourThreeAnchor: number;
    ratioWait: number;
    ratioTurn: number;
  };
  ordering: {
    winTurn: number;
    doubleFourWhiteTurn: number;
    soloF4Turn: number;
    fourThreeTurn: number;
    monotonic: boolean;
  };
  distributions: {
    legacyLeafEval: DistStats;
    prospectEvalBaseline: DistStats;
    prospectEvalRegressedRaw: DistStats;
    prospectEvalFinal: DistStats;
  };
  losses: {
    baseline: number;
    regressedRaw: number;
    final: number;
  };
}

async function main(): Promise<void> {
  const corpusPath = parseStringArg("corpus");
  const fitPath = parseStringArg("fit");
  if (!corpusPath || !fitPath) {
    console.error(
      "使い方: prospect-anchor.ts --corpus=<labeled.jsonl> --fit=<texel-fit-*.json>" +
        " [--teacher=rapfi] [--min-support=100] [--K=200]",
    );
    process.exit(1);
  }
  const teacher = parseTeacherArg();
  const minSupport = parseIntArg("min-support", 100);
  const K = parseIntArg("K", 200);

  console.log("=== P3-d: スケールアンカリング量子化 ===");
  console.log(
    `条件: corpus=${corpusPath}, fit=${fitPath}, teacher=${teacher}, min-support=${minSupport}, K=${K}`,
  );

  const wasm = await loadWasmModule();
  const evaluator = new WasmBoardEvaluator(wasm);
  const weightNames = getWeightNames(wasm);
  const baselineWeights = getBaselineWeights(wasm);

  const rows = readCorpus(corpusPath);
  console.log(`コーパス読み込み: ${rows.length} 局面（破棄行を除く）`);

  const fitFile = JSON.parse(readFileSync(fitPath, "utf8")) as FitFile;
  const teacherFit = fitFile.teachers[teacher];
  if (!teacherFit) {
    console.error(`fit ファイルに teachers.${teacher} がありません`);
    process.exit(1);
  }
  const rawFitWeights = teacherFit.finalFit.weights;
  if (rawFitWeights.length !== FEATURE_COUNT) {
    console.error(
      `重み数不一致: fit=${rawFitWeights.length}, want ${FEATURE_COUNT}`,
    );
    process.exit(1);
  }

  // 名前が wasm 側と一致することを確認（SSoT ドリフト検出）
  for (let i = 0; i < FEATURE_COUNT; i++) {
    if (fitFile.weightNames[i] !== weightNames[i]) {
      console.error(
        `weightName 不一致 [${i}]: fit=${fitFile.weightNames[i]}, wasm=${weightNames[i]}`,
      );
      process.exit(1);
    }
  }

  // 1. 特徴サポート集計（コーパスの各行、非ゼロカウント）
  const support = new Array<number>(FEATURE_COUNT).fill(0);
  const teacherRows =
    teacher === "rapfi" ? rows.filter((r) => r.rapfiEval !== undefined) : rows;
  for (const row of teacherRows) {
    for (let i = 0; i < FEATURE_COUNT; i++) {
      if (row.features[i]! !== 0) {
        support[i]!++;
      }
    }
  }

  const origin: ("regressed" | "anchored")[] = support.map((s) =>
    s >= minSupport ? "regressed" : "anchored",
  );

  console.log(`\n=== 特徴サポート集計（${teacherRows.length} 行から）===`);
  for (let i = 0; i < FEATURE_COUNT; i++) {
    console.log(
      `  [${i}] ${weightNames[i]}: support=${support[i]}, origin=${origin[i]}`,
    );
  }

  // 2. legacy 葉評価をコーパス各行で計算
  console.log(`\n=== legacy 葉評価を計算中（${teacherRows.length} 局面）...`);
  const legacyEvals: number[] = [];
  const t0 = Date.now();
  for (const row of teacherRows) {
    const board = reconstructBoard(row);
    legacyEvals.push(legacyLeafEval(evaluator, board, row.stm));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  完了（${elapsed}s）`);

  // 3. 回帰採用特徴のみの予測 raw_fit をコーパス上で計算
  //    アンカー維持特徴は 0 を掛けたのと同等（ここでは寄与ゼロ扱い）。
  const regressedOnlyWeights = rawFitWeights.map((w, i) =>
    origin[i] === "regressed" ? w : 0,
  );
  const rawFitPreds: number[] = teacherRows.map((r) =>
    dot(regressedOnlyWeights, r.features),
  );

  // 4. スケール s = std(legacy) / std(raw_fit)
  const legacyStats = distStats(legacyEvals);
  const rawFitStats = distStats(rawFitPreds);
  if (rawFitStats.std < 1e-9) {
    console.error("回帰採用特徴のみの予測分布の標準偏差が 0 近傍。中止。");
    process.exit(1);
  }
  const s = legacyStats.std / rawFitStats.std;
  console.log(`\n=== スケール決定 ===`);
  console.log(
    `  legacy std=${legacyStats.std.toFixed(2)}, raw_fit(regressed only) std=${rawFitStats.std.toFixed(2)}`,
  );
  console.log(`  s = ${s.toFixed(6)}`);

  // 5. 最終重み: regressed → round(s * w_fit[i]), anchored → baseline
  const finalWeights = rawFitWeights.map((w, i) =>
    origin[i] === "regressed" ? Math.round(s * w) : baselineWeights[i]!,
  );

  // 6. 検証: 混成 prospect eval 分布
  const prospectEvalBaseline = teacherRows.map((r) =>
    clampedEval(baselineWeights, r.features),
  );
  const prospectEvalRawFit = teacherRows.map((r) =>
    clampedEval(rawFitWeights, r.features),
  );
  const prospectEvalFinal = teacherRows.map((r) =>
    clampedEval(finalWeights, r.features),
  );

  const distributions = {
    legacyLeafEval: distStats(legacyEvals),
    prospectEvalBaseline: distStats(prospectEvalBaseline),
    prospectEvalRegressedRaw: distStats(prospectEvalRawFit),
    prospectEvalFinal: distStats(prospectEvalFinal),
  };

  console.log(`\n=== 分布比較（stm 視点 raw eval, クランプ後）===`);
  console.log(
    `  legacy:              std=${distributions.legacyLeafEval.std.toFixed(2)}` +
      ` p95Abs=${distributions.legacyLeafEval.p95Abs.toFixed(2)}` +
      ` maxAbs=${distributions.legacyLeafEval.maxAbs.toFixed(0)}`,
  );
  console.log(
    `  prospect baseline:   std=${distributions.prospectEvalBaseline.std.toFixed(2)}` +
      ` p95Abs=${distributions.prospectEvalBaseline.p95Abs.toFixed(2)}` +
      ` maxAbs=${distributions.prospectEvalBaseline.maxAbs.toFixed(0)}`,
  );
  console.log(
    `  prospect regressed:  std=${distributions.prospectEvalRegressedRaw.std.toFixed(2)}` +
      ` p95Abs=${distributions.prospectEvalRegressedRaw.p95Abs.toFixed(2)}` +
      ` maxAbs=${distributions.prospectEvalRegressedRaw.maxAbs.toFixed(0)}`,
  );
  console.log(
    `  prospect final(mix): std=${distributions.prospectEvalFinal.std.toFixed(2)}` +
      ` p95Abs=${distributions.prospectEvalFinal.p95Abs.toFixed(2)}` +
      ` maxAbs=${distributions.prospectEvalFinal.maxAbs.toFixed(0)}`,
  );
  console.log(
    `  PROSPECT_EVAL_CLAMP=${PROSPECT_EVAL_CLAMP}（勝ちスコア帯 FIVE−5000 と構造干渉なし）`,
  );

  // 7. アンカー検証: 四三点カテゴリと LEAF_FOUR_THREE_THREAT+FOUR_THREE_BONUS 級の乖離
  const fourThreeWaitIdx = CAT_INDEX.FOUR_THREE * 2; // WAIT=0
  const fourThreeTurnIdx = CAT_INDEX.FOUR_THREE * 2 + 1; // TURN=1
  const prospectFourThreeWait = finalWeights[fourThreeWaitIdx]!;
  const prospectFourThreeTurn = finalWeights[fourThreeTurnIdx]!;

  console.log(`\n=== アンカー検証（四三点 vs legacy 参照）===`);
  console.log(
    `  legacy 参照 (LEAF_FOUR_THREE_THREAT + FOUR_THREE_BONUS) = ${LEGACY_FOUR_THREE_ANCHOR}`,
  );
  console.log(
    `  PROSPECT_FOUR_THREE_WAIT = ${prospectFourThreeWait}（origin=${origin[fourThreeWaitIdx]}, 比率=${(prospectFourThreeWait / LEGACY_FOUR_THREE_ANCHOR).toFixed(3)}）`,
  );
  console.log(
    `  PROSPECT_FOUR_THREE_TURN = ${prospectFourThreeTurn}（origin=${origin[fourThreeTurnIdx]}, 比率=${(prospectFourThreeTurn / LEGACY_FOUR_THREE_ANCHOR).toFixed(3)}）`,
  );

  // 8. 序列の sanity（勝ち級カテゴリ TURN 列の単調性）
  const winTurn = finalWeights[CAT_INDEX.WIN * 2 + 1]!;
  const doubleFourWhiteTurn =
    finalWeights[CAT_INDEX.DOUBLE_FOUR_WHITE * 2 + 1]!;
  const soloF4Turn = finalWeights[CAT_INDEX.SOLO_F4 * 2 + 1]!;
  const fourThreeTurn = finalWeights[CAT_INDEX.FOUR_THREE * 2 + 1]!;
  const monotonic =
    winTurn > doubleFourWhiteTurn &&
    doubleFourWhiteTurn > soloF4Turn &&
    soloF4Turn > fourThreeTurn;

  console.log(`\n=== 勝ち級序列 sanity（TURN 列単調性）===`);
  console.log(
    `  WIN(${winTurn}) > DOUBLE_FOUR_WHITE(${doubleFourWhiteTurn}) > SOLO_F4(${soloF4Turn}) > FOUR_THREE(${fourThreeTurn})`,
  );
  console.log(`  monotonic=${monotonic}`);
  if (!monotonic) {
    console.warn(
      "  ⚠ 勝ち級序列が崩れています。焼き込み前に見直しが必要です。",
    );
  }

  // 9. 損失検証（コーパスに対する MSE）
  const dataset = teacherRows.map((r) => r.features);
  const labels =
    teacher === "rapfi"
      ? teacherRows.map((r) => rapfiTeacherLabel(r.rapfiEval!, K))
      : teacherRows.map((r) => r.outcome);

  const lossBaseline = meanSquaredLoss(dataset, labels, baselineWeights, K);
  const lossRegressedRaw = meanSquaredLoss(dataset, labels, rawFitWeights, K);
  const lossFinal = meanSquaredLoss(dataset, labels, finalWeights, K);

  console.log(
    `\n=== 損失比較（教師=${teacher}, K=${K}, MSE over ${dataset.length} 行）===`,
  );
  console.log(
    `  baseline (現行 PROSPECT_SCORE_DEFAULT): ${lossBaseline.toFixed(6)}`,
  );
  console.log(
    `  raw regressed weights (fit 生値):        ${lossRegressedRaw.toFixed(6)}`,
  );
  console.log(
    `  final (mix, スケール後):                  ${lossFinal.toFixed(6)}`,
  );
  console.log(
    `  ※ スケーリングは sigmoid を通すと形が変わるので loss は raw > final が普通。` +
      `重要なのは final が baseline を改善していること。`,
  );
  const improvedVsBaseline = lossFinal < lossBaseline;
  console.log(
    `  final vs baseline: ${improvedVsBaseline ? "改善" : "非改善"}` +
      `（${lossBaseline.toFixed(6)} → ${lossFinal.toFixed(6)}）`,
  );

  // 10. コンソールに Zig 配列形式スニペットを出力
  console.log(
    `\n=== 焼き込みスニペット（zig/src/prospect.zig PROSPECT_SCORE_DEFAULT）===`,
  );
  const catOrder = [
    "none",
    "weak",
    "solo_b2",
    "solo_f2",
    "double_f2",
    "solo_b3",
    "b4_f2",
    "solo_f3",
    "f3_f2",
    "f3_b3",
    "solo_b4",
    "double_three_black_risk",
    "double_three_white",
    "four_three",
    "solo_f4",
    "double_four_white",
    "win",
  ];
  for (let c = 0; c < CAT_COUNT; c++) {
    const waitIdx = c * 2;
    const turnIdx = c * 2 + 1;
    const waitVal = finalWeights[waitIdx]!;
    const turnVal = finalWeights[turnIdx]!;
    const waitTag =
      origin[waitIdx] === "regressed" ? "texel-r1 回帰" : "アンカー維持";
    const turnTag =
      origin[turnIdx] === "regressed" ? "texel-r1 回帰" : "アンカー維持";
    const tag =
      waitTag === turnTag ? waitTag : `WAIT=${waitTag} / TURN=${turnTag}`;
    console.log(`    .{ ${waitVal}, ${turnVal} }, // ${catOrder[c]} (${tag})`);
  }

  // 11. 結果 JSON 保存
  const report: AnchorReport = {
    condition: {
      corpusPath,
      fitPath,
      teacher,
      K,
      minSupport,
      rowsUsedForLegacy: teacherRows.length,
      rowsUsedForFeatures: teacherRows.length,
    },
    weightNames,
    scale: s,
    support,
    origin,
    finalWeights,
    rawFitWeights,
    baselineWeights,
    anchorCheck: {
      prospectFourThreeWait,
      prospectFourThreeTurn,
      legacyFourThreeAnchor: LEGACY_FOUR_THREE_ANCHOR,
      ratioWait: prospectFourThreeWait / LEGACY_FOUR_THREE_ANCHOR,
      ratioTurn: prospectFourThreeTurn / LEGACY_FOUR_THREE_ANCHOR,
    },
    ordering: {
      winTurn,
      doubleFourWhiteTurn,
      soloF4Turn,
      fourThreeTurn,
      monotonic,
    },
    distributions,
    losses: {
      baseline: lossBaseline,
      regressedRaw: lossRegressedRaw,
      final: lossFinal,
    },
  };

  mkdirSync("bench-results", { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = `bench-results/prospect-anchor-${timestamp}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n結果を ${outPath} に保存しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
