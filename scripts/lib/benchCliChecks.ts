/**
 * commit-bench / weight-bench の CLI 引数に対する純粋な整合性チェック
 * （bench-precision-2026-09-04.md §2.2 の `--openings` まわり）。
 * process.exit や console は呼ばない。文字列を返し、CLI 側で表示・終了する。
 */

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
