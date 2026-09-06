/**
 * ペア統計（pentanomial）。
 *
 * commit-bench / weight-bench は「同一開局 × 2 色」のペアで対局する。1 局ずつ
 * 独立と見なす三項統計は開局の色有利によるペア内相関を無視して CI を過大に
 * 見積もるため、ペア得点（A黒局 + A白局 の平均得点）を単位に Elo / CI / SPRT を
 * 計算する。fastchess / fishtest の pentanomial 方式に相当する。
 *
 * すべて純粋関数。得点は A 視点（勝 1 / 分 0.5 / 負 0）。
 */
import type {
  EloDiffResult,
  PairedStats,
  PentanomialCount,
  SPRTConfig,
  SPRTDecision,
  SPRTState,
} from "../types/ab.ts";
import type { GameWinner } from "./wdl.ts";

import { eloToScore, scoreIntervalToElo } from "./eloDiff.ts";
import { calculateBounds, formatSPRTDecision } from "./sprt.ts";

/** ペアリングに必要な最小限の対局情報。 */
export interface PairableGame {
  pairId: string;
  isABlack: boolean;
  winner: GameWinner;
}

/** 完成ペアの得点（A 視点）。 */
export interface PairScore {
  pairId: string;
  /** A が黒だった局の得点 */
  scoreABlack: number;
  /** A が白だった局の得点 */
  scoreAWhite: number;
  /** ペア得点 = (scoreABlack + scoreAWhite) / 2 ∈ {0, 0.25, 0.5, 0.75, 1} */
  score: number;
}

/** ガード: これ未満のペア数では正規近似を使わない（LLR=0, CI ±∞）。 */
export const MIN_PAIRS_FOR_NORMAL = 16;
/**
 * ペア得点分散のフロア。LLR と CI の両方で `max(観測 σ², フロア)` を使う。
 *
 * 理論根拠: 引き分けの無い決着局のみのモデルで、ある開局の黒勝率を p とすると
 * ペア得点（A黒局 + A白局 の平均）の分散は p(1−p)/2。等力（p=0.5）で 0.125、
 * p≈0.11（26 珠型中の極端な色有利、新月 17% / 松月 83% 相当）でも ≈0.05。
 * 観測分散がこれを下回るのはサンプル不足（序盤で dd ばかり、または全ペア同一
 * 得点）であり、生分散をそのまま使うと LLR が発散して H0/H1 に誤停止する
 * （例: 99 dd + 1 ww で LLR ≈ −28.8）。逆に σ²=0 を「LLR=0」で潰すと
 * 20 ww でも永遠に continue になる。フロアで両方を防ぐ。
 */
export const PAIR_VARIANCE_FLOOR = 0.05;

/** 勝者 → A 視点の得点。 */
export function winnerToScore(winner: GameWinner): number {
  switch (winner) {
    case "A":
      return 1;
    case "B":
      return 0;
    default:
      return 0.5;
  }
}

/** ペアリングに必要な最小限の対局結果（CommitGameResult のサブセット）。 */
export interface PairableGameInput {
  pairId?: string;
  jushuName: string;
  isABlack: boolean;
  winner: GameWinner;
}

/**
 * 1 局を PairableGame に正規化する（SSoT）。
 * pairId があればそれを、無ければ jushuName を pairId にする（旧 JSON 規則。
 * この規則では同一珠型のセット跨ぎで A黒/A白 を取り違えてペアにしうるが、
 * 珠型ごとに A黒/A白 が同数なのでペア数は変わらない。unpaired が出るのは
 * abort 等で片方の局が欠落したときだけ）。
 */
export function toPairableGame(g: PairableGameInput): PairableGame {
  return {
    pairId: g.pairId ?? g.jushuName,
    isABlack: g.isABlack,
    winner: g.winner,
  };
}

/** toPairableGame の配列版。 */
export function toPairableGames(games: PairableGameInput[]): PairableGame[] {
  return games.map(toPairableGame);
}

/**
 * 同一 pairId の A黒局と A白局を出現順で zip してペアにする。
 * 相方が無い局は unpaired に数える。ペアの並びは「ペアが完成した順」。
 */
export function buildPairs(games: PairableGame[]): {
  pairs: PairScore[];
  unpaired: number;
} {
  const waiting = new Map<string, { black: number[]; white: number[] }>();
  const pairs: PairScore[] = [];
  for (const g of games) {
    let slot = waiting.get(g.pairId);
    if (!slot) {
      slot = { black: [], white: [] };
      waiting.set(g.pairId, slot);
    }
    const score = winnerToScore(g.winner);
    const mine = g.isABlack ? slot.black : slot.white;
    const other = g.isABlack ? slot.white : slot.black;
    if (other.length > 0) {
      const otherScore = other.shift()!;
      const scoreABlack = g.isABlack ? score : otherScore;
      const scoreAWhite = g.isABlack ? otherScore : score;
      pairs.push({
        pairId: g.pairId,
        scoreABlack,
        scoreAWhite,
        score: (scoreABlack + scoreAWhite) / 2,
      });
    } else {
      mine.push(score);
    }
  }
  let unpaired = 0;
  for (const slot of waiting.values()) {
    unpaired += slot.black.length + slot.white.length;
  }
  return { pairs, unpaired };
}

/** ペア得点を 5 区分に集計する。 */
export function countPentanomial(pairs: PairScore[]): PentanomialCount {
  const c: PentanomialCount = { ll: 0, ld: 0, dd: 0, wd: 0, ww: 0 };
  for (const p of pairs) {
    if (p.score <= 0) {
      c.ll++;
    } else if (p.score <= 0.25) {
      c.ld++;
    } else if (p.score <= 0.5) {
      c.dd++;
    } else if (p.score <= 0.75) {
      c.wd++;
    } else {
      c.ww++;
    }
  }
  return c;
}

/** ペア得点の平均と母分散（ペア数で割る）。 */
function meanAndVariance(pairs: PairScore[]): {
  mean: number;
  variance: number;
} {
  const n = pairs.length;
  if (n === 0) {
    return { mean: 0.5, variance: 0 };
  }
  let sum = 0;
  for (const p of pairs) {
    sum += p.score;
  }
  const mean = sum / n;
  let sq = 0;
  for (const p of pairs) {
    sq += (p.score - mean) ** 2;
  }
  return { mean, variance: sq / n };
}

/** 正規近似に使う分散（フロア適用）。 */
function flooredVariance(observed: number): number {
  return Math.max(observed, PAIR_VARIANCE_FLOOR);
}

/**
 * ペア得点の平均・分散（フロア適用）から Elo 差と 95% CI を求める。
 * ペア数 < MIN_PAIRS_FOR_NORMAL なら点推定のみ返し CI は ±Infinity。
 */
export function estimatePairedElo(pairs: PairScore[]): EloDiffResult {
  const n = pairs.length;
  const { mean, variance } = meanAndVariance(pairs);
  const se =
    n >= MIN_PAIRS_FOR_NORMAL
      ? Math.sqrt(flooredVariance(variance) / n)
      : Infinity;
  return scoreIntervalToElo(mean, se);
}

/**
 * ペア LLR（正規近似）: N·(s1−s0)·(2s̄−s0−s1)/(2σ²)、σ² はフロア適用後。
 * ペア数 < MIN_PAIRS_FOR_NORMAL なら 0。
 */
export function pairedLLR(pairs: PairScore[], config: SPRTConfig): number {
  const n = pairs.length;
  if (n < MIN_PAIRS_FOR_NORMAL) {
    return 0;
  }
  const { mean, variance } = meanAndVariance(pairs);
  const s0 = eloToScore(config.elo0);
  const s1 = eloToScore(config.elo1);
  return (
    (n * (s1 - s0) * (2 * mean - s0 - s1)) / (2 * flooredVariance(variance))
  );
}

/** ペア LLR による SPRT 状態。境界は三項 SPRT と同じ（calculateBounds）。 */
export function updatePairedSPRT(
  pairs: PairScore[],
  config: SPRTConfig,
): SPRTState {
  const llr = pairedLLR(pairs, config);
  const [lowerBound, upperBound] = calculateBounds(config);
  let decision: SPRTDecision = "continue";
  if (llr >= upperBound) {
    decision = "H1";
  } else if (llr <= lowerBound) {
    decision = "H0";
  }
  return { llr, upperBound, lowerBound, decision };
}

/** games から PairedStats を組み立てる。 */
export function computePairedStats(
  games: PairableGame[],
  config: SPRTConfig | null,
): PairedStats {
  const { pairs, unpaired } = buildPairs(games);
  return {
    pairs: pairs.length,
    unpaired,
    pentanomial: countPentanomial(pairs),
    elo: estimatePairedElo(pairs),
    sprt: config ? updatePairedSPRT(pairs, config) : null,
  };
}

/** 符号付き小数 1 桁。±Infinity はそのまま。 */
function fmtElo(v: number): string {
  if (!Number.isFinite(v)) {
    return v > 0 ? "+∞" : "−∞";
  }
  return `${v > 0 ? "+" : ""}${v}`;
}

/** PairedStats を複数行文字列にする。 */
export function formatPairedStats(stats: PairedStats): string {
  const p = stats.pentanomial;
  const e = stats.elo;
  const lines = [
    `ペア Elo差: ${fmtElo(e.eloDiff)} [${fmtElo(e.ci95Lower)}, ${fmtElo(e.ci95Upper)}] (95%CI) ペア得点: ${(e.winRate * 100).toFixed(1)}%`,
    `  ${stats.pairs}ペア (未ペア ${stats.unpaired}局): ll=${p.ll} ld=${p.ld} dd=${p.dd} wd=${p.wd} ww=${p.ww}`,
  ];
  if (stats.sprt) {
    lines.push(
      `  ペア SPRT: LLR=${stats.sprt.llr.toFixed(2)} [${stats.sprt.lowerBound.toFixed(2)}, ${stats.sprt.upperBound.toFixed(2)}] 判定: ${formatSPRTDecision(stats.sprt.decision)}`,
    );
  }
  return lines.join("\n");
}
