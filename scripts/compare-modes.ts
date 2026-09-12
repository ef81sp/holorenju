/**
 * 時間モード vs 固定ノード（決定的）モードの着手比較ツール
 * （docs/plans/bench-fixed-nodes-2026-09-06.md §7.4〜7.9 の「統計を合わせても固定側が弱い」
 * 原因を局面レベルで特定する）。
 *
 * 入力: commit-bench の結果 JSON（A=時間モード、B=固定モードの混合対局）。
 * 処理:
 *   1. 時間モード側（A）が指した探索手（depth>0）の局面を棋譜から復元する。
 *   2. 同じ局面を決定的モード（setDeterministicMode(1)、time_limit=0、max_nodes=N、
 *      absolute 0、aspiration 0、hard の eval フラグ）で探索し着手・score・深さ・stats を取る。
 *   3. 時間モードの記録と比較し、不一致の局面を列挙する。
 *   4. --verify: 不一致の局面で両方の着手を置いた後の局面を N=--verify-nodes で探索し、
 *      相手視点 score の符号反転で両着手の参照評価を出す。差が --threshold 以上なら
 *      「固定が悪い」「固定が良い」に分類する。
 *
 * 注意: 決定的モードの予算（プローブ上限など）は **この worktree の wasm** のもの。
 * JSON を生成したコミットの B 側とは一致しないことがある（サマリに両 sha を出す）。
 *
 * 使用例:
 *   pnpm compare:modes bench-results/commit-bench-2026-09-06T14-57-08-162Z.json --limit=20
 *   pnpm compare:modes <json> --limit=10 --verify --out=scratch/compare.jsonl
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

import type { WasmModuleContext } from "@/logic/cpu/wasm/types";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { boardStateToWasm, colorToWasm } from "@/logic/cpu/wasm/boardAdapter";
import {
  isForbiddenForBlack,
  preloadForbiddenWasm,
} from "@/logic/cpu/wasm/forbiddenAdapter";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { formatMove } from "@/logic/gameRecordParser";
import { checkWin, createEmptyBoard } from "@/logic/renjuRules";
import { DIFFICULTY_PARAMS } from "@/types/cpu";

import {
  FIXED_NODES_DEFAULT,
  parseFixedNodesFlag,
} from "./lib/benchCliChecks.ts";
import { checkDeterministicSupport } from "./lib/deterministicSupport.ts";
import { encodeEvalOptionsForWasm } from "./lib/wasmEvalOptionsEncoder.ts";
import {
  type WasmSearchStats,
  readWasmSearchStats,
} from "./lib/wasmSearchStats.ts";

/** 五連（即勝ち）・禁手の参照評価に使う絶対値（wasm の勝ちスコア 99980 より大きい） */
const TERMINAL_SCORE = 100000;

// ---------------------------------------------------------------------------
// 入力 JSON の型（commit-bench の結果のうち使う部分のみ）
// ---------------------------------------------------------------------------

interface BenchMove {
  row: number;
  col: number;
  time: number;
  isOpening: boolean;
  score?: number;
  depth?: number;
  stats?: Partial<WasmSearchStats>;
}

interface BenchGame {
  winner: string;
  reason: string;
  moveHistory: BenchMove[];
  isABlack: boolean;
  jushuName?: string;
  pairId?: number;
}

interface BenchJson {
  commitA?: { shortSha?: string };
  commitB?: { shortSha?: string };
  config?: { fixedNodesA?: number; fixedNodesB?: number };
  games: BenchGame[];
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliOptions {
  input: string;
  fixedNodes: number;
  verify: boolean;
  verifyNodes: number;
  verifyDepth: number;
  threshold: number;
  limit: number | undefined;
  offset: number;
  out: string | undefined;
}

function intArg(name: string, fallback: number, min = 0): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (raw === undefined) {
    return fallback;
  }
  const v = parseInt(raw.slice(name.length + 3), 10);
  if (!Number.isFinite(v) || v < min) {
    console.error(`--${name} は ${min} 以上の整数で指定してください: ${raw}`);
    process.exit(1);
  }
  return v;
}

/**
 * `--fixed-nodes[=N]`: 値なしは `FIXED_NODES_DEFAULT`、値ありは正の整数のみ
 * （0 は「無制限」ではなく即 abort になるので通さない）。commit-bench と同じ規則。
 */
function fixedNodesArg(): number {
  const arg = process.argv.find(
    (a) => a === "--fixed-nodes" || a.startsWith("--fixed-nodes="),
  );
  if (arg === undefined) {
    return FIXED_NODES_DEFAULT;
  }
  const parsed = parseFixedNodesFlag(arg, "--fixed-nodes");
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  return parsed.value;
}

function parseArgs(): CliOptions {
  const input = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!input || !existsSync(input)) {
    console.error(
      `使い方: pnpm compare:modes <commit-bench JSON> [--fixed-nodes[=N]（既定 ${FIXED_NODES_DEFAULT}）] [--limit=N] [--offset=N]\n` +
        "        [--verify] [--verify-nodes=4000000] [--verify-depth=9] [--threshold=300] [--out=<jsonl>]",
    );
    process.exit(1);
  }
  const limitRaw = process.argv.find((a) => a.startsWith("--limit="));
  return {
    input,
    fixedNodes: fixedNodesArg(),
    verify: process.argv.includes("--verify"),
    verifyNodes: intArg("verify-nodes", 4000000, 1),
    verifyDepth: intArg("verify-depth", 9, 1),
    threshold: intArg("threshold", 300),
    limit: limitRaw === undefined ? undefined : intArg("limit", 0),
    offset: intArg("offset", 0),
    out: process.argv.find((a) => a.startsWith("--out="))?.slice(6),
  };
}

// ---------------------------------------------------------------------------
// 局面復元
// ---------------------------------------------------------------------------

interface TargetPosition {
  gameIndex: number;
  pairId: number | undefined;
  jushuName: string | undefined;
  /** 1 始まりの手数（この手が何手目か） */
  ply: number;
  color: "black" | "white";
  /** この手を指す前までの棋譜 */
  record: string;
  board: BoardState;
  timeMove: Position;
  timeScore: number;
  timeDepth: number;
  timeMs: number;
}

/** 時間モード側（A）の探索手（depth>0）の局面を全対局から集める */
function collectTargets(json: BenchJson): TargetPosition[] {
  const targets: TargetPosition[] = [];
  json.games.forEach((game, gameIndex) => {
    const board = createEmptyBoard();
    const record: string[] = [];
    game.moveHistory.forEach((move, i) => {
      const color: StoneColor = i % 2 === 0 ? "black" : "white";
      const isA = game.isABlack === (color === "black");
      if (isA && !move.isOpening && (move.depth ?? 0) > 0) {
        targets.push({
          gameIndex,
          pairId: game.pairId,
          jushuName: game.jushuName,
          ply: i + 1,
          color,
          record: record.join(" "),
          board: board.map((r) => [...r]),
          timeMove: { row: move.row, col: move.col },
          timeScore: move.score ?? 0,
          timeDepth: move.depth ?? 0,
          timeMs: move.time,
        });
      }
      board[move.row]![move.col] = color;
      record.push(formatMove({ row: move.row, col: move.col }));
    });
  });
  return targets;
}

// ---------------------------------------------------------------------------
// 決定的探索
// ---------------------------------------------------------------------------

interface SearchOutcome {
  position: Position;
  score: number;
  completedDepth: number;
  stats: WasmSearchStats;
  elapsedMs: number;
}

function readStats(wasm: WasmModuleContext): WasmSearchStats {
  const features =
    typeof wasm.getSearchFeatures === "function"
      ? wasm.getSearchFeatures() >>> 0
      : undefined;
  return readWasmSearchStats(
    new DataView(wasm.memory.buffer),
    wasm.getStatsBuffer(),
    features,
    typeof wasm.getStatsBufferLength === "function"
      ? wasm.getStatsBufferLength()
      : undefined,
  );
}

function searchDeterministic(
  wasm: WasmModuleContext,
  board: BoardState,
  color: "black" | "white",
  depth: number,
  maxNodes: number,
  evalFlags: number,
): SearchOutcome {
  boardStateToWasm(wasm, board);
  wasm.ttClear();
  const start = performance.now();
  wasm.findBestMove(
    colorToWasm(color),
    depth,
    0, // timeLimitMs: 決定的モードは時間を見ない
    maxNodes,
    0, // absoluteTimeLimitMs
    0, // aspirationMode（commit-bench と同じ）
    evalFlags,
  );
  const elapsedMs = performance.now() - start;
  const ptr = wasm.getResultBuffer();
  const view = new DataView(wasm.memory.buffer);
  return {
    position: { row: view.getUint8(ptr), col: view.getUint8(ptr + 1) },
    score: view.getInt32(ptr + 2, true),
    completedDepth: view.getUint8(ptr + 6),
    stats: readStats(wasm),
    elapsedMs,
  };
}

/**
 * 着手 move を置いた後の局面を相手の手番で探索し、符号反転して「着手した側から見た評価」を返す。
 * 五連は +TERMINAL、黒の禁手は −TERMINAL（探索しない）。
 */
function verifyMove(
  wasm: WasmModuleContext,
  target: TargetPosition,
  move: Position,
  opts: CliOptions,
  evalFlags: number,
): { score: number; depth: number; terminal: boolean } {
  const { color } = target;
  if (
    color === "black" &&
    isForbiddenForBlack(target.board, move.row, move.col)
  ) {
    return { score: -TERMINAL_SCORE, depth: 0, terminal: true };
  }
  const board = target.board.map((r) => [...r]);
  board[move.row]![move.col] = color;
  if (checkWin(board, move, color)) {
    return { score: TERMINAL_SCORE, depth: 0, terminal: true };
  }
  const opponent = color === "black" ? "white" : "black";
  const outcome = searchDeterministic(
    wasm,
    board,
    opponent,
    opts.verifyDepth,
    opts.verifyNodes,
    evalFlags,
  );
  return {
    score: -outcome.score,
    depth: outcome.completedDepth,
    terminal: false,
  };
}

// ---------------------------------------------------------------------------
// 結果行
// ---------------------------------------------------------------------------

type Verdict = "fixed-worse" | "fixed-better" | "similar";

interface ResultRow {
  gameIndex: number;
  pairId: number | undefined;
  jushuName: string | undefined;
  ply: number;
  color: "black" | "white";
  record: string;
  match: boolean;
  time: { move: string; score: number; depth: number; ms: number };
  fixed: {
    move: string;
    score: number;
    depth: number;
    ms: number;
    nodes: number;
    preSearchNodes: number | undefined;
    probeNodes: number | undefined;
    probeCalls: number | undefined;
    probeCapHits: number | undefined;
  };
  verify?: {
    timeMoveScore: number;
    fixedMoveScore: number;
    diff: number;
    verdict: Verdict;
    depths: [number, number];
    /** 参照探索（終端でないもの）の完了深さが hard の depth 未満 → verdict は信用しない */
    unreliable: boolean;
  };
}

function classify(diff: number, threshold: number): Verdict {
  if (diff >= threshold) {
    return "fixed-worse";
  }
  if (diff <= -threshold) {
    return "fixed-better";
  }
  return "similar";
}

function fmt(n: number | undefined): string {
  return n === undefined ? "-" : String(n);
}

function printMismatch(row: ResultRow): void {
  const f = row.fixed;
  let line =
    `#${row.gameIndex}/${row.ply}手目 ${row.color === "black" ? "黒" : "白"} ` +
    `時間=${row.time.move}(${row.time.score} d${row.time.depth}) ` +
    `固定=${f.move}(${f.score} d${f.depth}) ` +
    `pre=${fmt(f.preSearchNodes)} probe=${fmt(f.probeNodes)} ` +
    `calls=${fmt(f.probeCalls)} cap=${fmt(f.probeCapHits)}`;
  if (row.verify) {
    const v = row.verify;
    line += ` | 参照: 時間手=${v.timeMoveScore} 固定手=${v.fixedMoveScore} 差=${v.diff} → ${v.verdict}`;
    if (v.unreliable) {
      line += ` (unreliable: 参照深さ ${v.depths[0]}/${v.depths[1]})`;
    }
  }
  console.log(line);
  console.log(`    棋譜: ${row.record}`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();
  const json = JSON.parse(readFileSync(opts.input, "utf8")) as BenchJson;

  await preloadForbiddenWasm();
  const wasm = await loadWasmModule();
  const support = checkDeterministicSupport(wasm, true);
  if (!support.ok) {
    console.error(`決定的モードが使えません: ${support.reason}`);
    process.exit(1);
  }
  wasm.setDeterministicMode!(1);

  const { hard } = DIFFICULTY_PARAMS;
  const evalFlags = encodeEvalOptionsForWasm(hard.evaluationOptions);

  const allTargets = collectTargets(json);
  const end =
    opts.limit === undefined ? allTargets.length : opts.offset + opts.limit;
  const targets = allTargets.slice(opts.offset, end);

  console.log("=== 時間モード vs 固定ノードモード 着手比較 ===");
  console.log(
    `入力: ${opts.input}（A=${json.commitA?.shortSha ?? "?"} 時間モード / ` +
      `B=${json.commitB?.shortSha ?? "?"} 固定 ${json.config?.fixedNodesB ?? "?"}）`,
  );
  const verifyDesc = opts.verify
    ? ` | verify: N=${opts.verifyNodes}, depth=${opts.verifyDepth}, threshold=${opts.threshold}`
    : "";
  console.log(
    `固定探索: この worktree の wasm、N=${opts.fixedNodes}、depth=${hard.depth}、evalFlags=${evalFlags}${verifyDesc}`,
  );
  console.log(
    `対象: 時間モードの探索手 ${allTargets.length} 手のうち [${opts.offset}, ${end}) の ${targets.length} 手\n`,
  );

  if (opts.out) {
    writeFileSync(opts.out, "");
  }

  const rows: ResultRow[] = [];
  let matched = 0;
  let unreliableCount = 0;
  const verdictCount: Record<Verdict, number> = {
    "fixed-worse": 0,
    "fixed-better": 0,
    similar: 0,
  };
  const totalStart = performance.now();

  for (const target of targets) {
    const outcome = searchDeterministic(
      wasm,
      target.board,
      target.color,
      hard.depth,
      opts.fixedNodes,
      evalFlags,
    );
    const match =
      outcome.position.row === target.timeMove.row &&
      outcome.position.col === target.timeMove.col;
    if (match) {
      matched++;
    }
    const row: ResultRow = {
      gameIndex: target.gameIndex,
      pairId: target.pairId,
      jushuName: target.jushuName,
      ply: target.ply,
      color: target.color,
      record: target.record,
      match,
      time: {
        move: formatMove(target.timeMove),
        score: target.timeScore,
        depth: target.timeDepth,
        ms: Math.round(target.timeMs),
      },
      fixed: {
        move: formatMove(outcome.position),
        score: outcome.score,
        depth: outcome.completedDepth,
        ms: Math.round(outcome.elapsedMs),
        nodes: outcome.stats.nodes,
        preSearchNodes: outcome.stats.preSearchNodes,
        probeNodes: outcome.stats.probeNodes,
        probeCalls: outcome.stats.probeCalls,
        probeCapHits: outcome.stats.probeCapHits,
      },
    };

    if (!match && opts.verify) {
      const t = verifyMove(wasm, target, target.timeMove, opts, evalFlags);
      const f = verifyMove(wasm, target, outcome.position, opts, evalFlags);
      const diff = t.score - f.score;
      const verdict = classify(diff, opts.threshold);
      verdictCount[verdict]++;
      // 参照探索が N 内で hard の depth（7）まで完了していなければ verdict は信用しない
      const unreliable =
        (!t.terminal && t.depth < hard.depth) ||
        (!f.terminal && f.depth < hard.depth);
      if (unreliable) {
        unreliableCount++;
      }
      row.verify = {
        timeMoveScore: t.score,
        fixedMoveScore: f.score,
        diff,
        verdict,
        depths: [t.depth, f.depth],
        unreliable,
      };
    }

    rows.push(row);
    if (opts.out) {
      appendFileSync(opts.out, `${JSON.stringify(row)}\n`);
    }
    if (!match) {
      printMismatch(row);
    }
  }

  const mismatches = rows.filter((r) => !r.match);
  const elapsedSec = ((performance.now() - totalStart) / 1000).toFixed(1);
  console.log("\n=== サマリ ===");
  console.log(
    `対象 ${rows.length} 手 / 一致 ${matched} 手（${rows.length > 0 ? ((matched / rows.length) * 100).toFixed(1) : "-"}%） / ` +
      `不一致 ${mismatches.length} 手 / 所要 ${elapsedSec} s`,
  );
  if (rows.length > 0) {
    const avgTimeDepth =
      rows.reduce((s, r) => s + r.time.depth, 0) / rows.length;
    const avgFixedDepth =
      rows.reduce((s, r) => s + r.fixed.depth, 0) / rows.length;
    console.log(
      `平均深さ: 時間 ${avgTimeDepth.toFixed(2)} / 固定 ${avgFixedDepth.toFixed(2)}`,
    );
  }
  if (opts.verify) {
    console.log(
      `verify（不一致のみ、threshold=${opts.threshold}）: 固定が悪い ${verdictCount["fixed-worse"]} / ` +
        `固定が良い ${verdictCount["fixed-better"]} / 同程度 ${verdictCount.similar}` +
        ` / unreliable（参照深さ < ${hard.depth}）${unreliableCount}`,
    );
  }
  if (opts.out) {
    console.log(`JSONL: ${opts.out}（${rows.length} 行）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
