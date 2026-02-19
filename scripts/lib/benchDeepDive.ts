/**
 * ベンチマーク深掘り分析ライブラリ
 *
 * blunder分布、advantage-squandered詳細、ゲーム手順表示、
 * time-pressure-error詳細の分析機能を提供する。
 */

import type { GameResult } from "../../src/logic/cpu/benchmark/headless.ts";

// ============================================================================
// 型定義
// ============================================================================

export interface BlunderEntry {
  gameIndex: number;
  moveNumber: number;
  color: "black" | "white";
  coord: string;
  prevScore: number;
  currScore: number;
  drop: number;
  depth: number | undefined;
  interrupted: boolean;
}

export interface BlunderDistribution {
  total: number;
  byDepth: {
    d0: number;
    d3: number;
    d4: number;
    other: number;
    interrupted: number;
  };
  byRange: {
    low: number;
    mid: number;
    high: number;
    veryHigh: number;
    extreme: number;
  };
  realEvalFailures: BlunderEntry[];
  topBlunders: BlunderEntry[];
}

export interface AdvantageSquanderedEntry {
  gameIndex: number;
  color: "black" | "white";
  peakScore: number;
  peakMove: number;
  isVCF: boolean;
  peakDepth: number | undefined;
  afterPeak: { move: number; score: number }[];
  winner: string;
  interrupts: number;
}

export interface TimePressureDetail {
  gameIndex: number;
  moveNumber: number;
  color: "black" | "white";
  coord: string;
  completedDepth: number;
  maxDepth: number;
  time: number;
  depthHistory: { depth: number; coord: string; score: number }[];
  finalScore: number;
  prevDepthScore: number;
  scoreDiff: number;
}

export interface GameMoveInfo {
  moveNumber: number;
  color: "black" | "white";
  coord: string;
  score: number | undefined;
  depth: number | undefined;
  interrupted: boolean;
  topCandidate?: { coord: string; searchScore: number };
  timePressureFallback: boolean;
  forcedMove: boolean;
}

// ============================================================================
// ヘルパー
// ============================================================================

export function toCoord(row: number, col: number): string {
  return String.fromCharCode(65 + col) + (15 - row);
}

// ============================================================================
// blunder 分布分析
// ============================================================================

export function analyzeBlunderDistribution(
  games: GameResult[],
  threshold = 2000,
): BlunderDistribution {
  const blunders: BlunderEntry[] = [];

  for (let gi = 0; gi < games.length; gi++) {
    const history = games[gi].moveHistory;
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      if (prev.score === undefined || curr.score === undefined) {
        continue;
      }

      const prevFromCurrent = -prev.score;
      const scoreDrop = prevFromCurrent - curr.score;
      if (scoreDrop >= threshold) {
        blunders.push({
          gameIndex: gi,
          moveNumber: i + 1,
          color: i % 2 === 0 ? "black" : "white",
          coord: toCoord(curr.row, curr.col),
          prevScore: prevFromCurrent,
          currScore: curr.score,
          drop: scoreDrop,
          depth: curr.depth,
          interrupted: curr.stats?.interrupted ?? false,
        });
      }
    }
  }

  const d0 = blunders.filter((b) => b.depth === 0).length;
  const d3 = blunders.filter((b) => b.depth === 3).length;
  const d4 = blunders.filter((b) => b.depth === 4).length;
  const interrupted = blunders.filter((b) => b.interrupted).length;

  const realEval = blunders.filter((b) => b.depth === 4 && !b.interrupted);
  realEval.sort((a, b) => b.drop - a.drop);

  const sorted = [...blunders].sort((a, b) => b.drop - a.drop);

  return {
    total: blunders.length,
    byDepth: { d0, d3, d4, other: blunders.length - d0 - d3 - d4, interrupted },
    byRange: {
      low: blunders.filter((b) => b.drop >= 2000 && b.drop < 3000).length,
      mid: blunders.filter((b) => b.drop >= 3000 && b.drop < 5000).length,
      high: blunders.filter((b) => b.drop >= 5000 && b.drop < 10000).length,
      veryHigh: blunders.filter((b) => b.drop >= 10000 && b.drop < 50000)
        .length,
      extreme: blunders.filter((b) => b.drop >= 50000).length,
    },
    realEvalFailures: realEval,
    topBlunders: sorted.slice(0, 10),
  };
}

// ============================================================================
// advantage-squandered 詳細分析
// ============================================================================

export function analyzeAdvantageSquandered(
  games: GameResult[],
  peakThreshold = 3000,
): AdvantageSquanderedEntry[] {
  const results: AdvantageSquanderedEntry[] = [];

  for (let gi = 0; gi < games.length; gi++) {
    const game = games[gi];
    const history = game.moveHistory;

    for (const playerColor of ["black", "white"] as const) {
      const indices = history
        .map((_, i) => i)
        .filter((i) => (playerColor === "black") === (i % 2 === 0));

      let peakScore = 0;
      let peakIdx = 0;

      for (const idx of indices) {
        const m = history[idx];
        if (m.score !== undefined && m.score > peakScore) {
          peakScore = m.score;
          peakIdx = idx;
        }
      }

      if (peakScore < peakThreshold) {
        continue;
      }

      const isBlack = playerColor === "black";
      const playerIsA = game.isABlack === isBlack;
      const didLose =
        (playerIsA && game.winner === "B") ||
        (!playerIsA && game.winner === "A");

      if (!didLose) {
        continue;
      }

      const afterPeak: { move: number; score: number }[] = [];
      for (let k = peakIdx + 2; k < history.length; k += 2) {
        const entry = history[k];
        if (entry && entry.score !== undefined) {
          afterPeak.push({ move: k + 1, score: entry.score });
        }
        if (afterPeak.length >= 5) {
          break;
        }
      }

      const peakMove = history[peakIdx];
      const interrupts = history.filter((m) => m.stats?.interrupted).length;

      results.push({
        gameIndex: gi,
        color: playerColor,
        peakScore,
        peakMove: peakIdx + 1,
        isVCF: peakScore === 100000,
        peakDepth: peakMove.depth,
        afterPeak,
        winner: game.winner,
        interrupts,
      });
    }
  }

  return results;
}

// ============================================================================
// time-pressure-error 詳細分析
// ============================================================================

export function analyzeTimePressureErrors(
  games: GameResult[],
): TimePressureDetail[] {
  const results: TimePressureDetail[] = [];

  for (let gi = 0; gi < games.length; gi++) {
    const history = games[gi].moveHistory;
    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      if (
        !m.stats?.interrupted ||
        !m.depthHistory ||
        m.depthHistory.length < 2
      ) {
        continue;
      }

      const prevDH = m.depthHistory[m.depthHistory.length - 2];
      const finalScore = m.score ?? 0;
      const prevScore = prevDH.score;
      const scoreDiff = prevScore - finalScore;

      if (scoreDiff <= 0) {
        continue;
      } // 悪化していない場合はスキップ

      const dhEntries = m.depthHistory.map((dh) => ({
        depth: dh.depth,
        coord: toCoord(dh.position.row, dh.position.col),
        score: dh.score,
      }));

      results.push({
        gameIndex: gi,
        moveNumber: i + 1,
        color: i % 2 === 0 ? "black" : "white",
        coord: toCoord(m.row, m.col),
        completedDepth: m.stats.completedDepth,
        maxDepth: m.stats.maxDepth,
        time: Math.round(m.time),
        depthHistory: dhEntries,
        finalScore,
        prevDepthScore: prevScore,
        scoreDiff,
      });
    }
  }

  results.sort((a, b) => b.scoreDiff - a.scoreDiff);
  return results;
}

// ============================================================================
// ゲーム手順表示
// ============================================================================

export function getGameMoves(game: GameResult): GameMoveInfo[] {
  return game.moveHistory.map((m, i) => {
    const topCand = m.candidates?.[0];
    return {
      moveNumber: i + 1,
      color: i % 2 === 0 ? "black" : "white",
      coord: toCoord(m.row, m.col),
      score: m.score,
      depth: m.depth,
      interrupted: m.stats?.interrupted ?? false,
      topCandidate: topCand
        ? {
            coord: toCoord(topCand.position.row, topCand.position.col),
            searchScore: topCand.searchScore,
          }
        : undefined,
      timePressureFallback: m.timePressureFallback ?? false,
      forcedMove: m.forcedMove ?? false,
    };
  });
}

// ============================================================================
// フォーマッタ
// ============================================================================

export function formatBlunderDistribution(dist: BlunderDistribution): string {
  const lines: string[] = [];
  lines.push("【blunder分布分析】");
  lines.push(`  検出数: ${dist.total}件`);
  lines.push("");
  lines.push("  深度別:");
  lines.push(
    `    d0(強制手): ${dist.byDepth.d0} (${pct(dist.byDepth.d0, dist.total)})`,
  );
  lines.push(
    `    d3: ${dist.byDepth.d3} (${pct(dist.byDepth.d3, dist.total)})`,
  );
  lines.push(
    `    d4: ${dist.byDepth.d4} (${pct(dist.byDepth.d4, dist.total)})`,
  );
  lines.push(
    `    中断あり: ${dist.byDepth.interrupted} (${pct(dist.byDepth.interrupted, dist.total)})`,
  );
  lines.push("");
  lines.push("  スコア差範囲:");
  lines.push(`    2000-3000: ${dist.byRange.low}件`);
  lines.push(`    3000-5000: ${dist.byRange.mid}件`);
  lines.push(`    5000-10000: ${dist.byRange.high}件`);
  lines.push(`    10000-50000: ${dist.byRange.veryHigh}件`);
  lines.push(`    50000+: ${dist.byRange.extreme}件`);
  lines.push("");
  lines.push(`  真の評価失敗(d4/非中断): ${dist.realEvalFailures.length}件`);
  lines.push("");
  lines.push("  Top 10 blunders:");
  for (const b of dist.topBlunders.slice(0, 10)) {
    lines.push(
      `    game ${b.gameIndex} m${b.moveNumber} ${b.color[0].toUpperCase()} ${b.coord}: ${b.prevScore}→${b.currScore} (drop ${b.drop}) d=${b.depth ?? "-"}${b.interrupted ? " INT" : ""}`,
    );
  }
  return lines.join("\n");
}

export function formatAdvantageSquandered(
  entries: AdvantageSquanderedEntry[],
): string {
  const lines: string[] = [];
  lines.push(`【advantage-squandered詳細】 (${entries.length}件)`);
  for (const e of entries) {
    const vcfTag = e.isVCF ? " [VCF]" : "";
    lines.push(
      `  game ${e.gameIndex} ${e.color}: peak=${e.peakScore} at m${e.peakMove} d=${e.peakDepth ?? "-"}${vcfTag} → lost (interrupts=${e.interrupts})`,
    );
    if (e.afterPeak.length > 0) {
      lines.push(
        `    after: ${e.afterPeak.map((s) => `m${s.move}:${s.score}`).join(", ")}`,
      );
    }
  }
  return lines.join("\n");
}

export function formatTimePressureErrors(
  entries: TimePressureDetail[],
): string {
  const lines: string[] = [];
  lines.push(`【time-pressure-error詳細】 (${entries.length}件)`);
  for (const e of entries) {
    lines.push(
      `  game ${e.gameIndex} m${e.moveNumber} ${e.color[0].toUpperCase()} ${e.coord}: d${e.completedDepth}/${e.maxDepth} ${e.time}ms prevScore=${e.prevDepthScore} final=${e.finalScore} diff=${e.scoreDiff}`,
    );
    lines.push(
      `    depthHistory: ${e.depthHistory.map((dh) => `d${dh.depth}:${dh.coord}(${dh.score})`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function formatGameMoves(
  game: GameResult,
  gameIndex: number,
  moves: GameMoveInfo[],
): string {
  const lines: string[] = [];
  lines.push(
    `【game ${gameIndex} 手順】 winner=${game.winner} reason=${game.reason} moves=${game.moves}`,
  );
  lines.push(
    `  playerA=${game.playerA} playerB=${game.playerB} isABlack=${game.isABlack}`,
  );
  lines.push("");
  for (const m of moves) {
    const flags: string[] = [];
    if (m.interrupted) {
      flags.push("INT");
    }
    if (m.timePressureFallback) {
      flags.push("FALLBACK");
    }
    if (m.forcedMove) {
      flags.push("FORCED");
    }
    const flagStr = flags.length > 0 ? ` [${flags.join(",")}]` : "";
    const topStr = m.topCandidate
      ? ` top=${m.topCandidate.coord}(${m.topCandidate.searchScore})`
      : "";
    lines.push(
      `  ${m.moveNumber}. ${m.color[0].toUpperCase()} ${m.coord} score=${m.score ?? "-"} d=${m.depth ?? "-"}${topStr}${flagStr}`,
    );
  }
  return lines.join("\n");
}

function pct(n: number, total: number): string {
  if (total === 0) {
    return "0%";
  }
  return `${((n / total) * 100).toFixed(1)}%`;
}
