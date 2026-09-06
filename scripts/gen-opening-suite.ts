#!/usr/bin/env node
/**
 * 開局スイート生成（bench-precision-2026-09-04.md §2.2「生成」、§5.2 の v2）。
 *
 * opening-book-hard.json の 7 石・白番局面（5,595 件）から、層化順序（root 珠型 →
 * 親=白 3 石構成 → 子、seed 固定）で候補を取り出し、hard 実機の均衡フィルタ
 * （|score| <= scoreAbsMax、白に VCF/VCT 無し、白最善手後に黒に VCF/VCT 無し）を
 * 通ったものを採用件数（既定 600）まで集めて JSON に書き出す。
 *
 * 段構成:
 *   1. 根評価（重い）: 候補ごとの生評価（score / 勝ち判定）を worker で求める。
 *      `--raw-out` で JSONL に逐次保存（中断しても再利用できる）。
 *   2. ply-check（v2、`--ply-check=<jsonl>` 指定時、`--from-raw` と併用）: 根フィルタの
 *      採用可能候補を hard 実機で交互に N 手（既定 4）進め、各手の score と途中終局を
 *      記録して JSONL に逐次保存。全 ply が |score| <= plyScoreAbsMax（既定 700）かつ
 *      終局なしのものだけ残す。深さ 7 の根評価では見えない決着済み局面を除くため。
 *   3. 選抜（軽い）: 親上限・root→親→子ラウンドロビン → 根 score の符号で層化
 *      （負側=黒有利を negativeRatioMin 以上、既定 0.4）→ target 件。
 *
 * 選抜結果は候補順序に対して決定的（worker の完了順に依らない）。
 *
 * 使用例:
 *   # 全件根評価（生評価の保存。しきい値は広めに取っておく）
 *   pnpm gen:opening-suite --parent-cap=100000 --target=100000 --score-max=1000 \
 *     --raw-out=bench-results/opening-suite-raw-v1.jsonl --out=/dev/null
 *   # v1 の再生成（符号層化なし）
 *   pnpm gen:opening-suite --from-raw=bench-results/opening-suite-raw-v1.jsonl \
 *     --suite-version=1 --negative-ratio=0
 *   # v2: ply-check を掛けて件数だけ確認（--dry-run）→ 書き出し
 *   pnpm gen:opening-suite --from-raw=bench-results/opening-suite-raw-v1.jsonl \
 *     --ply-check=bench-results/opening-suite-plycheck-v2.jsonl \
 *     --flips-out=bench-results/horizon-flips-v2.jsonl --dry-run
 *
 * オプション:
 *   --target=<n>          採用件数（既定 600）
 *   --workers=<n>         worker 数（既定 8）
 *   --seed=<n>            シャッフル seed（既定 20260904）
 *   --score-max=<n>       根 |score| しきい値（既定 500）
 *   --nodes=<n>           根スコア探索の maxNodes（既定 100000）
 *   --depth=<n>           根スコア探索の depth（既定 7）
 *   --parent-cap=<n>      親ごとの上限件数（既定 8）
 *   --suite-version=<n>   出力の version / id 接頭辞 / 既定の出力先（既定 2）
 *   --out=<path>          出力先（既定 scripts/data/opening-suite-v<version>.json）
 *   --raw-out=<path>      根評価を JSONL に追記保存（既存分は再利用）
 *   --from-raw=<path>     根評価を読み、根評価 worker を起動せずに選抜する
 *   --ply-check=<path>    ply-check 結果の JSONL（追記・再開可能）。指定時のみ ply-check 段が有効
 *   --plies=<n>           ply-check で進める手数（既定 4）
 *   --ply-score-max=<n>   各 ply の |score| しきい値（既定 700）
 *   --flip-score=<n>      horizon flip の |score| 下限（既定 2000）
 *   --flips-out=<path>    flip 局面の一覧 JSONL（毎回上書き）
 *   --negative-ratio=<r>  負側（黒有利）の最小比率（既定 0.4、0 で符号層化なし）
 *   --dry-run             集計だけ表示して JSON を書かない
 *   --ply-limit=<n>       ply-check 対象を先頭 n 件に絞る（スモークテスト用）
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

import { formatMove } from "@/logic/gameRecordParser";

import type {
  SuiteEvalRequest,
  SuiteEvalResponse,
  SuitePlyRequest,
  SuitePlyResponse,
  SuiteWorkerData,
} from "./gen-opening-suite-worker.ts";
import type {
  GeneratedOpeningSuiteFile,
  OpeningSuiteEntry as SuiteOpening,
  OpeningSuitePlyCheckStats,
  OpeningSuiteStats as SuiteStats,
} from "./types/openingSuite.ts";

import {
  assertRawMeta,
  boardToPseudoMoves,
  buildCandidateOrder,
  classifyPlyCheck,
  classifyRaw,
  detectRootJushu,
  isHorizonFlip,
  parentKey,
  parseBoardKey,
  parsePlyCheckLines,
  parseRawLines,
  partitionByRaw,
  selectOpenings,
  selectSevenStoneWhiteKeys,
  stratifyBySign,
  type EvaluatedCandidate,
  type PlyCheckMeta,
  type PlyCheckRecord,
  type PlyCheckResult,
  type RawEvaluation,
  type RawMeta,
  type RawRecord,
  type SignedCandidate,
  type SuiteCandidate,
  type SuiteRejectReason,
} from "./lib/openingSuite.ts";
import {
  distributionLines,
  histogramLines,
  parentStats,
  timingLine,
} from "./lib/openingSuiteReport.ts";
import { runWorkerPool } from "./lib/suiteWorkerPool.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const BOOK_PATH = path.join(ROOT_DIR, "src/assets/opening-book-hard.json");
const WORKER_SCRIPT = path.join(__dirname, "gen-opening-suite-worker.ts");
const WORKER_EXEC_ARGV = [
  "--experimental-strip-types",
  "--disable-warning=ExperimentalWarning",
  "--import",
  path.join(__dirname, "register-loader.mjs"),
];

interface Options {
  target: number;
  workers: number;
  seed: number;
  scoreAbsMax: number;
  nodes: number;
  depth: number;
  parentCap: number;
  suiteVersion: number;
  out: string | null;
  rawOut: string | null;
  fromRaw: string | null;
  plyCheck: string | null;
  plies: number;
  plyScoreAbsMax: number;
  flipScoreAbsMin: number;
  flipsOut: string | null;
  negativeRatioMin: number;
  dryRun: boolean;
  /** ply-check 対象を先頭 n 件に絞る（スモークテスト用。0 で無制限） */
  plyLimit: number;
}

const DEFAULTS: Options = {
  target: 600,
  workers: 8,
  seed: 20260904,
  scoreAbsMax: 500,
  nodes: 100_000,
  depth: 7,
  parentCap: 8,
  suiteVersion: 2,
  out: null,
  rawOut: null,
  fromRaw: null,
  plyCheck: null,
  plies: 4,
  plyScoreAbsMax: 700,
  flipScoreAbsMin: 2000,
  flipsOut: null,
  negativeRatioMin: 0.4,
  dryRun: false,
  plyLimit: 0,
};

/**
 * root スコア探索の timeLimit。forcedWinCheck と同じく「maxNodes を実質上限にする」
 * つもりの値だが、実態は Zig 側の absolute_time_limit 既定 10,000 ms（main.zig、#147）
 * が先に効く: v1 生成では p90 が 10.0 s に張り付き、5,595 件中 1,350 件（24%）が
 * 100k ノード未達のまま時間打ち切りになった。その分の score は負荷依存（ノード決定的
 * でない）。
 */
const ROOT_TIME_LIMIT_MS = 60_000;
/** ply-check の 1 手の timeLimit（絶対上限 10 s と同じ値にして意図を明示） */
const PLY_TIME_LIMIT_MS = 10_000;

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
  "--suite-version=": (o, v) => {
    o.suiteVersion = v;
  },
  "--plies=": (o, v) => {
    o.plies = v;
  },
  "--ply-score-max=": (o, v) => {
    o.plyScoreAbsMax = v;
  },
  "--flip-score=": (o, v) => {
    o.flipScoreAbsMin = v;
  },
  "--ply-limit=": (o, v) => {
    o.plyLimit = v;
  },
};

const FLOAT_FLAGS: Record<string, (o: Options, v: number) => void> = {
  "--negative-ratio=": (o, v) => {
    o.negativeRatioMin = v;
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
  "--ply-check=": (o, p) => {
    o.plyCheck = p;
  },
  "--flips-out=": (o, p) => {
    o.flipsOut = p;
  },
};

const BOOL_FLAGS: Record<string, (o: Options) => void> = {
  "--dry-run": (o) => {
    o.dryRun = true;
  },
};

function parseArgs(argv: string[]): Options {
  const opts = { ...DEFAULTS };
  const findFlag = (
    table: Record<string, unknown>,
    arg: string,
  ): string | undefined => Object.keys(table).find((f) => arg.startsWith(f));
  for (const arg of argv) {
    const intFlag = findFlag(INT_FLAGS, arg);
    const floatFlag = findFlag(FLOAT_FLAGS, arg);
    const pathFlag = findFlag(PATH_FLAGS, arg);
    const boolFlag = BOOL_FLAGS[arg];
    if (intFlag) {
      const v = parseInt(arg.slice(intFlag.length), 10);
      if (!Number.isFinite(v)) {
        throw new Error(`数値でない: ${arg}`);
      }
      INT_FLAGS[intFlag]!(opts, v);
    } else if (floatFlag) {
      const v = Number(arg.slice(floatFlag.length));
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`0..1 の数値でない: ${arg}`);
      }
      FLOAT_FLAGS[floatFlag]!(opts, v);
    } else if (pathFlag) {
      PATH_FLAGS[pathFlag]!(opts, path.resolve(arg.slice(pathFlag.length)));
    } else if (boolFlag) {
      boolFlag(opts);
    } else {
      throw new Error(`未知の引数: ${arg}`);
    }
  }
  if (opts.plyCheck && !opts.fromRaw) {
    throw new Error(
      "--ply-check は --from-raw と併用すること（根評価が先に必要）",
    );
  }
  return opts;
}

interface BookAssetLike {
  weightGeneration?: string;
  entries: Record<string, unknown>;
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

function loadRaw(file: string): {
  results: Map<string, RawEvaluation>;
  meta: RawMeta | null;
} {
  if (!existsSync(file)) {
    return { results: new Map(), meta: null };
  }
  return parseRawLines(readFileSync(file, "utf8"));
}

function loadPlyCheck(file: string): {
  results: Map<string, PlyCheckResult>;
  meta: PlyCheckMeta | null;
} {
  if (!existsSync(file)) {
    return { results: new Map(), meta: null };
  }
  return parsePlyCheckLines(readFileSync(file, "utf8"));
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function workerData(opts: Options): SuiteWorkerData {
  return {
    scoreAbsMax: opts.scoreAbsMax,
    depth: opts.depth,
    nodes: opts.nodes,
    timeLimitMs: ROOT_TIME_LIMIT_MS,
    plyCheck: {
      plies: opts.plies,
      nodes: opts.nodes,
      depth: opts.depth,
      timeLimitMs: PLY_TIME_LIMIT_MS,
    },
  };
}

/**
 * 未評価の候補を worker に配り、根評価を集める。候補順に配布し、target 件の採用が
 * 候補順で確定した時点で配布を止める（結果は完了順に依らず確定する）。
 */
async function evaluateCandidates(
  order: SuiteCandidate[],
  known: Map<string, RawEvaluation>,
  opts: Options,
): Promise<Map<string, RawEvaluation>> {
  const results = new Map(known);
  const startedAt = Date.now();
  let nextDispatch = 0;
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
      if (classifyRaw(r, c, opts.scoreAbsMax) === null) {
        accepted++;
      }
      if (accepted >= opts.target) {
        break;
      }
    }
    return { accepted, settled };
  };

  await runWorkerPool<SuiteEvalRequest, SuiteEvalResponse>({
    workerScript: WORKER_SCRIPT,
    workerData: workerData(opts),
    workers: opts.workers,
    execArgv: WORKER_EXEC_ARGV,
    next: () => {
      while (
        nextDispatch < order.length &&
        results.has(order[nextDispatch]!.key)
      ) {
        nextDispatch++;
      }
      if (stopped || nextDispatch >= order.length) {
        return null;
      }
      const req: SuiteEvalRequest = {
        kind: "eval",
        index: nextDispatch,
        key: order[nextDispatch]!.key,
      };
      nextDispatch++;
      return req;
    },
    onResult: (msg) => {
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
    },
  });
  return results;
}

/** 根フィルタ通過候補のうち ply-check 未実施のものを worker で進め、JSONL に追記する。 */
async function runPlyCheck(
  eligible: SuiteCandidate[],
  rawResults: ReadonlyMap<string, RawEvaluation>,
  file: string,
  opts: Options,
): Promise<Map<string, PlyCheckResult>> {
  const { results, meta } = loadPlyCheck(file);
  const wanted: PlyCheckMeta = {
    pliesRequested: opts.plies,
    nodes: opts.nodes,
    depth: opts.depth,
    timeLimitMs: PLY_TIME_LIMIT_MS,
  };
  if (meta && JSON.stringify(meta) !== JSON.stringify(wanted)) {
    throw new Error(
      `ply-check の既存結果 ${JSON.stringify(meta)} が今回の設定 ${JSON.stringify(wanted)} と不一致。別ファイルを指定すること`,
    );
  }
  const todo = eligible.filter((c) => !results.has(c.key));
  log(
    `ply-check: 対象 ${eligible.length} 件、既存 ${eligible.length - todo.length} 件、残り ${todo.length} 件（${opts.plies} 手、workers ${opts.workers}）`,
  );
  if (todo.length === 0) {
    return results;
  }
  const startedAt = Date.now();
  let next = 0;
  let done = 0;
  await runWorkerPool<SuitePlyRequest, SuitePlyResponse>({
    workerScript: WORKER_SCRIPT,
    workerData: workerData(opts),
    workers: opts.workers,
    execArgv: WORKER_EXEC_ARGV,
    next: () => {
      if (next >= todo.length) {
        return null;
      }
      const req: SuitePlyRequest = {
        kind: "ply",
        index: next,
        key: todo[next]!.key,
      };
      next++;
      return req;
    },
    onResult: (msg) => {
      done++;
      const candidate = todo[msg.index]!;
      results.set(candidate.key, msg.result);
      const rec: PlyCheckRecord = {
        ...msg.result,
        key: candidate.key,
        rootScore: rawResults.get(candidate.key)?.score ?? Number.NaN,
        ...wanted,
      };
      appendFileSync(file, `${JSON.stringify(rec)}\n`);
      if (done % 10 === 0 || done === todo.length) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = done / Math.max(elapsed, 1e-6);
        log(
          `[${elapsed.toFixed(0)}s] ply-check ${done}/${todo.length} (${rate.toFixed(2)}/s, 残り ${((todo.length - done) / rate / 60).toFixed(1)}min)`,
        );
      }
    },
  });
  return results;
}

interface Selection {
  /** ヒストグラム用: しきい値で分類した評価済み候補（候補順） */
  evaluated: EvaluatedCandidate[];
  /** 採用（層化・符号層化後、target 件まで） */
  picked: SignedCandidate[];
  /** 全件根評価があるときの採用可能数（層化・target 前）。worker モードでは null */
  eligible: number | null;
  plyCheck: OpeningSuitePlyCheckStats | null;
  sign: { negative: number; nonNegative: number } | null;
}

/** ply-check 結果で採用可能候補を絞り、集計と flip 一覧を作る。 */
function applyPlyCheck(
  eligible: SuiteCandidate[],
  rawResults: ReadonlyMap<string, RawEvaluation>,
  plyResults: ReadonlyMap<string, PlyCheckResult>,
  opts: Options,
): {
  passed: SuiteCandidate[];
  stats: OpeningSuitePlyCheckStats;
  flips: PlyCheckRecord[];
} {
  const stats: OpeningSuitePlyCheckStats = {
    checked: eligible.length,
    passed: 0,
    rejectedByPlyScore: Array.from({ length: opts.plies }, () => 0),
    rejectedByTerminal: 0,
    rejectedIncomplete: 0,
    horizonFlips: 0,
    flipScoreAbsMin: opts.flipScoreAbsMin,
  };
  const passed: SuiteCandidate[] = [];
  const flips: PlyCheckRecord[] = [];
  for (const c of eligible) {
    const r = plyResults.get(c.key);
    if (!r) {
      throw new Error(`ply-check 未実施の候補: ${c.key}`);
    }
    const rootScore = rawResults.get(c.key)!.score;
    const { reject, atPly } = classifyPlyCheck(r, {
      plyScoreAbsMax: opts.plyScoreAbsMax,
      pliesRequired: opts.plies,
    });
    switch (reject) {
      case null:
        stats.passed++;
        passed.push(c);
        break;
      case "plyScore":
        stats.rejectedByPlyScore[(atPly ?? 1) - 1]!++;
        break;
      case "terminal":
        stats.rejectedByTerminal++;
        break;
      case "incomplete":
        stats.rejectedIncomplete++;
        break;
      default: {
        const never: never = reject;
        throw new Error(`未知の棄却理由: ${String(never)}`);
      }
    }
    if (
      isHorizonFlip(rootScore, r.plies, {
        rootScoreAbsMax: opts.scoreAbsMax,
        flipScoreAbsMin: opts.flipScoreAbsMin,
      })
    ) {
      stats.horizonFlips++;
      flips.push({
        ...r,
        key: c.key,
        rootScore,
        pliesRequested: opts.plies,
        nodes: opts.nodes,
        depth: opts.depth,
        timeLimitMs: PLY_TIME_LIMIT_MS,
      });
    }
  }
  return { passed, stats, flips };
}

/** 層化順序 → 符号層化 → target 件 */
function pickFromEligible(
  eligible: SuiteCandidate[],
  rawResults: ReadonlyMap<string, RawEvaluation>,
  opts: Options,
): { picked: SignedCandidate[]; sign: Selection["sign"]; ordered: number } {
  const order = buildCandidateOrder(eligible, {
    seed: opts.seed,
    parentCap: opts.parentCap,
  });
  const signed: SignedCandidate[] = order.map((c) => ({
    candidate: c,
    rootScore: rawResults.get(c.key)!.score,
  }));
  if (opts.negativeRatioMin <= 0) {
    return {
      picked: signed.slice(0, opts.target),
      sign: null,
      ordered: order.length,
    };
  }
  const r = stratifyBySign(signed, {
    target: opts.target,
    negativeRatioMin: opts.negativeRatioMin,
  });
  return {
    picked: r.picked,
    sign: { negative: r.negativeCount, nonNegative: r.nonNegativeCount },
    ordered: order.length,
  };
}

/**
 * --from-raw: 全候補を根評価で分類し、（--ply-check があれば ply-check で絞り）
 * 採用可能な候補だけに層化順序を掛けて target 件取る。
 */
async function selectFromRaw(
  candidates: SuiteCandidate[],
  rawFile: string,
  opts: Options,
): Promise<Selection> {
  const { results, meta } = loadRaw(rawFile);
  if (!meta) {
    throw new Error(`生評価が空: ${rawFile}`);
  }
  assertRawMeta(meta, opts);
  log(
    `生評価 ${results.size} 件を ${rawFile} から読み込み（根評価 worker は起動しない）`,
  );
  const { eligible, counts } = partitionByRaw(
    candidates,
    results,
    opts.scoreAbsMax,
  );
  log(
    `根フィルタ通過 ${counts.accepted} 件（親 ${new Set(eligible.map((c) => c.parent)).size} 種）`,
  );
  const { evaluated } = selectOpenings(candidates, results, {
    scoreAbsMax: opts.scoreAbsMax,
    target: Number.POSITIVE_INFINITY,
  });

  let pool = eligible;
  let plyStats: OpeningSuitePlyCheckStats | null = null;
  if (opts.plyCheck) {
    const targets =
      opts.plyLimit > 0 ? eligible.slice(0, opts.plyLimit) : eligible;
    const plyResults = await runPlyCheck(targets, results, opts.plyCheck, opts);
    const { passed, stats, flips } = applyPlyCheck(
      targets,
      results,
      plyResults,
      opts,
    );
    pool = passed;
    plyStats = stats;
    log(
      `ply-check: 通過 ${stats.passed} / ${stats.checked}（ply 別 |score|>${opts.plyScoreAbsMax} 棄却 [${stats.rejectedByPlyScore.join(", ")}]、終局 ${stats.rejectedByTerminal}、手数不足 ${stats.rejectedIncomplete}、flip(>${opts.flipScoreAbsMin}) ${stats.horizonFlips}）`,
    );
    if (opts.flipsOut) {
      mkdirSync(path.dirname(opts.flipsOut), { recursive: true });
      writeFileSync(
        opts.flipsOut,
        flips.map((f) => JSON.stringify(f)).join("\n") +
          (flips.length ? "\n" : ""),
      );
      log(`horizon flips ${flips.length} 件を ${opts.flipsOut} に書き出し`);
    }
  }

  const { picked, sign, ordered } = pickFromEligible(pool, results, opts);
  const signNote = sign
    ? `（負側 ${sign.negative} / 非負側 ${sign.nonNegative}）`
    : "";
  log(
    `層化: 採用可能 ${pool.length} 件 → 親上限 ${opts.parentCap} で ${ordered} 件 → 採用 ${picked.length} 件${signNote}`,
  );
  return {
    evaluated,
    picked,
    eligible: counts.accepted,
    plyCheck: plyStats,
    sign,
  };
}

/** worker モード: 層化順序で候補を根評価し、候補順で target 件採用したところで止める。 */
async function selectWithWorkers(
  candidates: SuiteCandidate[],
  opts: Options,
): Promise<Selection> {
  const order = buildCandidateOrder(candidates, {
    seed: opts.seed,
    parentCap: opts.parentCap,
  });
  const { results: known, meta } = opts.rawOut
    ? loadRaw(opts.rawOut)
    : { results: new Map<string, RawEvaluation>(), meta: null };
  if (meta) {
    assertRawMeta(meta, opts);
  }
  if (known.size > 0) {
    log(`生評価 ${known.size} 件を ${opts.rawOut} から再利用`);
  }
  log(`層化後 ${order.length} 件、workers ${opts.workers} で評価開始`);
  const results = await evaluateCandidates(order, known, opts);
  const { evaluated, accepted } = selectOpenings(order, results, {
    scoreAbsMax: opts.scoreAbsMax,
    target: opts.target,
  });
  return {
    evaluated,
    picked: accepted.map((e) => ({
      candidate: e.candidate,
      rootScore: e.score,
    })),
    eligible: null,
    plyCheck: null,
    sign: null,
  };
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

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const outPath =
    opts.out ??
    path.join(
      ROOT_DIR,
      `scripts/data/opening-suite-v${opts.suiteVersion}.json`,
    );
  const { book, candidates } = loadCandidates(BOOK_PATH);
  const rootless = candidates.filter((c) => c.root === null).length;
  const parents = new Set(candidates.map((c) => c.parent)).size;
  const plyNote = opts.plyCheck
    ? `、ply-check ${opts.plies} 手 / |score|<=${opts.plyScoreAbsMax}`
    : "";
  log(
    `候補 ${candidates.length} 件（親 ${parents} 種、root 不明 ${rootless} 件）、target ${opts.target}、score-max ${opts.scoreAbsMax}、parent-cap ${opts.parentCap}、seed ${opts.seed}、version ${opts.suiteVersion}、negative-ratio ${opts.negativeRatioMin}${plyNote}`,
  );

  const startedAt = Date.now();
  const sel = opts.fromRaw
    ? await selectFromRaw(candidates, opts.fromRaw, opts)
    : await selectWithWorkers(candidates, opts);
  const elapsedMs = Date.now() - startedAt;

  const openings: SuiteOpening[] = sel.picked.map((p, i) => {
    const { board } = parseBoardKey(p.candidate.key);
    return {
      id: `s${opts.suiteVersion}-${String(i + 1).padStart(4, "0")}`,
      root: p.candidate.root,
      parent: p.candidate.parent,
      moves: boardToPseudoMoves(board).map(formatMove).join(" "),
      score: p.rootScore,
    };
  });
  const stats: SuiteStats = {
    ...computeStats(sel.evaluated, candidates.length),
    eligible: sel.eligible,
    accepted: openings.length,
    ...(sel.plyCheck ? { plyCheck: sel.plyCheck } : {}),
    ...(sel.sign
      ? {
          sign: {
            ...sel.sign,
            negativeRatio:
              openings.length === 0 ? 0 : sel.sign.negative / openings.length,
          },
        }
      : {}),
    parents: parentStats(openings),
  };

  const output: GeneratedOpeningSuiteFile = {
    version: opts.suiteVersion,
    generatedAt: new Date().toISOString(),
    gitRev: gitRev(),
    weightGeneration: book.weightGeneration ?? null,
    filter: {
      scoreAbsMax: opts.scoreAbsMax,
      nodes: opts.nodes,
      depth: opts.depth,
      parentCap: opts.parentCap,
      seed: opts.seed,
      ...(opts.plyCheck
        ? {
            plyCheck: {
              plies: opts.plies,
              plyScoreAbsMax: opts.plyScoreAbsMax,
              nodes: opts.nodes,
              depth: opts.depth,
              timeLimitMs: PLY_TIME_LIMIT_MS,
            },
          }
        : {}),
      ...(opts.negativeRatioMin > 0
        ? { negativeRatioMin: opts.negativeRatioMin }
        : {}),
    },
    stats,
    openings,
  };

  log("");
  log(`所要時間 ${(elapsedMs / 1000 / 60).toFixed(1)} min`);
  log(`stats: ${JSON.stringify(stats)}`);
  const timing = timingLine(sel.evaluated.map((e) => e.elapsedMs));
  if (timing) {
    log(`根評価の ${timing}`);
  }
  for (const line of histogramLines(sel.evaluated, opts.scoreAbsMax)) {
    log(line);
  }
  for (const line of distributionLines(openings)) {
    log(line);
  }
  log("");
  if (opts.dryRun) {
    log(`--dry-run: ${outPath} は書き出さない`);
  } else {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
    log(`出力: ${outPath}`);
  }
  if (openings.length < opts.target) {
    log(
      `警告: 採用数が target に届かなかった（${openings.length} < ${opts.target}）`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
