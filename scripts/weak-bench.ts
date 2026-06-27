/**
 * 弱体化検証ベンチ
 *
 * 目的: ★1（beginner）の弱体化が「初心者でほぼ毎回勝てる」レベルになっているか
 *   定量確認する。bench-ai.ts は TS CPU 時代の遺物で benchmark/ 依存が削除済みのため、
 *   このスクリプトは Worker と同じ最終手選択ロジック（WASM 探索 + applyRandomization）で
 *   ヘッドレス対局を回し、各難易度の勝率だけを出力する。
 *
 * 使用例:
 *   pnpm weak-bench --a=beginner --b=easy --games=20
 *   pnpm weak-bench --a=beginner --b=hard --games=10
 */

import type { BoardState, Position } from "../src/types/game.ts";

import { applyMoveInPlace } from "../src/logic/cpu/core/boardUtils.ts";
import {
  getAllJushuNames,
  getJushuPositions,
  isOpeningPhase,
} from "../src/logic/cpu/opening.ts";
import {
  listChebyshevNeighbors,
  selectMoveWithRandomization,
} from "../src/logic/cpu/randomization.ts";
import {
  isForbiddenForBlack,
  preloadForbiddenWasm,
} from "../src/logic/cpu/wasm/forbiddenAdapter.ts";
import { loadWasmModule } from "../src/logic/cpu/wasm/loader.ts";
import { WasmSearchEngine } from "../src/logic/cpu/wasm/searchEngine.ts";
import { checkWin, createEmptyBoard } from "../src/logic/renjuRules/core.ts";
import {
  CPU_DIFFICULTIES,
  DIFFICULTY_PARAMS,
  type CpuDifficulty,
} from "../src/types/cpu.ts";

interface CliOptions {
  a: CpuDifficulty;
  b: CpuDifficulty;
  games: number;
  all: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    a: "beginner",
    b: "easy",
    games: 10,
    all: false,
  };
  for (const arg of args) {
    if (arg === "--all") {
      opts.all = true;
    } else if (arg.startsWith("--a=")) {
      const v = arg.slice(4);
      if (CPU_DIFFICULTIES.includes(v as CpuDifficulty)) {
        opts.a = v as CpuDifficulty;
      }
    } else if (arg.startsWith("--b=")) {
      const v = arg.slice(4);
      if (CPU_DIFFICULTIES.includes(v as CpuDifficulty)) {
        opts.b = v as CpuDifficulty;
      }
    } else if (arg.startsWith("--games=")) {
      const n = Number.parseInt(arg.slice(8), 10);
      if (Number.isFinite(n) && n > 0) {
        opts.games = n;
      }
    }
  }
  return opts;
}

function collectEmptyCells(board: BoardState): Position[] {
  const empties: Position[] = [];
  for (let row = 0; row < 15; row++) {
    const boardRow = board[row];
    if (!boardRow) {
      continue;
    }
    for (let col = 0; col < 15; col++) {
      if (boardRow[col] === null) {
        empties.push({ row, col });
      }
    }
  }
  return empties;
}

const RANDOM_NEIGHBOR_RADIUS = 3;

function pickNearbyLegalMove(
  board: BoardState,
  turn: "black" | "white",
  center: Position,
): Position | null {
  const neighbors = listChebyshevNeighbors(center, RANDOM_NEIGHBOR_RADIUS);
  const candidates = neighbors.filter((p) => {
    if (board[p.row]?.[p.col] !== null) {
      return false;
    }
    if (turn === "black" && isForbiddenForBlack(board, p.row, p.col)) {
      return false;
    }
    return true;
  });
  if (candidates.length === 0) {
    return null;
  }
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx] ?? null;
}

interface PlayerEngine {
  difficulty: CpuDifficulty;
  pick: (board: BoardState, turn: "black" | "white") => Position;
}

function makePlayer(
  engine: WasmSearchEngine,
  difficulty: CpuDifficulty,
): PlayerEngine {
  const params = DIFFICULTY_PARAMS[difficulty];
  return {
    difficulty,
    pick(board, turn) {
      const wasmResult = engine.findBestMove(board, turn, difficulty);
      return selectMoveWithRandomization({
        bestMove: wasmResult.position,
        bestMoveScore: wasmResult.score,
        criticalScoreThreshold: params.randomCriticalScoreThreshold,
        randomFactor: params.randomFactor,
        pickRandomMove: () =>
          pickNearbyLegalMove(board, turn, wasmResult.position),
      });
    },
  };
}

type GameOutcome = "blackWin" | "whiteWin" | "draw";

interface GameRecord {
  outcome: GameOutcome;
  moves: number;
  jushu: string;
  blackDifficulty: CpuDifficulty;
}

function playGame(
  black: PlayerEngine,
  white: PlayerEngine,
  openingMoves: [Position, Position, Position],
  jushu: string,
): GameRecord {
  const board = createEmptyBoard();
  const colors: ("black" | "white")[] = ["black", "white", "black"];
  for (let i = 0; i < 3; i++) {
    const m = openingMoves[i];
    const c = colors[i];
    if (!m || !c) {
      continue;
    }
    applyMoveInPlace(board, m, c);
  }
  let moveCount = 3;
  for (let ply = 0; ply < 200; ply++) {
    const turn: "black" | "white" = moveCount % 2 === 0 ? "black" : "white";
    const player = turn === "black" ? black : white;
    const move: Position = isOpeningPhase(moveCount)
      ? (collectEmptyCells(board)[0] ?? { row: 7, col: 7 })
      : player.pick(board, turn);
    // 黒の禁手チェック
    if (turn === "black" && isForbiddenForBlack(board, move.row, move.col)) {
      return {
        outcome: "whiteWin",
        moves: moveCount + 1,
        jushu,
        blackDifficulty: black.difficulty,
      };
    }
    applyMoveInPlace(board, move, turn);
    moveCount++;
    if (checkWin(board, move, turn)) {
      return {
        outcome: turn === "black" ? "blackWin" : "whiteWin",
        moves: moveCount,
        jushu,
        blackDifficulty: black.difficulty,
      };
    }
    if (moveCount >= 70) {
      return {
        outcome: "draw",
        moves: moveCount,
        jushu,
        blackDifficulty: black.difficulty,
      };
    }
  }
  return {
    outcome: "draw",
    moves: moveCount,
    jushu,
    blackDifficulty: black.difficulty,
  };
}

interface PairResult {
  a: CpuDifficulty;
  b: CpuDifficulty;
  aWins: number;
  bWins: number;
  draws: number;
  total: number;
}

function runPair(
  engine: WasmSearchEngine,
  a: CpuDifficulty,
  b: CpuDifficulty,
  games: number,
  jushuNames: string[],
  log: (msg: string) => void,
): PairResult {
  const playerA = makePlayer(engine, a);
  const playerB = makePlayer(engine, b);
  const result: PairResult = {
    a,
    b,
    aWins: 0,
    bWins: 0,
    draws: 0,
    total: 0,
  };
  for (let i = 0; i < games; i++) {
    const jushuName = jushuNames[i % jushuNames.length] ?? jushuNames[0];
    if (!jushuName) {
      break;
    }
    const positions = getJushuPositions(jushuName);
    if (!positions) {
      continue;
    }
    const aIsBlack = i % 2 === 0;
    const black = aIsBlack ? playerA : playerB;
    const white = aIsBlack ? playerB : playerA;
    engine.clearTT();
    const record = playGame(black, white, positions, jushuName);
    result.total++;
    if (record.outcome === "draw") {
      result.draws++;
    } else if (
      (record.outcome === "blackWin" && aIsBlack) ||
      (record.outcome === "whiteWin" && !aIsBlack)
    ) {
      result.aWins++;
    } else {
      result.bWins++;
    }
    log(
      `  [${i + 1}/${games}] ${aIsBlack ? `${a}(黒)` : `${b}(黒)`} vs ${aIsBlack ? `${b}(白)` : `${a}(白)`} → ${record.outcome} (${record.moves}手)`,
    );
  }
  return result;
}

/**
 * Bradley-Terry 反復で Elo を推定する。
 * 各プレイヤーの Elo を勾配上昇で更新（K=16、200 イテレーション）。
 * 平均が 1500 になるよう正規化。
 */
function estimateElo(
  players: CpuDifficulty[],
  pairs: PairResult[],
): Record<CpuDifficulty, number> {
  const elo: Record<string, number> = {};
  for (const p of players) {
    elo[p] = 1500;
  }
  const K = 16;
  for (let iter = 0; iter < 200; iter++) {
    const delta: Record<string, number> = {};
    for (const p of players) {
      delta[p] = 0;
    }
    for (const r of pairs) {
      const eA = elo[r.a] ?? 1500;
      const eB = elo[r.b] ?? 1500;
      const expA = 1 / (1 + 10 ** ((eB - eA) / 400));
      const actualA = (r.aWins + 0.5 * r.draws) / r.total;
      const diff = K * r.total * (actualA - expA);
      delta[r.a] = (delta[r.a] ?? 0) + diff;
      delta[r.b] = (delta[r.b] ?? 0) - diff;
    }
    for (const p of players) {
      elo[p] = (elo[p] ?? 1500) + (delta[p] ?? 0) / players.length;
    }
  }
  const mean =
    players.reduce((sum, p) => sum + (elo[p] ?? 1500), 0) / players.length;
  const adj: Record<CpuDifficulty, number> = {} as Record<
    CpuDifficulty,
    number
  >;
  for (const p of players) {
    adj[p] = (elo[p] ?? 1500) - mean + 1500;
  }
  return adj;
}

async function runAll(games: number): Promise<void> {
  console.log(`weak-bench --all: 全難易度総当たり, games/pair=${games}`);
  const wasm = await loadWasmModule();
  await preloadForbiddenWasm();
  const engine = new WasmSearchEngine(wasm);
  const jushuNames = getAllJushuNames();
  if (jushuNames.length === 0) {
    console.error("珠型リストが取得できませんでした");
    process.exit(1);
  }
  const players: CpuDifficulty[] = [...CPU_DIFFICULTIES];
  const pairs: PairResult[] = [];
  const startTime = Date.now();
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (!a || !b) {
        continue;
      }
      console.log(`\n--- ${a} vs ${b} ---`);
      const result = runPair(engine, a, b, games, jushuNames, (msg) =>
        console.log(msg),
      );
      pairs.push(result);
      const winRateA =
        ((result.aWins + 0.5 * result.draws) / result.total) * 100;
      console.log(
        `  → ${a}: ${result.aWins}W ${result.bWins}L ${result.draws}D (勝率 ${winRateA.toFixed(1)}%)`,
      );
    }
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n総対局時間: ${elapsed}s`);

  const elo = estimateElo(players, pairs);

  console.log("\n=== ペア勝率表 (行 vs 列, 行の勝率%) ===");
  const header = ["", ...players].map((s) => s.padEnd(10)).join(" ");
  console.log(header);
  for (const a of players) {
    const row: string[] = [a.padEnd(10)];
    for (const b of players) {
      if (a === b) {
        row.push("-".padEnd(10));
        continue;
      }
      const pair = pairs.find(
        (p) => (p.a === a && p.b === b) || (p.a === b && p.b === a),
      );
      if (!pair) {
        row.push("-".padEnd(10));
        continue;
      }
      const aWins = pair.a === a ? pair.aWins : pair.bWins;
      const score = ((aWins + 0.5 * pair.draws) / pair.total) * 100;
      row.push(`${score.toFixed(1)}%`.padEnd(10));
    }
    console.log(row.join(" "));
  }

  console.log("\n=== Elo ランキング ===");
  const sorted = [...players].sort((a, b) => (elo[b] ?? 0) - (elo[a] ?? 0));
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (!p) {
      continue;
    }
    console.log(`  ${i + 1}. ${p.padEnd(10)} Elo ${(elo[p] ?? 0).toFixed(0)}`);
  }
}

async function runPairOnly(opts: CliOptions): Promise<void> {
  console.log(
    `weak-bench: ${opts.a} vs ${opts.b}, games=${opts.games} (both colors)`,
  );
  const wasm = await loadWasmModule();
  await preloadForbiddenWasm();
  const engine = new WasmSearchEngine(wasm);
  const jushuNames = getAllJushuNames();
  if (jushuNames.length === 0) {
    console.error("珠型リストが取得できませんでした");
    process.exit(1);
  }
  const result = runPair(
    engine,
    opts.a,
    opts.b,
    opts.games,
    jushuNames,
    (msg) => console.log(msg.trimStart()),
  );
  console.log("\n=== 結果 ===");
  console.log(
    `${opts.a} 勝率: ${result.aWins}/${result.total} = ${((result.aWins / result.total) * 100).toFixed(1)}%`,
  );
  console.log(
    `${opts.b} 勝率: ${result.bWins}/${result.total} = ${((result.bWins / result.total) * 100).toFixed(1)}%`,
  );
  console.log(`引き分け: ${result.draws}/${result.total}`);
}

async function main(): Promise<void> {
  const opts = parseArgs();
  if (opts.all) {
    await runAll(opts.games);
  } else {
    await runPairOnly(opts);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
