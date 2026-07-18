/**
 * `HANG_INJECT=<gameIdx>:<requestOrdinal>[:A|B]` 環境変数のパーサ。
 *
 * commit-bench でハング注入テスト用に読み取る。ハング注入自体はプロダクション
 * パスに影響しない差し込み口で、bench の回復パス（timeout → dump → respawn）を
 * 手動 e2e で発火させるためのもの。
 *
 * 呼び出し側で process.exit しやすいよう「妥当な値 or エラー」を union で返す。
 */
export interface HangInjectEnv {
  gameIdx: number;
  requestOrdinal: number;
  side?: "A" | "B";
}

export type ParseHangInjectResult =
  | { kind: "ok"; value: HangInjectEnv | null }
  | { kind: "error"; message: string };

/**
 * raw が undefined/"" なら null（無効化＝正常）。値があるが不正なら error。
 * side は "A" | "B" のみ許容、他は error。
 */
export function parseHangInjectEnv(
  raw: string | undefined,
): ParseHangInjectResult {
  if (raw === undefined || raw === "") {
    return { kind: "ok", value: null };
  }
  const parts = raw.split(":");
  if (parts.length !== 2 && parts.length !== 3) {
    return {
      kind: "error",
      message: `HANG_INJECT は "<gameIdx>:<requestOrdinal>[:A|B]" の形式で指定してください (got: ${raw})`,
    };
  }
  const gameIdx = parseInt(parts[0]!, 10);
  const requestOrdinal = parseInt(parts[1]!, 10);
  if (!Number.isFinite(gameIdx) || gameIdx < 0) {
    return {
      kind: "error",
      message: `HANG_INJECT gameIdx が不正 (got: ${parts[0]})`,
    };
  }
  if (!Number.isFinite(requestOrdinal) || requestOrdinal < 1) {
    return {
      kind: "error",
      message: `HANG_INJECT requestOrdinal は 1 以上の整数 (got: ${parts[1]})`,
    };
  }
  const sideRaw = parts.length === 3 ? parts[2]! : undefined;
  if (sideRaw !== undefined && sideRaw !== "A" && sideRaw !== "B") {
    return {
      kind: "error",
      message: `HANG_INJECT side は A か B (got: ${sideRaw})`,
    };
  }
  return {
    kind: "ok",
    value: {
      gameIdx,
      requestOrdinal,
      side: sideRaw as "A" | "B" | undefined,
    },
  };
}
