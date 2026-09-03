/**
 * ベンチ棋譜の集計（純粋関数）。
 *
 * - distinct 棋譜数（moveHistory 先頭 8/12/16 手と完全一致）
 *   同一開局の反復で棋譜が重複すると独立サンプルとして数えられない
 *   （docs/plans/bench-precision-2026-09-04.md §1.2）。毎回「distinct = 局数」を確認する。
 * - 色別勝率（黒勝/白勝/引分）: 開局スイートの均衡度の目安
 * - 開局ラベル別の勝敗
 *
 * 入力は CommitGameResult[]。commit-bench 最終出力と bench-reanalyze の両方で呼ぶ。
 */
import type { WDLCount } from "../types/ab.ts";
import type { CommitGameResult } from "../types/commit-bench.ts";

/** distinct 棋譜数。byPly[n] = 先頭 n 手で見た distinct、full = 完全一致。 */
export interface DistinctKifuCount {
  byPly: Record<number, number>;
  full: number;
}

/** 色別の勝敗（A/B に関係なく黒番/白番で見る）。 */
export interface ColorResults {
  blackWins: number;
  whiteWins: number;
  draws: number;
  /** 黒勝 / 全局（0 局なら 0） */
  blackWinRate: number;
}

/** 開局ラベル別の勝敗。 */
export interface OpeningResults {
  openingId: string;
  games: number;
  /** A 視点 */
  wdl: WDLCount;
  blackWins: number;
  whiteWins: number;
  draws: number;
}

export interface BenchGameStats {
  totalGames: number;
  distinct: DistinctKifuCount;
  color: ColorResults;
  openings: OpeningResults[];
}

export const DEFAULT_DISTINCT_PLIES = [8, 12, 16];

type KifuGame = Pick<CommitGameResult, "moveHistory">;

function kifuKey(game: KifuGame, ply: number): string {
  const n = Math.min(ply, game.moveHistory.length);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const m = game.moveHistory[i]!;
    parts.push(`${m.row},${m.col}`);
  }
  return parts.join(" ");
}

/** 先頭 n 手（plies ごと）と完全一致で見た distinct 棋譜数。 */
export function countDistinctKifu(
  games: KifuGame[],
  plies: number[] = DEFAULT_DISTINCT_PLIES,
): DistinctKifuCount {
  const byPly: Record<number, number> = {};
  for (const ply of plies) {
    byPly[ply] = new Set(games.map((g) => kifuKey(g, ply))).size;
  }
  const full = new Set(games.map((g) => kifuKey(g, Infinity))).size;
  return { byPly, full };
}

type ResultGame = Pick<CommitGameResult, "winner" | "isABlack">;

/** 勝者が黒番か（draw なら null）。 */
function winnerColor(game: ResultGame): "black" | "white" | null {
  if (game.winner === "draw") {
    return null;
  }
  const aWon = game.winner === "A";
  return aWon === game.isABlack ? "black" : "white";
}

/** 黒勝/白勝/引分。 */
export function countColorResults(games: ResultGame[]): ColorResults {
  let blackWins = 0;
  let whiteWins = 0;
  let draws = 0;
  for (const g of games) {
    const c = winnerColor(g);
    if (c === "black") {
      blackWins++;
    } else if (c === "white") {
      whiteWins++;
    } else {
      draws++;
    }
  }
  const total = games.length;
  return {
    blackWins,
    whiteWins,
    draws,
    blackWinRate: total > 0 ? blackWins / total : 0,
  };
}

/** 開局ラベル（jushuName）別の勝敗。出現順。 */
export function countOpeningResults(
  games: (ResultGame & Pick<CommitGameResult, "jushuName">)[],
): OpeningResults[] {
  const map = new Map<string, OpeningResults>();
  for (const g of games) {
    let r = map.get(g.jushuName);
    if (!r) {
      r = {
        openingId: g.jushuName,
        games: 0,
        wdl: { wins: 0, draws: 0, losses: 0 },
        blackWins: 0,
        whiteWins: 0,
        draws: 0,
      };
      map.set(g.jushuName, r);
    }
    r.games++;
    if (g.winner === "A") {
      r.wdl.wins++;
    } else if (g.winner === "B") {
      r.wdl.losses++;
    } else {
      r.wdl.draws++;
    }
    const c = winnerColor(g);
    if (c === "black") {
      r.blackWins++;
    } else if (c === "white") {
      r.whiteWins++;
    } else {
      r.draws++;
    }
  }
  return [...map.values()];
}

/** 全部まとめて計算する。 */
export function computeBenchGameStats(
  games: CommitGameResult[],
): BenchGameStats {
  return {
    totalGames: games.length,
    distinct: countDistinctKifu(games),
    color: countColorResults(games),
    openings: countOpeningResults(games),
  };
}

/** 要約を複数行で返す（開局別の表は含めない。reanalyze 側で別途出す）。 */
export function formatBenchGameStats(stats: BenchGameStats): string {
  const d = stats.distinct;
  const plyParts = Object.keys(d.byPly)
    .map(Number)
    .sort((a, b) => a - b)
    .map((p) => `@${p}=${d.byPly[p]}`)
    .join(" ");
  const c = stats.color;
  const lines = [
    `distinct 棋譜: ${plyParts} 完全=${d.full}/${stats.totalGames}`,
    `色別: 黒勝=${c.blackWins} 白勝=${c.whiteWins} 引分=${c.draws} 黒勝率=${(c.blackWinRate * 100).toFixed(1)}%`,
  ];
  if (stats.totalGames > 0 && d.full < stats.totalGames) {
    lines.push(
      `  ⚠ 重複棋譜 ${stats.totalGames - d.full} 局（独立サンプルとして数えられない）`,
    );
  }
  return lines.join("\n");
}
