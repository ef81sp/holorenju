/**
 * Futility Pruning マージン計測スクリプト
 *
 * Futility Pruning を無効化し、時間制限を緩和して対局を実行。
 * 各深度で「静的評価 vs 探索スコア」の差分を収集し、
 * 適切なマージン値を実証的に決定する。
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     --import ./scripts/register-loader.mjs scripts/measure-futility-margins.ts \
 *     [--games=N] [--depth=N]
 */

import type { CpuDifficulty } from "../src/types/cpu.ts";

import {
  runHeadlessGame,
  type PlayerConfig,
} from "../src/logic/cpu/benchmark/headless.ts";
import {
  startFutilityMeasurement,
  stopFutilityMeasurement,
  type FutilityGainSample,
} from "../src/logic/cpu/search/futilityMeasurement.ts";

// --- CLI 引数解析 ---
const args = process.argv.slice(2);
let numGames = 20;
let maxDepth = 4;

for (const arg of args) {
  const gamesMatch = arg.match(/^--games=(\d+)$/);
  if (gamesMatch) {
    numGames = parseInt(gamesMatch[1]!, 10);
  }
  const depthMatch = arg.match(/^--depth=(\d+)$/);
  if (depthMatch) {
    maxDepth = parseInt(depthMatch[1]!, 10);
  }
}

// depth に応じた難易度を選択（depth=3→medium, depth=4→hard）
const difficultyMap: Record<number, CpuDifficulty> = {
  2: "easy",
  3: "medium",
  4: "hard",
};
const baseDifficulty = difficultyMap[maxDepth] ?? "hard";

// --- プレイヤー設定（Futility 無効、時間制限緩和） ---
const measurePlayer: PlayerConfig = {
  id: `${baseDifficulty}-measure`,
  difficulty: baseDifficulty,
  customParams: {
    depth: maxDepth,
    timeLimit: 30000, // 30秒（十分な余裕）
    maxNodes: undefined, // ノード制限なし
    randomFactor: 0,
    evaluationOptions: {
      enableFukumi: true,
      enableMise: true,
      enableForbiddenTrap: true,
      enableMultiThreat: true,
      enableCounterFour: true,
      enableVCT: true,
      enableMandatoryDefense: true,
      enableSingleFourPenalty: true,
      singleFourPenaltyMultiplier: 0.0,
      enableMiseThreat: true,
      enableNullMovePruning: maxDepth >= 4,
      enableFutilityPruning: false, // Futility 無効化（全手を探索）
      enableForbiddenVulnerability: maxDepth >= 4,
    },
  },
};

// --- 計測実行 ---
console.log(`=== Futility Margin Measurement ===`);
console.log(
  `Games: ${numGames} (${baseDifficulty}, depth=${maxDepth}, futility disabled)`,
);
console.log(`Time limit: 30s/move, no node limit`);
console.log();

const allSamples: FutilityGainSample[] = [];

for (let i = 0; i < numGames; i++) {
  const gameStart = performance.now();
  process.stdout.write(
    `\r[Game ${i + 1}/${numGames}] playing...                    `,
  );

  startFutilityMeasurement();

  runHeadlessGame(measurePlayer, measurePlayer);

  const samples = stopFutilityMeasurement();
  for (const s of samples) {
    allSamples.push(s);
  }

  const elapsed = ((performance.now() - gameStart) / 1000).toFixed(1);
  process.stdout.write(
    `\r[Game ${i + 1}/${numGames}] done - ${samples.length} samples, ${elapsed}s\n`,
  );
}

console.log();
console.log(`Total samples: ${allSamples.length}`);
console.log();

// --- 集計 ---
const byDepth = new Map<number, number[]>();
for (const sample of allSamples) {
  let arr = byDepth.get(sample.depth);
  if (!arr) {
    arr = [];
    byDepth.set(sample.depth, arr);
  }
  arr.push(sample.gain);
}

// 深度順にソート
const depths = [...byDepth.keys()].sort((a, b) => a - b);

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

// VCF/FIVE による極端な外れ値を除外した分析も行う
const OUTLIER_THRESHOLD = 50000;

function printDistribution(label: string, gains: number[]): void {
  gains.sort((a, b) => a - b);
  const count = gains.length;
  if (count === 0) {
    console.log(`${label}: no data`);
    return;
  }
  const mean = gains.reduce((s, v) => s + v, 0) / count;
  const nonZero = gains.filter((g) => g > 0).length;
  const nonZeroRate = ((nonZero / count) * 100).toFixed(1);

  console.log(`${label} (${count} samples, ${nonZeroRate}% non-zero)`);
  console.log(`  Mean:  ${mean.toFixed(0)}`);
  console.log(`  P50:   ${percentile(gains, 50)}`);
  console.log(`  P75:   ${percentile(gains, 75)}`);
  console.log(`  P90:   ${percentile(gains, 90)}`);
  console.log(`  P95:   ${percentile(gains, 95)}`);
  console.log(`  P99:   ${percentile(gains, 99)}`);
  console.log(`  Max:   ${gains[gains.length - 1]}`);
}

// 手番の判定（maxDepth と depth の偶奇で決まる）
function getPlayerLabel(depth: number): string {
  // maxDepth が偶数: 奇数depth=相手、偶数depth=自分
  // maxDepth が奇数: 奇数depth=自分、偶数depth=相手
  const isSelf = (maxDepth - depth) % 2 === 0;
  return isSelf ? "自分" : "相手";
}

console.log(`=== Depth-wise Gain Distribution (maxDepth=${maxDepth}) ===`);
console.log();

for (const depth of depths) {
  const allGains = byDepth.get(depth)!;
  const filtered = allGains.filter((g) => g < OUTLIER_THRESHOLD);
  const outliers = allGains.length - filtered.length;
  const player = getPlayerLabel(depth);

  console.log(`--- Depth ${depth} [${player}の手] ---`);
  printDistribution("  All", [...allGains]);
  printDistribution(`  Filtered (<${OUTLIER_THRESHOLD})`, filtered);
  if (outliers > 0) {
    console.log(
      `  Outliers (>=${OUTLIER_THRESHOLD}): ${outliers} (${((outliers / allGains.length) * 100).toFixed(2)}%)`,
    );
  }
  console.log();
}

// --- マージン提案 ---
console.log("=== Suggested Margins (filtered, P95 / P99) ===");
console.log();
console.log("| Depth | Player | Samples | P90 | P95 | P99 | Max | Current |");
console.log("|-------|--------|---------|-----|-----|-----|-----|---------|");

const currentMargins = [0, 500, 1500, 3000];
for (const depth of depths) {
  const allGains = byDepth.get(depth)!;
  const gains = allGains.filter((g) => g < OUTLIER_THRESHOLD);
  gains.sort((a, b) => a - b);
  if (gains.length === 0) {
    continue;
  }
  const p90 = percentile(gains, 90);
  const p95 = percentile(gains, 95);
  const p99 = percentile(gains, 99);
  const max = gains[gains.length - 1]!;
  const current = currentMargins[depth] ?? "N/A";
  const player = getPlayerLabel(depth);
  console.log(
    `| ${depth} | ${player} | ${gains.length} | ${p90} | ${p95} | ${p99} | ${max} | ${current} |`,
  );
}
