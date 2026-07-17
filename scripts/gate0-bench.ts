/**
 * Gate 0 測定ベンチ: eval_basis(legacy/prospect) × threatProbe(on/off) の
 * 4構成で NPS・time-to-depth・lmr/aspiration 再探索率・q_search 比率を計測する
 * （docs/plans/eval-basis-prospect-2026-07-13.md §5 Gate 0）。
 *
 * 判定基準: NPS(prospect, probe-off) が NPS(legacy, probe-off) の -20% 以内。
 * probe-on は参考記録（probe 込み NPS は eval 退行を隠すため判定には使わない）。
 *
 * 対局は26珠型開局ローテーション・固定深度・decodeEvalOptions 由来のフラグ
 * のみで決定的（randomFactor は findBestMove に存在しないためそもそも
 * 非決定要素がない）。時間制限（timeLimitMs）は無効化して固定深度に到達させるが、
 * maxNodes は MAX_NODES で上限を設ける（実測で序盤の広い局面は maxNodes=無制限
 * だと1手が数分〜暴走することを確認したため。ノード数上限であれば深さ到達を
 * 妨げずに1手の計算量を有界にできる）。
 *
 * ビルドモード注意: zig/build.zig は cpu-engine ターゲットの optimize を
 * `.ReleaseFast` に固定しており、`zig build`（デフォルト呼び出し）で
 * Debug ビルドが混入することは構造的にない（CLI オプションでの上書き経路も
 * 存在しない）。VERIFY_INCREMENTAL の evaluateFull 検算はこの wasm では
 * 常に無効。
 *
 * 測定モード:
 *   既定（自己対局）: 構成ごとに自分の手で対局を進めるため、構成間で局面セットが
 *   異なる（eval が違えば棋譜も違う）。NPS 比較には局面差の交絡が乗る。
 *   --fixed: legacy probe-off の自己対局で局面列を1回だけ収集し、全構成で
 *   **同一の局面集合**に対して findBestMove を実行する。per-node コストの
 *   構成間比較はこちらが正（Gate 0 判定は --fixed を使う）。
 *
 * 使用例:
 *   cd zig && zig build && cd ..
 *   node --experimental-strip-types --import ./scripts/register-loader.mjs scripts/gate0-bench.ts --games=4 --depth=5 --fixed --skip-probe-on
 */

import { mkdirSync, writeFileSync } from "node:fs";

import type {
  EvalBasis,
  EvaluationOptions,
} from "@/logic/cpu/evaluation/patternScores";
import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { getAllJushuNames, getJushuPositions } from "@/logic/cpu/opening";
import { boardStateToWasm, colorToWasm } from "@/logic/cpu/wasm/boardAdapter";
import {
  isForbiddenForBlack,
  preloadForbiddenWasm,
} from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { checkWin, createEmptyBoard } from "@/logic/renjuRules";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

// commit-bench の worktree 後方互換のため cpu-bridge-worker.ts が相対 import する
// scripts/lib/wasmEvalOptionsEncoder.ts をここでも相対 import で使う（5個目のローカル
// コピーを作らない。gate0-bench.ts 自体は commit-bench の worktree 切替対象外だが、
// エンコーダのビットレイアウトSSoTを1箇所に保つため統一する）。
import { encodeEvalOptionsForWasm } from "./lib/wasmEvalOptionsEncoder.ts";

const DRAW_MOVE_LIMIT = 70;
/**
 * findBestMove の maxNodes。「時間制限なし」で固定深度に到達させる方針だが、
 * maxNodes=0（無制限）にすると序盤の枝分かれが広い局面で1手が数分〜暴走する
 * ことを実測で確認した（診断: depth5でも通常は<1秒だが局面依存で暴走するケースが
 * ある）。深さ5-7の到達を妨げない十分大きな上限（実測で depth7 でも 20 万ノード
 * 程度で収まる）を設け、時間ではなくノード数で「固定深度到達」を保証する。
 */
const MAX_NODES = 300000;
/** findBestMove の absoluteTimeLimitMs（安全弁。MAX_NODES が主たる上限）。 */
const ABSOLUTE_TIME_LIMIT_MS = 15000;
/** aspiration window の段階的拡大幅を使う（mode=1）。mode=0 だと固定幅1つのみで
 * 再探索率が観測しにくいため。 */
const ASPIRATION_MODE = 1;

interface WasmStats {
  nodes: number;
  lmrTrials: number;
  lmrResearches: number;
  qSearchNodes: number;
  threatProbeCutoffs: number;
}

/**
 * 統計バッファ読み出し。オフセットは zig/src/main.zig writeStats の fields 配列順
 * （u32×12: nodes, tt_hits, tt_cutoffs, beta_cutoffs, null_move_trials,
 * null_move_cutoffs, futility_prunes, threat_extensions, lmr_trials(+32),
 * lmr_researches(+36), q_search_nodes(+40), threat_probe_cutoffs(+44)）に対応。
 * Zig 側のフィールド追加/並べ替え時はここも追随が必要。
 */
function readStats(wasm: WasmModuleContext): WasmStats {
  const ptr = wasm.getStatsBuffer();
  const view = new DataView(wasm.memory.buffer);
  return {
    nodes: view.getUint32(ptr, true),
    lmrTrials: view.getUint32(ptr + 32, true),
    lmrResearches: view.getUint32(ptr + 36, true),
    qSearchNodes: view.getUint32(ptr + 40, true),
    threatProbeCutoffs: view.getUint32(ptr + 44, true),
  };
}

interface MoveMetrics {
  timeMs: number;
  nodes: number;
  depth: number;
  lmrTrials: number;
  lmrResearches: number;
  qSearchNodes: number;
  threatProbeCutoffs: number;
  aspirationResearches: number;
}

interface ConfigResult {
  basis: EvalBasis;
  threatProbe: boolean;
  moveCount: number;
  totalTimeMs: number;
  totalNodes: number;
  totalLmrTrials: number;
  totalLmrResearches: number;
  totalQSearchNodes: number;
  totalThreatProbeCutoffs: number;
  totalAspirationResearches: number;
  totalDepth: number;
  nps: number;
  avgTimeMs: number;
  avgDepth: number;
  lmrResearchRate: number;
  aspirationResearchesPerMove: number;
  qSearchRatio: number;
}

function encodeFlags(basis: EvalBasis): number {
  // hard 相当のフラグ（single_four_penalty 等）+ eval_basis(bit18)。
  const opts: EvaluationOptions = {
    ...DIFFICULTY_PARAMS.hard.evaluationOptions,
    evalBasis: basis,
  };
  return encodeEvalOptionsForWasm(opts);
}

function callFindBestMove(
  wasm: WasmModuleContext,
  board: BoardState,
  color: "black" | "white",
  depth: number,
  evalFlags: number,
): { position: Position; completedDepth: number } {
  boardStateToWasm(wasm, board);
  wasm.ttClear();
  wasm.findBestMove(
    colorToWasm(color),
    depth,
    0, // timeLimitMs: 0=無制限（固定深度で判定するため）
    MAX_NODES,
    ABSOLUTE_TIME_LIMIT_MS,
    ASPIRATION_MODE,
    evalFlags,
  );
  const ptr = wasm.getResultBuffer();
  const view = new DataView(wasm.memory.buffer);
  return {
    position: { row: view.getUint8(ptr), col: view.getUint8(ptr + 1) },
    completedDepth: view.getUint8(ptr + 6),
  };
}

/** --fixed モードで全構成に共通で与える局面（盤面スナップショット + 手番）。 */
interface RecordedPosition {
  board: BoardState;
  color: "black" | "white";
}

function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => [...row]);
}

function playGame(
  wasm: WasmModuleContext,
  openingMoves: [Position, Position, Position],
  depth: number,
  evalFlags: number,
  onPosition?: (position: RecordedPosition) => void,
): MoveMetrics[] {
  const board: BoardState = createEmptyBoard();
  const colors: StoneColor[] = ["black", "white"];
  let moveCount = 0;
  const metrics: MoveMetrics[] = [];

  for (const pos of openingMoves) {
    const color = colors[moveCount % 2];
    board[pos.row]![pos.col] = color;
    moveCount++;
  }

  while (moveCount < DRAW_MOVE_LIMIT) {
    const color = colors[moveCount % 2] as "black" | "white";
    onPosition?.({ board: cloneBoard(board), color });
    const start = performance.now();
    const result = callFindBestMove(wasm, board, color, depth, evalFlags);
    const elapsed = performance.now() - start;
    const stats = readStats(wasm);
    const aspirationResearches = wasm.getAspirationResearchCount();

    metrics.push({
      timeMs: elapsed,
      nodes: stats.nodes,
      depth: result.completedDepth,
      lmrTrials: stats.lmrTrials,
      lmrResearches: stats.lmrResearches,
      qSearchNodes: stats.qSearchNodes,
      threatProbeCutoffs: stats.threatProbeCutoffs,
      aspirationResearches,
    });

    const pos = result.position;
    if (color === "black" && isForbiddenForBlack(board, pos.row, pos.col)) {
      break;
    }
    board[pos.row]![pos.col] = color;
    moveCount++;
    if (checkWin(board, pos, color)) {
      break;
    }
  }

  return metrics;
}

/**
 * --fixed モード用の局面収集: legacy probe-off の自己対局で局面列を作る。
 * 局面の「出どころ」が legacy 寄りでも、全構成が同一集合を測る限り
 * per-node コストの構成間比較としては公平（比較対象が固定されることが本質）。
 */
function collectPositions(
  wasm: WasmModuleContext,
  depth: number,
  maxGames: number,
): RecordedPosition[] {
  wasm.setThreatProbeEnabled(0);
  const evalFlags = encodeFlags("legacy");
  const positions: RecordedPosition[] = [];
  const names = getAllJushuNames();
  let gameCount = 0;
  for (const name of names) {
    if (gameCount >= maxGames) {
      break;
    }
    const jushu = getJushuPositions(name, true);
    if (!jushu) {
      continue;
    }
    playGame(wasm, jushu, depth, evalFlags, (position) => {
      positions.push(position);
    });
    gameCount++;
  }
  wasm.setThreatProbeEnabled(1);
  return positions;
}

/** 固定局面集合に対して各局面1回ずつ findBestMove を実行し計測する。 */
function benchPositions(
  wasm: WasmModuleContext,
  positions: RecordedPosition[],
  depth: number,
  evalFlags: number,
): MoveMetrics[] {
  const metrics: MoveMetrics[] = [];
  for (const { board, color } of positions) {
    const start = performance.now();
    const result = callFindBestMove(wasm, board, color, depth, evalFlags);
    const elapsed = performance.now() - start;
    const stats = readStats(wasm);
    metrics.push({
      timeMs: elapsed,
      nodes: stats.nodes,
      depth: result.completedDepth,
      lmrTrials: stats.lmrTrials,
      lmrResearches: stats.lmrResearches,
      qSearchNodes: stats.qSearchNodes,
      threatProbeCutoffs: stats.threatProbeCutoffs,
      aspirationResearches: wasm.getAspirationResearchCount(),
    });
  }
  return metrics;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

function runConfig(
  wasm: WasmModuleContext,
  basis: EvalBasis,
  threatProbeEnabled: boolean,
  depth: number,
  maxGames: number,
  fixedPositions: RecordedPosition[] | null,
): ConfigResult {
  wasm.setThreatProbeEnabled(threatProbeEnabled ? 1 : 0);
  const evalFlags = encodeFlags(basis);

  const allMetrics: MoveMetrics[] = [];
  if (fixedPositions) {
    allMetrics.push(...benchPositions(wasm, fixedPositions, depth, evalFlags));
  } else {
    const names = getAllJushuNames();
    let gameCount = 0;
    for (const name of names) {
      if (gameCount >= maxGames) {
        break;
      }
      const positions = getJushuPositions(name, true);
      if (!positions) {
        continue;
      }
      allMetrics.push(...playGame(wasm, positions, depth, evalFlags));
      gameCount++;
    }
  }

  const moveCount = allMetrics.length;
  const totalTimeMs = sum(allMetrics.map((m) => m.timeMs));
  const totalNodes = sum(allMetrics.map((m) => m.nodes));
  const totalLmrTrials = sum(allMetrics.map((m) => m.lmrTrials));
  const totalLmrResearches = sum(allMetrics.map((m) => m.lmrResearches));
  const totalQSearchNodes = sum(allMetrics.map((m) => m.qSearchNodes));
  const totalThreatProbeCutoffs = sum(
    allMetrics.map((m) => m.threatProbeCutoffs),
  );
  const totalAspirationResearches = sum(
    allMetrics.map((m) => m.aspirationResearches),
  );
  const totalDepth = sum(allMetrics.map((m) => m.depth));

  // threat_probe_enabled は wasm インスタンス全体で共有される状態のため、
  // 次の構成に影響しないよう既定(true)へ戻す。
  wasm.setThreatProbeEnabled(1);

  return {
    basis,
    threatProbe: threatProbeEnabled,
    moveCount,
    totalTimeMs,
    totalNodes,
    totalLmrTrials,
    totalLmrResearches,
    totalQSearchNodes,
    totalThreatProbeCutoffs,
    totalAspirationResearches,
    totalDepth,
    nps: totalTimeMs > 0 ? (totalNodes / totalTimeMs) * 1000 : 0,
    avgTimeMs: moveCount > 0 ? totalTimeMs / moveCount : 0,
    avgDepth: moveCount > 0 ? totalDepth / moveCount : 0,
    lmrResearchRate:
      totalLmrTrials > 0 ? totalLmrResearches / totalLmrTrials : 0,
    aspirationResearchesPerMove:
      moveCount > 0 ? totalAspirationResearches / moveCount : 0,
    qSearchRatio: totalNodes > 0 ? totalQSearchNodes / totalNodes : 0,
  };
}

function printResult(result: ConfigResult): void {
  console.log(
    `  basis=${result.basis} probe=${result.threatProbe ? "on" : "off"}: ` +
      `moves=${result.moveCount} NPS=${result.nps.toFixed(0)} ` +
      `avgDepth=${result.avgDepth.toFixed(2)} avgTimeMs=${result.avgTimeMs.toFixed(1)} ` +
      `lmrResearchRate=${(result.lmrResearchRate * 100).toFixed(2)}% ` +
      `aspirationResearches/move=${result.aspirationResearchesPerMove.toFixed(2)} ` +
      `qSearchRatio=${(result.qSearchRatio * 100).toFixed(1)}% ` +
      `threatProbeCutoffs=${result.totalThreatProbeCutoffs}`,
  );
}

async function main(): Promise<void> {
  await preloadForbiddenWasm();

  const maxGames = parseInt(
    process.argv.find((a) => a.startsWith("--games="))?.slice(8) ?? "4",
    10,
  );
  const depth = parseInt(
    process.argv.find((a) => a.startsWith("--depth="))?.slice(8) ?? "5",
    10,
  );
  const fixedMode = process.argv.includes("--fixed");
  const skipProbeOn = process.argv.includes("--skip-probe-on");
  /** プロファイル取得用: 指定 basis の構成だけ実行する（例: --only=prospect）。 */
  const onlyBasis = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

  console.log("=== Gate 0 測定ベンチ ===");
  console.log(
    `条件: depth=${depth}, games=${maxGames}, mode=${fixedMode ? "fixed-positions" : "self-play"}, skipProbeOn=${skipProbeOn}\n`,
  );

  const wasm: WasmModuleContext = await loadWasmModule();

  let fixedPositions: RecordedPosition[] | null = null;
  if (fixedMode) {
    fixedPositions = collectPositions(wasm, depth, maxGames);
    console.log(`固定局面を ${fixedPositions.length} 局面収集しました\n`);
  }

  const allConfigs: { basis: EvalBasis; threatProbe: boolean }[] = [
    { basis: "legacy", threatProbe: true },
    { basis: "legacy", threatProbe: false },
    { basis: "prospect", threatProbe: true },
    { basis: "prospect", threatProbe: false },
  ];
  const configs = allConfigs.filter(
    (c) =>
      !(skipProbeOn && c.threatProbe) && (!onlyBasis || c.basis === onlyBasis),
  );

  const results: ConfigResult[] = [];
  for (const config of configs) {
    const result = runConfig(
      wasm,
      config.basis,
      config.threatProbe,
      depth,
      maxGames,
      fixedPositions,
    );
    results.push(result);
    printResult(result);
  }

  // Gate 0 判定: NPS(prospect, probe-off) >= NPS(legacy, probe-off) * 0.8
  const legacyProbeOff = results.find(
    (r) => r.basis === "legacy" && !r.threatProbe,
  );
  const prospectProbeOff = results.find(
    (r) => r.basis === "prospect" && !r.threatProbe,
  );
  let verdict = "unknown";
  let npsRatioPct: number | null = null;
  if (legacyProbeOff && prospectProbeOff && legacyProbeOff.nps > 0) {
    const ratio = prospectProbeOff.nps / legacyProbeOff.nps;
    npsRatioPct = ratio * 100;
    verdict = ratio >= 0.8 ? "PASS" : "FAIL";
    console.log(
      `\n=== Gate 0 判定 ===\n` +
        `NPS(prospect,probe-off)/NPS(legacy,probe-off) = ${npsRatioPct.toFixed(1)}% -> ${verdict}（基準: >=80%、すなわち-20%以内）`,
    );
  }

  const outputDir = "bench-results";
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = `${outputDir}/gate0-${timestamp}.json`;
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        condition: {
          depth,
          maxGames,
          aspirationMode: ASPIRATION_MODE,
          mode: fixedMode ? "fixed-positions" : "self-play",
          fixedPositionCount: fixedPositions?.length ?? null,
        },
        buildMode:
          "ReleaseFast（zig/build.zig で cpu-engine ターゲットの optimize に固定。" +
          "`zig build` の実行では Debug が混入する経路はない）",
        results,
        npsRatioPct,
        verdict,
      },
      null,
      2,
    ),
  );
  console.log(`\n結果を ${outputPath} に保存しました`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
