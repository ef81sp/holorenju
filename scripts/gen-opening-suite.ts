#!/usr/bin/env node
/**
 * 開局スイート生成（bench-precision-2026-09-04.md §2.2「生成」）。
 *
 * opening-book-hard.json の 7 石・白番局面（5,595 件）から、層化順序（root 珠型 →
 * 親=白 3 石構成 → 子、seed 固定）で候補を取り出し、hard 実機の均衡フィルタ
 * （|score| <= scoreAbsMax、白に VCF/VCT 無し、白最善手後に黒に VCF/VCT 無し）を
 * 通ったものを採用件数（既定 600）まで集めて JSON に書き出す。
 *
 * 2 段構成:
 *   1. 評価（重い）: 候補ごとの生評価（score / 勝ち判定）を worker で求める。
 *      `--raw-out` で JSONL に逐次保存（中断しても再利用できる）。
 *   2. 選抜（軽い）: 生評価を `--from-raw` から読み、しきい値・親上限・target で
 *      採否を決める（selectOpenings、純粋）。しきい値の決定（メモ手順 4(i)
 *      「ヒストグラムを見て決める」）を再評価なしにやり直せる。
 *
 * 選抜結果は候補順序に対して決定的（worker の完了順に依らない）。
 *
 * 使用例:
 *   # 全件評価（生評価の保存。しきい値は広めに取っておく）
 *   pnpm gen:opening-suite --parent-cap=100000 --target=100000 --score-max=1000 \
 *     --raw-out=bench-results/opening-suite-raw.jsonl --out=/dev/null
 *   # 生評価から選抜
 *   pnpm gen:opening-suite --from-raw=bench-results/opening-suite-raw.jsonl \
 *     --score-max=300 --parent-cap=6
 *
 * オプション:
 *   --target=<n>       採用件数（既定 600）
 *   --workers=<n>      worker 数（既定 8）
 *   --seed=<n>         シャッフル seed（既定 20260904）
 *   --score-max=<n>    |score| しきい値（既定 300）
 *   --nodes=<n>        root スコア探索の maxNodes（既定 100000）
 *   --depth=<n>        root スコア探索の depth（既定 7）
 *   --parent-cap=<n>   親ごとの上限件数（既定 3）
 *   --out=<path>       出力先（既定 scripts/data/opening-suite-v1.json）
 *   --raw-out=<path>   生評価を JSONL に追記保存（既存分は再利用）
 *   --from-raw=<path>  生評価を読み、worker を起動せずに選抜だけ行う
 */
import { execSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { formatMove } from "@/logic/gameRecordParser";

import type {
  SuiteEvalRequest,
  SuiteEvalResponse,
  SuiteWorkerData,
} from "./gen-opening-suite-worker.ts";
import type {
  OpeningSuiteEntry as SuiteOpening,
  OpeningSuiteFile,
} from "./types/openingSuite.ts";

import {
  boardToPseudoMoves,
  buildCandidateOrder,
  detectRootJushu,
  parentKey,
  parseBoardKey,
  partitionByRaw,
  selectOpenings,
  selectSevenStoneWhiteKeys,
  type EvaluatedCandidate,
  type RawEvaluation,
  type SuiteCandidate,
  type SuiteRejectReason,
} from "./lib/openingSuite.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const BOOK_PATH = path.join(ROOT_DIR, "src/assets/opening-book-hard.json");

interface Options {
  target: number;
  workers: number;
  seed: number;
  scoreAbsMax: number;
  nodes: number;
  depth: number;
  parentCap: number;
  out: string;
  rawOut: string | null;
  fromRaw: string | null;
}

const DEFAULTS: Options = {
  target: 600,
  workers: 8,
  seed: 20260904,
  scoreAbsMax: 300,
  nodes: 100_000,
  depth: 7,
  parentCap: 3,
  out: path.join(ROOT_DIR, "scripts/data/opening-suite-v1.json"),
  rawOut: null,
  fromRaw: null,
};

/**
 * 安全弁。maxNodes が実質上限になるよう十分大きく設定する（forcedWinCheck と同方針）。
 * ただし Zig 側の absolute_time_limit 既定（10,000 ms、#147）で先に頭打ちになる。
 */
const ROOT_TIME_LIMIT_MS = 60_000;

const INT_FLAGS: Record<string, (o: Options, v: number) => void> = {
  "--target=": (o, v) => {
    o.target = v;
  },
  "--workers=": (o, v) => {
    o.workers = Math.max(1, v);
  },
  "--seed=": (o, v) => {
    o.seed = v;
  },
  "--score-max=": (o, v) => {
    o.scoreAbsMax = v;
  },
  "--nodes=": (o, v) => {
    o.nodes = v;
  },
  "--depth=": (o, v) => {
    o.depth = v;
  },
  "--parent-cap=": (o, v) => {
    o.parentCap = v;
  },
};

const PATH_FLAGS: Record<string, (o: Options, p: string) => void> = {
  "--out=": (o, p) => {
    o.out = p;
  },
  "--raw-out=": (o, p) => {
    o.rawOut = p;
  },
  "--from-raw=": (o, p) => {
    o.fromRaw = p;
  },
};

function parseArgs(argv: string[]): Options {
  const opts = { ...DEFAULTS };
  for (const arg of argv) {
    const intFlag = Object.keys(INT_FLAGS).find((f) => arg.startsWith(f));
    const pathFlag = Object.keys(PATH_FLAGS).find((f) => arg.startsWith(f));
    if (intFlag) {
      const v = parseInt(arg.slice(intFlag.length), 10);
      if (!Number.isFinite(v)) {
        throw new Error(`数値でない: ${arg}`);
      }
      INT_FLAGS[intFlag]!(opts, v);
    } else if (pathFlag) {
      PATH_FLAGS[pathFlag]!(opts, path.resolve(arg.slice(pathFlag.length)));
    } else {
      throw new Error(`未知の引数: ${arg}`);
    }
  }
  return opts;
}

interface BookAssetLike {
  weightGeneration?: string;
  entries: Record<string, unknown>;
}

interface SuiteStats {
  /** 7 石・白番の候補総数 */
  candidates: number;
  /** しきい値で分類した候補数（--from-raw では全候補） */
  evaluated: number;
  rejectedByScore: number;
  rejectedByWhiteWin: number;
  rejectedByBlackWin: number;
  /** 採用可能数（層化・target 前）。worker モードでは null */
  eligible: number | null;
  /** 最終採用数（openings.length） */
  accepted: number;
}

/** --raw-out の 1 行。生評価時の設定も残す（再判定可否の判断用）。 */
interface RawRecord extends RawEvaluation {
  key: string;
  parent: string;
  root: string | null;
  scoreAbsMax: number;
  nodes: number;
  depth: number;
}

function gitRev(): string {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: ROOT_DIR,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function loadCandidates(bookPath: string): {
  book: BookAssetLike;
  candidates: SuiteCandidate[];
} {
  const book = JSON.parse(readFileSync(bookPath, "utf8")) as BookAssetLike;
  const keys = selectSevenStoneWhiteKeys(Object.keys(book.entries));
  const candidates = keys.map((key): SuiteCandidate => {
    const { board } = parseBoardKey(key);
    return { key, parent: parentKey(board), root: detectRootJushu(board) };
  });
  return { book, candidates };
}

function loadRaw(file: string): Map<string, RawEvaluation> {
  const map = new Map<string, RawEvaluation>();
  if (!existsSync(file)) {
    return map;
  }
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const r = JSON.parse(line) as RawRecord;
    map.set(r.key, {
      score: r.score,
      bestMove: r.bestMove,
      reject: r.reject,
      elapsedMs: r.elapsedMs,
    });
  }
  return map;
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

/**
 * 未評価の候補を worker に配り、生評価を集める。候補順に配布し、target 件の採用が
 * 候補順で確定した時点で配布を止める（結果は完了順に依らず確定する）。
 */
function evaluateCandidates(
  order: SuiteCandidate[],
  known: Map<string, RawEvaluation>,
  opts: Options,
): Promise<Map<string, RawEvaluation>> {
  const results = new Map(known);
  const workerScript = path.join(__dirname, "gen-opening-suite-worker.ts");
  const workerData: SuiteWorkerData = {
    scoreAbsMax: opts.scoreAbsMax,
    depth: opts.depth,
    nodes: opts.nodes,
    timeLimitMs: ROOT_TIME_LIMIT_MS,
  };
  const startedAt = Date.now();
  let nextDispatch = 0;
  let inFlight = 0;
  let stopped = false;
  let evaluatedCount = 0;

  /** 候補順で確定した採用数（先頭から連続して結果が揃っている範囲） */
  const acceptedPrefix = (): { accepted: number; settled: number } => {
    let accepted = 0;
    let settled = 0;
    for (const c of order) {
      const r = results.get(c.key);
      if (!r) {
        break;
      }
      settled++;
      if (r.reject === null && Math.abs(r.score) <= opts.scoreAbsMax) {
        accepted++;
      }
      if (accepted >= opts.target) {
        break;
      }
    }
    return { accepted, settled };
  };

  return new Promise<Map<string, RawEvaluation>>((resolve, reject) => {
    const workers: Worker[] = [];
    const terminateAll = (): void => {
      for (const w of workers) {
        w.terminate();
      }
    };
    const dispatch = (w: Worker): void => {
      while (
        nextDispatch < order.length &&
        results.has(order[nextDispatch]!.key)
      ) {
        nextDispatch++;
      }
      if (stopped || nextDispatch >= order.length) {
        if (inFlight === 0) {
          terminateAll();
          resolve(results);
        }
        return;
      }
      const req: SuiteEvalRequest = {
        index: nextDispatch,
        key: order[nextDispatch]!.key,
      };
      nextDispatch++;
      inFlight++;
      w.postMessage(req);
    };
    const onResult = (msg: SuiteEvalResponse): void => {
      inFlight--;
      evaluatedCount++;
      const candidate = order[msg.index]!;
      const raw: RawEvaluation = {
        score: msg.score,
        bestMove: msg.bestMove,
        reject: msg.reject,
        elapsedMs: msg.elapsedMs,
      };
      results.set(candidate.key, raw);
      if (opts.rawOut) {
        const rec: RawRecord = {
          ...raw,
          key: candidate.key,
          parent: candidate.parent,
          root: candidate.root,
          scoreAbsMax: opts.scoreAbsMax,
          nodes: opts.nodes,
          depth: opts.depth,
        };
        appendFileSync(opts.rawOut, `${JSON.stringify(rec)}\n`);
      }
      const { accepted, settled } = acceptedPrefix();
      if (accepted >= opts.target) {
        stopped = true;
      }
      if (evaluatedCount % 10 === 0 || stopped) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = evaluatedCount / Math.max(elapsed, 1e-6);
        const remain = order.length - settled;
        log(
          `[${elapsed.toFixed(0)}s] evaluated ${evaluatedCount} (settled ${settled}/${order.length})` +
            ` accepted ${accepted}/${opts.target}` +
            ` (${rate.toFixed(2)}/s, 全件なら残り ${(remain / rate / 60).toFixed(1)}min)`,
        );
      }
    };

    for (let i = 0; i < opts.workers; i++) {
      const w = new Worker(workerScript, {
        workerData,
        execArgv: [
          "--experimental-strip-types",
          "--disable-warning=ExperimentalWarning",
          "--import",
          path.join(__dirname, "register-loader.mjs"),
        ],
      });
      workers.push(w);
      w.on("message", (msg: SuiteEvalResponse | { ready: true }) => {
        if (!("ready" in msg)) {
          onResult(msg);
        }
        dispatch(w);
      });
      w.on("error", (err) => {
        terminateAll();
        reject(err);
      });
    }
  });
}

function computeStats(
  evaluated: EvaluatedCandidate[],
  candidates: number,
): Omit<SuiteStats, "eligible"> {
  const count = (r: SuiteRejectReason | null): number =>
    evaluated.filter((e) => e.reject === r).length;
  return {
    candidates,
    evaluated: evaluated.length,
    rejectedByScore: count("score"),
    rejectedByWhiteWin: count("whiteWin"),
    rejectedByBlackWin: count("blackWin"),
    accepted: count(null),
  };
}

function printHistogram(evaluated: EvaluatedCandidate[], opts: Options): void {
  const bins: [string, (s: number) => boolean][] = [
    ["<= -1000", (s) => s <= -1000],
    ["-999..-500", (s) => s > -1000 && s <= -500],
    ["-499..-300", (s) => s > -500 && s <= -300],
    ["-299..-200", (s) => s > -300 && s <= -200],
    ["-199..-100", (s) => s > -200 && s <= -100],
    ["-99..-1", (s) => s > -100 && s < 0],
    ["0..99", (s) => s >= 0 && s < 100],
    ["100..199", (s) => s >= 100 && s < 200],
    ["200..299", (s) => s >= 200 && s < 300],
    ["300..499", (s) => s >= 300 && s < 500],
    ["500..999", (s) => s >= 500 && s < 1000],
    [">= 1000", (s) => s >= 1000],
  ];
  log("");
  log(
    "白番 root スコアのヒストグラム（評価済み候補、採用 / 白勝ち棄却 / 黒勝ち棄却 / スコア棄却）:",
  );
  for (const [label, pred] of bins) {
    const inBin = evaluated.filter((e) => pred(e.score));
    const acc = inBin.filter((e) => e.reject === null).length;
    const ww = inBin.filter((e) => e.reject === "whiteWin").length;
    const bw = inBin.filter((e) => e.reject === "blackWin").length;
    const sc = inBin.filter((e) => e.reject === "score").length;
    log(
      `  ${label.padStart(11)}: ${String(inBin.length).padStart(5)}  acc ${String(acc).padStart(4)}  wWin ${String(ww).padStart(4)}  bWin ${String(bw).padStart(4)}  score ${String(sc).padStart(4)}`,
    );
  }
  log("");
  log(
    `しきい値別の件数（<= ${opts.scoreAbsMax} は採用数、それ以上は |score| 条件のみ通過する数）:`,
  );
  for (const t of [50, 100, 150, 200, 250, 300, 400, 500, 750, 1000]) {
    const within = evaluated.filter((e) => Math.abs(e.score) <= t);
    if (t <= opts.scoreAbsMax) {
      const acc = within.filter((e) => e.reject === null).length;
      log(`  |score| <= ${String(t).padStart(4)}: accepted ${acc}`);
    } else {
      log(`  |score| <= ${String(t).padStart(4)}: score-pass ${within.length}`);
    }
  }
}

function printDistribution(openings: SuiteOpening[]): void {
  const countBy = (f: (o: SuiteOpening) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const o of openings) {
      const k = f(o);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const roots = countBy((o) => o.root ?? "null");
  const parents = countBy((o) => o.parent);
  log("");
  log(`root 珠型の分布（${roots.length} 種）:`);
  log(`  ${roots.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  const parentHist = new Map<number, number>();
  for (const [, n] of parents) {
    parentHist.set(n, (parentHist.get(n) ?? 0) + 1);
  }
  log(`親（白 3 石）の分布: ${parents.length} 親`);
  log(
    `  親あたり件数: ${[...parentHist.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, c]) => `${n}件×${c}親`)
      .join(", ")}`,
  );
}

interface Selection {
  /** ヒストグラム用: しきい値で分類した評価済み候補（候補順） */
  evaluated: EvaluatedCandidate[];
  accepted: EvaluatedCandidate[];
  /** 全件生評価があるときの採用可能数（層化・target 前）。worker モードでは null */
  eligible: number | null;
}

/**
 * --from-raw: 全候補を生評価で分類し、採用可能な候補だけに層化順序を掛けて target 件
 * 取る（親上限が採用可能数に対して効くので、親の均等性が出力にそのまま出る）。
 */
function selectFromRaw(
  candidates: SuiteCandidate[],
  rawFile: string,
  opts: Options,
): Selection {
  const results = loadRaw(rawFile);
  log(
    `生評価 ${results.size} 件を ${rawFile} から読み込み（worker は起動しない）`,
  );
  const { eligible, counts } = partitionByRaw(
    candidates,
    results,
    opts.scoreAbsMax,
  );
  const order = buildCandidateOrder(eligible, {
    seed: opts.seed,
    parentCap: opts.parentCap,
  });
  log(
    `採用可能 ${counts.accepted} 件（親 ${new Set(eligible.map((c) => c.parent)).size} 種）→ 親上限 ${opts.parentCap} で ${order.length} 件`,
  );
  const { evaluated } = selectOpenings(candidates, results, {
    scoreAbsMax: opts.scoreAbsMax,
    target: Number.POSITIVE_INFINITY,
  });
  const { accepted } = selectOpenings(order, results, {
    scoreAbsMax: opts.scoreAbsMax,
    target: opts.target,
  });
  return { evaluated, accepted, eligible: counts.accepted };
}

/** worker モード: 層化順序で候補を評価し、候補順で target 件採用したところで止める。 */
async function selectWithWorkers(
  candidates: SuiteCandidate[],
  opts: Options,
): Promise<Selection> {
  const order = buildCandidateOrder(candidates, {
    seed: opts.seed,
    parentCap: opts.parentCap,
  });
  const known = opts.rawOut ? loadRaw(opts.rawOut) : new Map();
  if (known.size > 0) {
    log(`生評価 ${known.size} 件を ${opts.rawOut} から再利用`);
  }
  log(`層化後 ${order.length} 件、workers ${opts.workers} で評価開始`);
  const results = await evaluateCandidates(order, known, opts);
  const { evaluated, accepted } = selectOpenings(order, results, {
    scoreAbsMax: opts.scoreAbsMax,
    target: opts.target,
  });
  return { evaluated, accepted, eligible: null };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { book, candidates } = loadCandidates(BOOK_PATH);
  const rootless = candidates.filter((c) => c.root === null).length;
  const parents = new Set(candidates.map((c) => c.parent)).size;
  log(
    `候補 ${candidates.length} 件（親 ${parents} 種、root 不明 ${rootless} 件）、` +
      `target ${opts.target}、score-max ${opts.scoreAbsMax}、parent-cap ${opts.parentCap}、seed ${opts.seed}`,
  );

  const startedAt = Date.now();
  const { evaluated, accepted, eligible } = opts.fromRaw
    ? selectFromRaw(candidates, opts.fromRaw, opts)
    : await selectWithWorkers(candidates, opts);
  const elapsedMs = Date.now() - startedAt;

  const stats: SuiteStats = {
    ...computeStats(evaluated, candidates.length),
    eligible,
    accepted: accepted.length,
  };
  const openings: SuiteOpening[] = accepted.map((e, i) => {
    const { board } = parseBoardKey(e.candidate.key);
    return {
      id: `s1-${String(i + 1).padStart(4, "0")}`,
      root: e.candidate.root,
      parent: e.candidate.parent,
      moves: boardToPseudoMoves(board).map(formatMove).join(" "),
      score: e.score,
    };
  });

  const output: OpeningSuiteFile & Record<string, unknown> = {
    version: 1,
    generatedAt: new Date().toISOString(),
    gitRev: gitRev(),
    weightGeneration: book.weightGeneration ?? null,
    filter: {
      scoreAbsMax: opts.scoreAbsMax,
      nodes: opts.nodes,
      depth: opts.depth,
      parentCap: opts.parentCap,
      seed: opts.seed,
    },
    stats,
    openings,
  };
  mkdirSync(path.dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, `${JSON.stringify(output, null, 2)}\n`);

  log("");
  log(`所要時間 ${(elapsedMs / 1000 / 60).toFixed(1)} min`);
  log(`stats: ${JSON.stringify(stats)}`);
  const times = evaluated.map((e) => e.elapsedMs).sort((a, b) => a - b);
  if (times.length > 0) {
    log(
      `1 件あたり秒数 p50 ${(times[Math.floor(times.length / 2)]! / 1000).toFixed(1)}` +
        ` / p90 ${(times[Math.floor(times.length * 0.9)]! / 1000).toFixed(1)}` +
        ` / max ${(times[times.length - 1]! / 1000).toFixed(1)}`,
    );
  }
  printHistogram(evaluated, opts);
  printDistribution(openings);
  log("");
  log(`出力: ${opts.out}`);
  if (stats.accepted < opts.target) {
    log(
      `警告: 採用数が target に届かなかった（${stats.accepted} < ${opts.target}）`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
