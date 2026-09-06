/**
 * gen-opening-suite.ts の CLI オプション（純粋: argv → Options）。
 *
 * `--suite-version` が既定と制約の SSoT:
 *   - version 1: 符号層化なし（negativeRatio 0 固定）、ply-check 禁止
 *   - version 2: ply-check 必須（`--ply-check=<jsonl>`）、negativeRatio 既定 0.4
 */
import path from "node:path";

export interface SuiteCliOptions {
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

/** version に依らない既定値 */
export const SUITE_DEFAULTS: Omit<SuiteCliOptions, "negativeRatioMin"> = {
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
  dryRun: false,
  plyLimit: 0,
};

/** version ごとの negativeRatioMin 既定 */
export function defaultNegativeRatio(suiteVersion: number): number {
  return suiteVersion >= 2 ? 0.4 : 0;
}

type Draft = Omit<SuiteCliOptions, "negativeRatioMin"> & {
  negativeRatioMin: number | null;
};

const INT_FLAGS: Record<string, (o: Draft, v: number) => void> = {
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

const FLOAT_FLAGS: Record<string, (o: Draft, v: number) => void> = {
  "--negative-ratio=": (o, v) => {
    o.negativeRatioMin = v;
  },
};

const PATH_FLAGS: Record<string, (o: Draft, p: string) => void> = {
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

const BOOL_FLAGS: Record<string, (o: Draft) => void> = {
  "--dry-run": (o) => {
    o.dryRun = true;
  },
};

function findFlag(
  table: Record<string, unknown>,
  arg: string,
): string | undefined {
  return Object.keys(table).find((f) => arg.startsWith(f));
}

/** argv を Options に変換し、version ごとの既定と制約を適用する。 */
export function parseSuiteArgs(argv: readonly string[]): SuiteCliOptions {
  const draft: Draft = { ...SUITE_DEFAULTS, negativeRatioMin: null };
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
      INT_FLAGS[intFlag]!(draft, v);
    } else if (floatFlag) {
      const v = Number(arg.slice(floatFlag.length));
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`0..1 の数値でない: ${arg}`);
      }
      FLOAT_FLAGS[floatFlag]!(draft, v);
    } else if (pathFlag) {
      PATH_FLAGS[pathFlag]!(draft, path.resolve(arg.slice(pathFlag.length)));
    } else if (boolFlag) {
      boolFlag(draft);
    } else {
      throw new Error(`未知の引数: ${arg}`);
    }
  }
  const negativeRatioMin =
    draft.negativeRatioMin ?? defaultNegativeRatio(draft.suiteVersion);
  const opts: SuiteCliOptions = { ...draft, negativeRatioMin };
  validateSuiteOptions(opts);
  return opts;
}

/** version ごとの制約（parseSuiteArgs から呼ぶ。単体でも使える） */
export function validateSuiteOptions(opts: SuiteCliOptions): void {
  if (opts.suiteVersion === 1) {
    if (opts.plyCheck) {
      throw new Error(
        "--suite-version=1 では ply-check は使えない（v1 は根フィルタのみ）",
      );
    }
    if (opts.negativeRatioMin !== 0) {
      throw new Error(
        "--suite-version=1 では符号層化は使えない（--negative-ratio は 0 のみ）",
      );
    }
  } else if (opts.suiteVersion === 2) {
    if (!opts.plyCheck) {
      throw new Error(
        "--suite-version=2 では --ply-check=<jsonl> が必須（4 手整合フィルタ）",
      );
    }
  } else {
    throw new Error(`未対応の --suite-version: ${opts.suiteVersion}`);
  }
  if (opts.plyCheck && !opts.fromRaw) {
    throw new Error(
      "--ply-check は --from-raw と併用すること（根評価が先に必要）",
    );
  }
}

/**
 * `--ply-limit` のスモーク実行で本番の flips ファイルを上書きしないよう、
 * 拡張子の前に `-smoke` を付ける（例: horizon-flips-v2.jsonl → horizon-flips-v2-smoke.jsonl）。
 */
export function smokeSuffixedPath(file: string): string {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}-smoke${ext}`;
}
