/**
 * commit-bench / weight-bench の CLI 引数に対する純粋な整合性チェック
 * （bench-precision-2026-09-04.md §2.2 の `--openings` まわり）。
 * process.exit や console は呼ばない。文字列を返し、CLI 側で表示・終了する。
 */
import { type CpuDifficulty, DIFFICULTY_PARAMS } from "../../src/types/cpu.ts";

/**
 * 実効 randomFactor。`--randomFactor` 未指定なら difficulty 既定（beginner=0.3 等）が
 * bridge worker で効くので、決定的モードのガードと seed 導出は CLI の明示値ではなく
 * この実効値で判断する（hard は 0）。commit-bench の worktree が別コミットでも、
 * 現リポジトリの DIFFICULTY_PARAMS を代理値として使う。
 */
export function effectiveRandomFactor(
  explicit: number | undefined,
  difficulty: CpuDifficulty,
): number {
  return explicit ?? DIFFICULTY_PARAMS[difficulty].randomFactor;
}

export interface OpeningsFlagsInput {
  /** `--openings=<file>`（未指定なら undefined） */
  openings: string | undefined;
  bookA: boolean;
  bookB: boolean;
  /** `--opening-offset`（未指定・weight-bench では 0） */
  openingOffset?: number;
}

/**
 * `--openings` と `--book-a/--book-b` の併用は不可（スイートはブックの葉なので
 * 白の初手が即ブック手になり非対称）。`--opening-offset` は `--openings` 無しでは
 * 意味が無いので誤用として弾く。問題なければ null。
 */
export function validateOpeningsFlags(
  input: OpeningsFlagsInput,
): string | null {
  const { openings, bookA, bookB, openingOffset = 0 } = input;
  if (openings !== undefined) {
    if (bookA) {
      return "--openings と --book-a は併用できません（スイートはブックの葉であり、白の初手が即ブック手になって非対称になる）";
    }
    if (bookB) {
      return "--openings と --book-b は併用できません（スイートはブックの葉であり、白の初手が即ブック手になって非対称になる）";
    }
    return null;
  }
  if (openingOffset !== 0) {
    return "--opening-offset は --openings と併用してください（珠型モードでは無効）";
  }
  return null;
}

export interface RepeatWarningInput {
  openings: string | undefined;
  sets: number;
  randomFactor: number | undefined;
}

/**
 * スイート指定で sets > 1 かつ randomFactor 無しなら、同一開局の反復が同一棋譜に
 * なりうる旨の warning 文字列を返す。該当しなければ null。
 */
export function openingsRepeatWarning(
  input: RepeatWarningInput,
): string | null {
  const { openings, sets, randomFactor } = input;
  if (openings === undefined || sets <= 1 || randomFactor !== undefined) {
    return null;
  }
  return `--sets=${sets} で開局スイートを周回しますが randomFactor 未指定のため、同一開局の反復は同一棋譜になりえます（独立サンプルとして数えられない）。--randomFactor を指定するか --sets=1 を推奨`;
}

export type MaxGamesNormalization =
  | { ok: true; maxGames: number; warning: string | null }
  | { ok: false; error: string };

/**
 * `--max-games` はペア境界で切る。奇数なら偶数へ切り下げ（warning 付き）。
 * 1 はペアを成せず、0 に丸めると「無効＝全局」になってしまうのでエラー。
 */
export function normalizeMaxGames(value: number): MaxGamesNormalization {
  if (value === 1) {
    return {
      ok: false,
      error:
        "--max-games=1 は指定できません（ペア境界で切るため 2 以上の偶数、または 0=無効）",
    };
  }
  if (value % 2 === 1) {
    const even = value - 1;
    return {
      ok: true,
      maxGames: even,
      warning: `--max-games=${value} は奇数のためペア境界の ${even} 局に切り下げます`,
    };
  }
  return { ok: true, maxGames: value, warning: null };
}

// ============================================================================
// 固定ノード（決定的探索）モード — bench-fixed-nodes-2026-09-06.md §2.5
// ============================================================================

/**
 * `--fixed-nodes` を値なしで指定したときの既定 N（SSoT）。
 * bench-fixed-nodes-2026-09-06.md §7.13: プローブ上限 6k のもとで、時間モード hard
 * （jobs=5）との混合対局 416 局が Elo +5.8 [−15.3, +27.0]（有意差なし）になる N。
 * 2.5M は時間モードより +53 強く、0.6M は −26 弱い（§7.11〜7.12）。
 */
export const FIXED_NODES_DEFAULT = 1_200_000;

export type FixedNodesFlagParse =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * `--fixed-nodes[=N]` 系フラグ 1 個の値を解釈する（`--fixed-nodes-a/-b` も同じ規則）。
 * - `flagName` そのもの（値なし） → `FIXED_NODES_DEFAULT`
 * - `flagName=N`（正の整数） → N
 * - それ以外 → error
 */
export function parseFixedNodesFlag(
  arg: string,
  flagName: string,
): FixedNodesFlagParse {
  if (arg === flagName) {
    return { ok: true, value: FIXED_NODES_DEFAULT };
  }
  const prefix = `${flagName}=`;
  if (!arg.startsWith(prefix)) {
    return { ok: false, error: `${flagName} の形式が不正です (got: ${arg})` };
  }
  const raw = arg.slice(prefix.length);
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      error: `${flagName} は正の整数で指定（値なしなら既定 ${FIXED_NODES_DEFAULT}） (got: ${raw})`,
    };
  }
  return { ok: true, value };
}

/** 固定ノードモードで bridge worker に渡す探索パラメータ。 */
export interface FixedNodesParams {
  /** 0 = 時間を見ない（決定的モードでは wasm 側で time_limit=0 扱い） */
  timeLimit: 0;
  maxNodes: number;
  deterministic: true;
}

/**
 * `--fixed-nodes=N` → `{ timeLimit: 0, maxNodes: N, deterministic: true }`。
 * 未指定なら undefined（時間モードのまま）。
 */
export function resolveFixedNodesParams(
  fixedNodes: number | undefined,
): FixedNodesParams | undefined {
  if (fixedNodes === undefined) {
    return undefined;
  }
  return { timeLimit: 0, maxNodes: fixedNodes, deterministic: true };
}

export interface FixedNodesFlagsInput {
  /** `--fixed-nodes=N`（両側） */
  fixedNodes?: number;
  /** `--fixed-nodes-a=N` / `--fixed-nodes-b=N`（片側。時間 vs 固定の混合＝較正用） */
  fixedNodesA?: number;
  fixedNodesB?: number;
}

/**
 * 両側指定と片側指定を side 別の N に正規化する。両方を同時に指定したら Error。
 */
export function resolveFixedNodesPerSide(input: FixedNodesFlagsInput): {
  a: number | undefined;
  b: number | undefined;
} {
  const { fixedNodes, fixedNodesA, fixedNodesB } = input;
  if (
    fixedNodes !== undefined &&
    (fixedNodesA !== undefined || fixedNodesB !== undefined)
  ) {
    throw new Error(
      "--fixed-nodes と --fixed-nodes-a/--fixed-nodes-b は併用できません（両側なら --fixed-nodes、片側なら -a/-b のどちらか）",
    );
  }
  if (fixedNodes !== undefined) {
    return { a: fixedNodes, b: fixedNodes };
  }
  return { a: fixedNodesA, b: fixedNodesB };
}

export interface FixedNodesValidationInput {
  fixedNodesA: number | undefined;
  fixedNodesB: number | undefined;
  maxNodesA: number | undefined;
  maxNodesB: number | undefined;
  bookA: boolean;
  bookB: boolean;
  /** **実効** randomFactor（effectiveRandomFactor。CLI 未指定なら difficulty 既定） */
  randomFactor: number | undefined;
  /** `--seed` が CLI で明示されたか（既定 Date.now() は「明示」ではない） */
  seedExplicit: boolean;
  sets: number;
}

/**
 * 固定ノードモードの排他・必須チェック（どちらかの側でも固定なら適用）。
 * - `--max-nodes-a/b` との併用: maxNodes は fixedNodes が決めるので二重指定は誤用
 * - `--book-a/b` との併用: ブックの randomPool は Math.random で決定性が壊れる
 * - `randomFactor > 0` は `--seed` 必須: seed 無しの bridge worker は Math.random
 * - `--sets > 1` は randomFactor 無しではエラー: 同一棋譜の反復で独立サンプルにならない
 * 問題なければ null。
 */
export function validateFixedNodesFlags(
  input: FixedNodesValidationInput,
): string | null {
  const {
    fixedNodesA,
    fixedNodesB,
    maxNodesA,
    maxNodesB,
    bookA,
    bookB,
    randomFactor,
    seedExplicit,
    sets,
  } = input;
  if (fixedNodesA === undefined && fixedNodesB === undefined) {
    return null;
  }
  if (maxNodesA !== undefined) {
    return "--fixed-nodes(-a) と --max-nodes-a は併用できません（maxNodes は fixedNodes が決める）";
  }
  if (maxNodesB !== undefined) {
    return "--fixed-nodes(-b) と --max-nodes-b は併用できません（maxNodes は fixedNodes が決める）";
  }
  if (bookA) {
    return "--fixed-nodes と --book-a は併用できません（ブックの randomPool は Math.random で決定性が壊れる）";
  }
  if (bookB) {
    return "--fixed-nodes と --book-b は併用できません（ブックの randomPool は Math.random で決定性が壊れる）";
  }
  const randomized = randomFactor !== undefined && randomFactor > 0;
  if (randomized && !seedExplicit) {
    return "--fixed-nodes で randomFactor > 0 を使うには --seed が必須です（seed 無しの bridge worker は Math.random で決定性が壊れる）";
  }
  if (sets > 1 && !randomized) {
    return `--fixed-nodes で --sets=${sets} は randomFactor（> 0、--seed 付き）無しでは指定できません（同一開局の反復が同一棋譜になり独立サンプルとして数えられない）`;
  }
  return null;
}

/** 決定的モードの `--move-timeout-ms` 既定（1 手時間が N と負荷に比例して伸びるため）。 */
export const DETERMINISTIC_MOVE_TIMEOUT_MS = 600_000;

/**
 * 1 手タイムアウトの決定。明示指定 > 決定的モード既定 600,000 > CLI 既定。
 */
export function resolveMoveTimeoutMs(
  explicit: number | undefined,
  deterministic: boolean,
  cliDefault: number,
): number {
  if (explicit !== undefined) {
    return explicit;
  }
  return deterministic ? DETERMINISTIC_MOVE_TIMEOUT_MS : cliDefault;
}
