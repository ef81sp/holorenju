/**
 * ベンチマーク統計計算・フォーマットライブラリ
 *
 * analyze-bench.sh と完全互換の出力を生成する。
 * JSON を1回パースし、1パスで全統計を蓄積する。
 */

import type {
  GameResult,
  MoveRecord,
  SearchStatsRecord,
} from "../../src/logic/cpu/benchmark/headless.ts";

import { DIFFICULTY_PARAMS } from "../../src/types/cpu.ts";

// ============================================================================
// 型定義
// ============================================================================

interface MatchupRecord {
  blackWin: number;
  whiteWin: number;
  draw: number;
}

interface PlayerMoveStats {
  /** 探索統計つきの着手 */
  moveCount: number;
  totalNodes: number;
  maxNodes: number;
  totalCompletedDepth: number;
  maxDepth: number; // 設定深度（最初の着手から取得）
  interruptedCount: number;
  hasMaxDepth: boolean;
  /** 深度分布 */
  depthCounts: Map<number, number>;
  /** 探索効率（nodes > 0 のもの） */
  effTotalNodes: number;
  effTotalTtHits: number;
  effTotalBetaCutoffs: number;
  /** プロファイリング */
  totalForbiddenCheckCalls: number;
  totalBoardCopies: number;
  totalThreatDetectionCalls: number;
  totalEvaluationCalls: number;
  /** 選択順位 */
  rankCounts: Map<number | "out", number>;
  /** ランダム悪手 */
  randomBadMoves: number;
  /** 思考時間統計（開局除く、ミリ秒） */
  thinkingTimes: number[];
  thinkingTimeSum: number;
  /** 思考時間の制限超過（timeLimit以上）の着手数 */
  thinkingTimeOverCount: number;
  /** 思考時間が長い着手の詳細（上位をゲーム走査後にソート） */
  slowMoves: SlowMoveInfo[];
  /** Null Move Pruning によるカットオフ総数 */
  totalNullMoveCutoffs: number;
  /** Futility Pruning によるスキップ総数 */
  totalFutilityPrunes: number;
}

interface SlowMoveInfo {
  gameIndex: number;
  moveIndex: number;
  time: number;
  playerA: string;
  playerB: string;
}

interface ColorWins {
  black: number;
  white: number;
  draw: number;
}

interface ForbiddenDetail {
  gameIndex: number;
  winner: string; // 白番プレイヤー名（勝者）
  type: "禁手追い込み" | "自滅";
  playerA: string;
  playerB: string;
  moves: number;
}

/** 難易度別の黒番/白番勝率 */
interface PlayerColorWinRate {
  blackWin: number;
  blackLose: number;
  blackDraw: number;
  whiteWin: number;
  whiteLose: number;
  whiteDraw: number;
}

interface BenchStats {
  /** 基本情報 */
  timestamp: string;
  totalGames: number;
  players: string[];
  gamesPerMatchup: number;
  /** レーティング */
  ratings: {
    name: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    games: number;
  }[];
  /** マッチアップ結果 */
  matchups: {
    playerA: string;
    playerB: string;
    winsA: number;
    winsB: number;
    draws: number;
  }[];
  /** 黒勝敗マトリクス: matrix[black][white] */
  blackMatrix: Map<string, Map<string, MatchupRecord>>;
  /** 全体先手後手勝率 */
  colorWins: ColorWins;
  /** 同難易度対戦 */
  selfPlayTotal: ColorWins;
  selfPlayByPlayer: Map<string, ColorWins>;
  /** 難易度別の黒番/白番勝率 */
  playerColorWinRates: Map<string, PlayerColorWinRate>;
  /** 難易度格差別の黒勝率（同難易度/黒が格上/黒が格下） */
  gapColorWins: {
    same: ColorWins;
    blackStronger: ColorWins;
    blackWeaker: ColorWins;
  };
  /** 勝利理由 */
  reasonCounts: Map<string, number>;
  /** プレイヤー別探索統計 */
  playerStats: Map<string, PlayerMoveStats>;
  /** 禁手負け */
  forbiddenLossByPlayer: Map<string, number>;
  /** 禁手負け詳細 */
  forbiddenDetails: ForbiddenDetail[];
  /** 禁手追い込み成功数 */
  forcedForbiddenCount: number;
  /** ゲーム長統計 */
  gameLengthAvg: number;
  gameLengthMin: number;
  gameLengthMax: number;
  /** 異難易度対戦の先手/後手勝率 */
  crossColorWins: ColorWins;
  /** 単発四ペナルティ総数（候補手内） */
  singleFourPenaltyCount: number;
  /** depthHistory 付き着手数と最善手変化数 */
  depthHistoryMoves: number;
  depthChangeMoves: number;
  /** 思考時間が長すぎる着手（全プレイヤー合計、timeLimit超過） */
  totalSlowMoves: number;
}

// ============================================================================
// 統計計算
// ============================================================================

/**
 * ゲーム結果を使用する型（JSONの games 配列）
 * headless.ts の GameResult と同一構造
 */
type GameResultJSON = GameResult;

/**
 * データファイルの構造
 */
interface BenchmarkDataFile {
  timestamp: string;
  options: {
    players: string[];
    gamesPerMatchup: number;
  };
  ratings: Record<
    string,
    {
      rating: number;
      games: number;
      wins: number;
      losses: number;
      draws: number;
    }
  >;
  matchups: {
    playerA: string;
    playerB: string;
    winsA: number;
    winsB: number;
    draws: number;
  }[];
  games: GameResultJSON[];
}

function getPlayerForMove(game: GameResultJSON, moveIndex: number): string {
  // 偶数手(0,2,4...)=黒番、奇数手(1,3,5...)=白番
  const isBlackMove = moveIndex % 2 === 0;
  if (game.isABlack) {
    return isBlackMove ? game.playerA : game.playerB;
  }
  return isBlackMove ? game.playerB : game.playerA;
}

function initPlayerMoveStats(): PlayerMoveStats {
  return {
    moveCount: 0,
    totalNodes: 0,
    maxNodes: 0,
    totalCompletedDepth: 0,
    maxDepth: 0,
    interruptedCount: 0,
    hasMaxDepth: false,
    depthCounts: new Map(),
    effTotalNodes: 0,
    effTotalTtHits: 0,
    effTotalBetaCutoffs: 0,
    totalForbiddenCheckCalls: 0,
    totalBoardCopies: 0,
    totalThreatDetectionCalls: 0,
    totalEvaluationCalls: 0,
    rankCounts: new Map(),
    randomBadMoves: 0,
    thinkingTimes: [],
    thinkingTimeSum: 0,
    thinkingTimeOverCount: 0,
    slowMoves: [],
    totalNullMoveCutoffs: 0,
    totalFutilityPrunes: 0,
  };
}

function initColorWins(): ColorWins {
  return { black: 0, white: 0, draw: 0 };
}

function countSingleFourPenalties(
  candidates: { breakdown?: unknown }[],
): number {
  let count = 0;
  for (const c of candidates) {
    if (
      c.breakdown &&
      (c.breakdown as { singleFourPenalty?: number }).singleFourPenalty
    ) {
      count++;
    }
  }
  return count;
}

interface GapColorWins {
  same: ColorWins;
  blackStronger: ColorWins;
  blackWeaker: ColorWins;
}

function getGapBucket(
  blackRank: number,
  whiteRank: number,
  gapColorWins: GapColorWins,
): ColorWins {
  if (blackRank === whiteRank) {
    return gapColorWins.same;
  }
  if (blackRank > whiteRank) {
    return gapColorWins.blackStronger;
  }
  return gapColorWins.blackWeaker;
}

/**
 * 1パスで全統計を計算
 */
export function computeStats(data: BenchmarkDataFile): BenchStats {
  const { players } = data.options;

  // レーティング（rating降順）
  const ratings = Object.entries(data.ratings)
    .map(([name, r]) => ({ name, ...r }))
    .sort((a, b) => b.rating - a.rating);

  // 初期化
  const blackMatrix = new Map<string, Map<string, MatchupRecord>>();
  for (const p of players) {
    blackMatrix.set(p, new Map());
  }

  const colorWins = initColorWins();
  const selfPlayTotal = initColorWins();
  const selfPlayByPlayer = new Map<string, ColorWins>();
  const playerColorWinRates = new Map<string, PlayerColorWinRate>();
  for (const p of players) {
    selfPlayByPlayer.set(p, initColorWins());
    playerColorWinRates.set(p, {
      blackWin: 0,
      blackLose: 0,
      blackDraw: 0,
      whiteWin: 0,
      whiteLose: 0,
      whiteDraw: 0,
    });
  }

  // 難易度格差別の黒勝率
  // レーティング順で難易度のランクを決定
  const playerRank = new Map<string, number>();
  for (let i = 0; i < ratings.length; i++) {
    playerRank.set(ratings[i].name, ratings.length - 1 - i); // 高レート = 高ランク
  }
  const gapColorWins = {
    same: initColorWins(),
    blackStronger: initColorWins(),
    blackWeaker: initColorWins(),
  };

  const reasonCounts = new Map<string, number>();
  const playerStats = new Map<string, PlayerMoveStats>();
  for (const p of players) {
    playerStats.set(p, initPlayerMoveStats());
  }

  const forbiddenLossByPlayer = new Map<string, number>();
  for (const p of players) {
    forbiddenLossByPlayer.set(p, 0);
  }

  const forbiddenDetails: ForbiddenDetail[] = [];
  let forcedForbiddenCount = 0;

  // 追加統計
  let gameLengthSum = 0;
  let gameLengthMin = Infinity;
  let gameLengthMax = 0;
  const crossColorWins = initColorWins();
  let singleFourPenaltyCount = 0;
  let depthHistoryMoves = 0;
  let depthChangeMoves = 0;

  // 1パス走査
  for (let gi = 0; gi < data.games.length; gi++) {
    const game = data.games[gi];

    // 黒番・白番プレイヤーを特定
    const blackPlayer = game.isABlack ? game.playerA : game.playerB;
    const whitePlayer = game.isABlack ? game.playerB : game.playerA;

    // 勝敗判定
    let blackWon = false;
    let whiteWon = false;
    const isDraw = game.winner === "draw";
    if (!isDraw) {
      if (game.isABlack) {
        blackWon = game.winner === "A";
        whiteWon = game.winner === "B";
      } else {
        blackWon = game.winner === "B";
        whiteWon = game.winner === "A";
      }
    }

    // 黒勝敗マトリクス更新
    let cellMap = blackMatrix.get(blackPlayer);
    if (!cellMap) {
      cellMap = new Map();
      blackMatrix.set(blackPlayer, cellMap);
    }
    let cell = cellMap.get(whitePlayer);
    if (!cell) {
      cell = { blackWin: 0, whiteWin: 0, draw: 0 };
      cellMap.set(whitePlayer, cell);
    }
    if (blackWon) {
      cell.blackWin++;
    } else if (whiteWon) {
      cell.whiteWin++;
    } else {
      cell.draw++;
    }

    // 全体勝率
    if (blackWon) {
      colorWins.black++;
    } else if (whiteWon) {
      colorWins.white++;
    } else {
      colorWins.draw++;
    }

    // 難易度別 黒番/白番 勝率
    const blackPCR = playerColorWinRates.get(blackPlayer);
    const whitePCR = playerColorWinRates.get(whitePlayer);
    if (blackPCR) {
      if (blackWon) {
        blackPCR.blackWin++;
      } else if (whiteWon) {
        blackPCR.blackLose++;
      } else {
        blackPCR.blackDraw++;
      }
    }
    if (whitePCR) {
      if (whiteWon) {
        whitePCR.whiteWin++;
      } else if (blackWon) {
        whitePCR.whiteLose++;
      } else {
        whitePCR.whiteDraw++;
      }
    }

    // 難易度格差別の黒勝率
    const blackRank = playerRank.get(blackPlayer) ?? 0;
    const whiteRank = playerRank.get(whitePlayer) ?? 0;
    const gap = getGapBucket(blackRank, whiteRank, gapColorWins);
    if (blackWon) {
      gap.black++;
    } else if (whiteWon) {
      gap.white++;
    } else {
      gap.draw++;
    }

    // 同難易度対戦
    if (game.playerA === game.playerB) {
      const sp = selfPlayByPlayer.get(game.playerA);
      if (!sp) {
        continue;
      }
      if (blackWon) {
        selfPlayTotal.black++;
        sp.black++;
      } else if (whiteWon) {
        selfPlayTotal.white++;
        sp.white++;
      } else {
        selfPlayTotal.draw++;
        sp.draw++;
      }
    }

    // ゲーム長
    gameLengthSum += game.moves;
    if (game.moves < gameLengthMin) {
      gameLengthMin = game.moves;
    }
    if (game.moves > gameLengthMax) {
      gameLengthMax = game.moves;
    }

    // 異難易度対戦の先手/後手勝率
    if (game.playerA !== game.playerB) {
      if (blackWon) {
        crossColorWins.black++;
      } else if (whiteWon) {
        crossColorWins.white++;
      } else {
        crossColorWins.draw++;
      }
    }

    // 勝利理由
    reasonCounts.set(game.reason, (reasonCounts.get(game.reason) ?? 0) + 1);

    // 禁手負け
    if (game.reason === "forbidden") {
      // 黒番プレイヤーが禁手負け
      forbiddenLossByPlayer.set(
        blackPlayer,
        (forbiddenLossByPlayer.get(blackPlayer) ?? 0) + 1,
      );

      const lastMove = game.moveHistory[game.moveHistory.length - 1] as
        | MoveRecord
        | undefined;
      const forced = lastMove?.forcedForbidden === true;
      if (forced) {
        forcedForbiddenCount++;
      }

      forbiddenDetails.push({
        gameIndex: gi,
        winner: whitePlayer,
        type: forced ? "禁手追い込み" : "自滅",
        playerA: game.playerA,
        playerB: game.playerB,
        moves: game.moves,
      });
    }

    // 着手走査
    for (let mi = 0; mi < game.moveHistory.length; mi++) {
      const move = game.moveHistory[mi] as MoveRecord;
      const player = getPlayerForMove(game, mi);
      const ps = playerStats.get(player);
      if (!ps) {
        continue;
      }

      const stats = move.stats as SearchStatsRecord | undefined;

      // 探索統計
      if (stats) {
        ps.moveCount++;
        ps.totalNodes += stats.nodes;
        if (stats.nodes > ps.maxNodes) {
          ps.maxNodes = stats.nodes;
        }
        ps.totalCompletedDepth += stats.completedDepth;
        if (!ps.hasMaxDepth) {
          ps.maxDepth = stats.maxDepth;
          ps.hasMaxDepth = true;
        }
        if (stats.interrupted) {
          ps.interruptedCount++;
        }

        // 深度分布
        const d = stats.completedDepth;
        ps.depthCounts.set(d, (ps.depthCounts.get(d) ?? 0) + 1);

        // 探索効率（nodes > 0）
        if (stats.nodes > 0) {
          ps.effTotalNodes += stats.nodes;
          ps.effTotalTtHits += stats.ttHits;
          ps.effTotalBetaCutoffs += stats.betaCutoffs;

          // プロファイリング
          ps.totalForbiddenCheckCalls += stats.forbiddenCheckCalls ?? 0;
          ps.totalBoardCopies += stats.boardCopies ?? 0;
          ps.totalThreatDetectionCalls += stats.threatDetectionCalls ?? 0;
          ps.totalEvaluationCalls += stats.evaluationCalls ?? 0;
          ps.totalNullMoveCutoffs += stats.nullMoveCutoffs ?? 0;
          ps.totalFutilityPrunes += stats.futilityPrunes ?? 0;
        }
      }

      // 思考時間（開局は除外）
      if (!move.isOpening && move.time > 0) {
        ps.thinkingTimes.push(move.time);
        ps.thinkingTimeSum += move.time;
        // timeLimit 超過チェック
        const params =
          DIFFICULTY_PARAMS[player as keyof typeof DIFFICULTY_PARAMS];
        if (params && move.time >= params.timeLimit) {
          ps.thinkingTimeOverCount++;
          ps.slowMoves.push({
            gameIndex: gi,
            moveIndex: mi,
            time: move.time,
            playerA: game.playerA,
            playerB: game.playerB,
          });
        }
      }

      // 選択順位・単発四ペナルティ（candidates がある着手のみ）
      if (move.candidates) {
        const rank = move.selectedRank ?? ("out" as const);
        ps.rankCounts.set(rank, (ps.rankCounts.get(rank) ?? 0) + 1);

        singleFourPenaltyCount += countSingleFourPenalties(move.candidates);
      }

      // 深度変化
      if (move.depthHistory && move.depthHistory.length > 1) {
        depthHistoryMoves++;
        const positions = new Set(
          move.depthHistory.map(
            (d: { row: number; col: number }) => `${d.row},${d.col}`,
          ),
        );
        if (positions.size > 1) {
          depthChangeMoves++;
        }
      }

      // ランダム悪手
      if (
        move.randomSelection &&
        (move.randomSelection as { wasRandom?: boolean }).wasRandom === true &&
        move.candidates &&
        move.candidates.length > 1
      ) {
        const topScore = move.candidates[0].searchScore;
        const myScore = move.score;
        if (
          topScore !== undefined &&
          myScore !== undefined &&
          topScore - myScore > 500
        ) {
          ps.randomBadMoves++;
        }
      }
    }
  }

  // 思考時間をソート（パーセンタイル計算用）、slowMoves を上位5件に絞る
  let totalSlowMoves = 0;
  for (const ps of playerStats.values()) {
    totalSlowMoves += ps.thinkingTimeOverCount;
    ps.thinkingTimes.sort((a, b) => a - b);
    ps.slowMoves.sort((a, b) => b.time - a.time);
    ps.slowMoves = ps.slowMoves.slice(0, 5);
  }

  return {
    timestamp: data.timestamp,
    totalGames: data.games.length,
    players,
    gamesPerMatchup: data.options.gamesPerMatchup,
    ratings,
    matchups: data.matchups,
    blackMatrix,
    colorWins,
    selfPlayTotal,
    selfPlayByPlayer,
    playerColorWinRates,
    gapColorWins,
    reasonCounts,
    playerStats,
    forbiddenLossByPlayer,
    forbiddenDetails,
    forcedForbiddenCount,
    gameLengthAvg:
      data.games.length > 0 ? gameLengthSum / data.games.length : 0,
    gameLengthMin: gameLengthMin === Infinity ? 0 : gameLengthMin,
    gameLengthMax,
    crossColorWins,
    singleFourPenaltyCount,
    depthHistoryMoves,
    depthChangeMoves,
    totalSlowMoves,
  };
}

// ============================================================================
// フォーマット出力
// ============================================================================

function pad(s: string, width: number): string {
  return s.padStart(width);
}

/**
 * 統計をフォーマットして出力文字列を生成（analyze-bench.sh 互換）
 */
export function formatStats(stats: BenchStats, filename: string): string {
  const lines: string[] = [];
  const ln = (s = ""): number => lines.push(s);

  const getPS = (player: string): PlayerMoveStats => {
    const ps = stats.playerStats.get(player);
    if (!ps) {
      throw new Error(`Unknown player: ${player}`);
    }
    return ps;
  };

  // ヘッダー
  ln(`=== ベンチマーク分析: ${filename} ===`);
  ln();

  // 基本情報
  ln("【基本情報】");
  ln(`  日時: ${stats.timestamp}`);
  ln(`  総ゲーム数: ${stats.totalGames}`);
  ln(`  プレイヤー: ${stats.players.join(", ")}`);
  ln(`  各マッチアップ: ${stats.gamesPerMatchup}ゲーム`);
  ln();

  // レーティング
  ln("【レーティング結果】");
  for (const r of stats.ratings) {
    const winPct = Math.floor((r.wins * 100) / r.games);
    ln(
      `  ${r.name}: ${Math.floor(r.rating)} (${r.wins}W-${r.losses}L-${r.draws}D, ${winPct}%)`,
    );
  }
  ln();

  // レーティング差
  ln("【レーティング差（隣接難易度間）】");
  for (let i = 0; i < stats.ratings.length - 1; i++) {
    const a = stats.ratings[i];
    const b = stats.ratings[i + 1];
    ln(`  ${a.name} - ${b.name}: ${Math.floor(a.rating - b.rating)}`);
  }
  ln();

  // マッチアップ結果
  ln("【マッチアップ結果】");
  for (const m of stats.matchups) {
    ln(`  ${m.playerA} vs ${m.playerB}: ${m.winsA}-${m.winsB}-${m.draws}`);
  }
  ln();

  // 先手(黒)勝敗表
  ln("【先手(黒)勝敗表】");
  ln("  行=黒番、列=白番、値=黒勝-白勝-引分");
  // ヘッダー行
  let header = pad("", 12);
  for (const col of stats.players) {
    header += pad(col, 11);
  }
  ln(header);

  for (const row of stats.players) {
    let line = pad(row, 12);
    for (const col of stats.players) {
      const cell = stats.blackMatrix.get(row)?.get(col);
      const val = cell ? `${cell.blackWin}-${cell.whiteWin}-${cell.draw}` : "-";
      line += pad(val, 11);
    }
    ln(line);
  }
  ln();

  // 後手(白)勝敗表
  ln("【後手(白)勝敗表】");
  ln("  行=白番、列=黒番、値=白勝-黒勝-引分");
  header = pad("", 12);
  for (const col of stats.players) {
    header += pad(col, 11);
  }
  ln(header);

  for (const row of stats.players) {
    let line = pad(row, 12);
    for (const col of stats.players) {
      // row = 白番、col = 黒番 → matrix[col][row] の逆
      const cell = stats.blackMatrix.get(col)?.get(row);
      const val = cell ? `${cell.whiteWin}-${cell.blackWin}-${cell.draw}` : "-";
      line += pad(val, 11);
    }
    ln(line);
  }
  ln();

  // 先手(黒)/後手(白)勝率
  ln("【先手(黒)/後手(白)勝率】");
  const total =
    stats.colorWins.black + stats.colorWins.white + stats.colorWins.draw;
  ln(
    `  黒勝利: ${stats.colorWins.black} (${Math.floor((stats.colorWins.black * 100) / total)}%)`,
  );
  ln(
    `  白勝利: ${stats.colorWins.white} (${Math.floor((stats.colorWins.white * 100) / total)}%)`,
  );
  ln(`  引分け: ${stats.colorWins.draw}`);
  ln();

  // 同難易度対戦
  const spTotal =
    stats.selfPlayTotal.black +
    stats.selfPlayTotal.white +
    stats.selfPlayTotal.draw;
  if (spTotal > 0) {
    ln("【同難易度対戦の先手(黒)/後手(白)バランス】");
    ln(
      `  黒勝利: ${stats.selfPlayTotal.black} (${spTotal > 0 ? Math.floor((stats.selfPlayTotal.black * 100) / spTotal) : 0}%)`,
    );
    ln(
      `  白勝利: ${stats.selfPlayTotal.white} (${spTotal > 0 ? Math.floor((stats.selfPlayTotal.white * 100) / spTotal) : 0}%)`,
    );
    ln(`  引分け: ${stats.selfPlayTotal.draw}`);
    ln();
    ln("  難易度別内訳:");
    for (const player of stats.players) {
      const sp = stats.selfPlayByPlayer.get(player);
      if (!sp) {
        continue;
      }
      const spPlayerTotal = sp.black + sp.white + sp.draw;
      if (spPlayerTotal > 0) {
        const pct = Math.floor((sp.black * 100) / spPlayerTotal);
        ln(`    ${player}: ${sp.black}-${sp.white}-${sp.draw} (黒${pct}%)`);
      } else {
        ln(`    ${player}: (対戦なし)`);
      }
    }
    ln();
  }

  // 難易度別 黒番/白番 勝率
  if (stats.players.length > 1) {
    ln("【難易度別 黒番/白番 勝率】");
    for (const player of stats.players) {
      const pcr = stats.playerColorWinRates.get(player);
      if (!pcr) {
        continue;
      }
      const bTotal = pcr.blackWin + pcr.blackLose + pcr.blackDraw;
      const wTotal = pcr.whiteWin + pcr.whiteLose + pcr.whiteDraw;
      const bPct = bTotal > 0 ? Math.floor((pcr.blackWin * 100) / bTotal) : 0;
      const wPct = wTotal > 0 ? Math.floor((pcr.whiteWin * 100) / wTotal) : 0;
      ln(
        `  ${player}: 黒番 ${bPct}% (${pcr.blackWin}W-${pcr.blackLose}L-${pcr.blackDraw}D/${bTotal}局), 白番 ${wPct}% (${pcr.whiteWin}W-${pcr.whiteLose}L-${pcr.whiteDraw}D/${wTotal}局)`,
      );
    }
    ln();

    // 難易度格差別の黒勝率
    ln("【難易度格差別の黒勝率】");
    for (const [label, cw] of [
      ["同難易度", stats.gapColorWins.same],
      ["黒が格上", stats.gapColorWins.blackStronger],
      ["黒が格下", stats.gapColorWins.blackWeaker],
    ] as const) {
      const gTotal = cw.black + cw.white + cw.draw;
      if (gTotal > 0) {
        const pct = Math.floor((cw.black * 100) / gTotal);
        ln(
          `  ${label}: 黒${pct}% (${cw.black}W-${cw.white}L-${cw.draw}D/${gTotal}局)`,
        );
      }
    }
    ln();
  }

  // 勝利理由
  ln("【勝利理由】");
  // group_by(.reason) の順序は reason のアルファベット順
  const sortedReasons = [...reasonEntriesSorted(stats.reasonCounts)];
  for (const [reason, count] of sortedReasons) {
    ln(`  ${reason}: ${count}`);
  }
  ln();

  // 難易度別探索統計
  ln("【難易度別探索統計】");
  for (const player of stats.players) {
    ln(`  --- ${player} ---`);
    const ps = getPS(player);
    if (ps.moveCount > 0) {
      ln(`    着手数: ${ps.moveCount}`);
      ln(`    平均ノード: ${Math.floor(ps.totalNodes / ps.moveCount)}`);
      ln(`    最大ノード: ${ps.maxNodes}`);
      ln(
        `    平均到達深度: ${Math.floor((ps.totalCompletedDepth / ps.moveCount) * 10) / 10}`,
      );
      ln(`    設定深度: ${ps.maxDepth}`);
      // 中断率: interrupted が 0 件のとき、jq はゼロ除算エラーを起こし
      // stderr に出力 → 2>/dev/null で抑制 → || echo "(データなし)" が発動する
      // この挙動を再現する
      if (ps.interruptedCount > 0) {
        ln(
          `    中断率: ${Math.floor((ps.interruptedCount * 100) / ps.moveCount)}%`,
        );
      } else {
        ln("    (データなし)");
      }
    } else {
      ln("    (データなし)");
    }
  }
  ln();

  // 深度分布
  ln("【深度分布】");
  for (const player of stats.players) {
    const ps = getPS(player);
    if (ps.depthCounts.size > 0) {
      const sorted = [...ps.depthCounts.entries()].sort((a, b) => a[0] - b[0]);
      const parts = sorted.map(([d, c]) => `d${d}:${c}`);
      ln(`  ${player}: ${parts.join(", ")}`);
    } else {
      ln(`  ${player}: (データなし)`);
    }
  }
  ln();

  // 難易度別探索効率
  ln("【難易度別探索効率】");
  for (const player of stats.players) {
    const ps = getPS(player);
    if (ps.effTotalNodes > 0) {
      const ttPct =
        Math.floor((ps.effTotalTtHits * 100 * 10) / ps.effTotalNodes) / 10;
      const betaPct =
        Math.floor((ps.effTotalBetaCutoffs * 100 * 10) / ps.effTotalNodes) / 10;
      ln(`  ${player}: TTヒット ${ttPct}%, Beta cutoff ${betaPct}%`);
    } else {
      ln(`  ${player}: (データなし)`);
    }
  }
  ln();

  // 難易度別詳細プロファイリング
  ln("【難易度別詳細プロファイリング】");
  for (const player of stats.players) {
    ln(`  --- ${player} ---`);
    const ps = getPS(player);
    if (ps.effTotalNodes > 0) {
      const nodes = ps.effTotalNodes;
      const fmtRatio = (v: number): number => Math.floor((v * 10) / nodes) / 10;
      ln(
        `    禁手判定: ${ps.totalForbiddenCheckCalls} (ノード比: ${fmtRatio(ps.totalForbiddenCheckCalls)})`,
      );
      ln(
        `    盤面コピー: ${ps.totalBoardCopies} (ノード比: ${fmtRatio(ps.totalBoardCopies)})`,
      );
      ln(
        `    脅威検出: ${ps.totalThreatDetectionCalls} (ノード比: ${fmtRatio(ps.totalThreatDetectionCalls)})`,
      );
      ln(
        `    評価関数: ${ps.totalEvaluationCalls} (ノード比: ${fmtRatio(ps.totalEvaluationCalls)})`,
      );
      if (ps.totalNullMoveCutoffs > 0) {
        ln(`    NMPカットオフ: ${ps.totalNullMoveCutoffs}`);
      }
      if (ps.totalFutilityPrunes > 0) {
        ln(`    Futilityスキップ: ${ps.totalFutilityPrunes}`);
      }
    } else {
      ln("    (データなし)");
    }
  }
  ln();

  // 難易度別選択順位分布
  ln("【難易度別選択順位分布】");
  for (const player of stats.players) {
    const ps = getPS(player);
    if (ps.rankCounts.size > 0) {
      // 数値キーをソート、"out" は最後
      const entries = [...ps.rankCounts.entries()];
      const numEntries = entries
        .filter((e): e is [number, number] => typeof e[0] === "number")
        .sort((a, b) => a[0] - b[0]);
      const outEntry = entries.find((e) => e[0] === "out");
      const parts: string[] = [];
      for (const [rank, count] of numEntries) {
        parts.push(`R${rank}:${count}`);
      }
      if (outEntry) {
        parts.push(`候補外:${outEntry[1]}`);
      }
      ln(`  ${player}: ${parts.join(", ")}`);
    } else {
      ln(`  ${player}: (データなし)`);
    }
  }
  ln();

  // 難易度別ランダム悪手
  ln("【難易度別ランダム悪手（スコア差500以上）】");
  for (const player of stats.players) {
    const ps = getPS(player);
    ln(`  ${player}: ${ps.randomBadMoves}回`);
  }
  ln();

  // 難易度別禁手負け
  ln("【難易度別禁手負け】");
  for (const player of stats.players) {
    const count = stats.forbiddenLossByPlayer.get(player) ?? 0;
    ln(`  ${player}: ${count}回`);
  }
  ln();

  // 禁手負け詳細
  if (stats.forbiddenDetails.length > 0) {
    ln("【禁手負けの詳細】");
    for (const d of stats.forbiddenDetails) {
      ln(
        `  game ${d.gameIndex}: ${d.winner}が${d.type}で勝利 (${d.playerA} vs ${d.playerB}, ${d.moves}手)`,
      );
    }
    ln();
    ln(
      `  禁手追い込み成功: ${stats.forcedForbiddenCount}/${stats.forbiddenDetails.length}件`,
    );
    ln();
  }

  // ゲーム長統計
  ln("【ゲーム長統計】");
  ln(
    `  平均手数: ${Math.floor(stats.gameLengthAvg)}, 最短: ${stats.gameLengthMin}, 最長: ${stats.gameLengthMax}`,
  );
  ln();

  // 異難易度対戦の先手/後手勝率
  const crossTotal =
    stats.crossColorWins.black +
    stats.crossColorWins.white +
    stats.crossColorWins.draw;
  if (crossTotal > 0) {
    ln("【異難易度対戦の先手(黒)/後手(白)勝率】");
    ln(
      `  黒勝利: ${stats.crossColorWins.black} (${Math.floor((stats.crossColorWins.black * 100) / crossTotal)}%)`,
    );
    ln(
      `  白勝利: ${stats.crossColorWins.white} (${Math.floor((stats.crossColorWins.white * 100) / crossTotal)}%)`,
    );
    ln(`  引分け: ${stats.crossColorWins.draw}`);
    ln();
  }

  // 単発四ペナルティ
  ln("【単発四ペナルティ】");
  ln(`  候補手内発生: ${stats.singleFourPenaltyCount}回`);
  ln();

  // 深度変化
  ln("【深度変化（最善手の安定性）】");
  if (stats.depthHistoryMoves > 0) {
    const changePct = Math.floor(
      (stats.depthChangeMoves * 100) / stats.depthHistoryMoves,
    );
    ln(
      `  depthHistory付き着手: ${stats.depthHistoryMoves}, 最善手変化: ${stats.depthChangeMoves}回 (${changePct}%)`,
    );
  } else {
    ln("  (depthHistoryデータなし)");
  }
  ln();

  // 思考時間統計
  ln("【難易度別思考時間】");
  for (const player of stats.players) {
    const ps = getPS(player);
    const times = ps.thinkingTimes;
    if (times.length > 0) {
      const avg = Math.floor(ps.thinkingTimeSum / times.length);
      const p50 = Math.floor(percentile(times, 50));
      const p90 = Math.floor(percentile(times, 90));
      const p95 = Math.floor(percentile(times, 95));
      const p99 = Math.floor(percentile(times, 99));
      const max = Math.floor(times[times.length - 1]);
      ln(`  ${player}: (${times.length}手)`);
      ln(
        `    平均 ${avg}ms, p50 ${p50}ms, p90 ${p90}ms, p95 ${p95}ms, p99 ${p99}ms, max ${max}ms`,
      );
      if (ps.thinkingTimeOverCount > 0) {
        const params =
          DIFFICULTY_PARAMS[player as keyof typeof DIFFICULTY_PARAMS];
        const limit = params?.timeLimit ?? "?";
        ln(`    ⚠ timeLimit超過(≥${limit}ms): ${ps.thinkingTimeOverCount}回`);
        for (const sm of ps.slowMoves) {
          ln(
            `      game ${sm.gameIndex} move ${sm.moveIndex}: ${sm.time}ms (${sm.playerA} vs ${sm.playerB})`,
          );
        }
      }
    } else {
      ln(`  ${player}: (データなし)`);
    }
  }
  ln();

  ln("=== 分析完了 ===");

  return `${lines.join("\n")}\n`;
}

/**
 * ソート済み配列からパーセンタイル値を計算（線形補間）
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sorted[lo];
  }
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * jq の group_by(.reason) と同等のソート（reason 値のアルファベット順）
 */
function reasonEntriesSorted(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
