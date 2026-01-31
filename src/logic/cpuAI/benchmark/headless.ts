/**
 * ヘッドレス対局エンジン
 *
 * GUI なしで CPU AI 同士の対局を実行する
 */

import type { BoardState, Position, StoneColor } from "../../../types/game.ts";

import {
  DIFFICULTY_PARAMS,
  type CpuDifficulty,
  type DifficultyParams,
} from "../../../types/cpu.ts";
import {
  checkForbiddenMove,
  checkWin,
  createEmptyBoard,
} from "../../renjuRules.ts";
import { findBestMoveIterativeWithTT } from "../minimax.ts";
import { getOpeningMove, isOpeningPhase } from "../opening.ts";
import { applyMove, countStones } from "../utils.ts";

/**
 * プレイヤー設定
 */
export interface PlayerConfig {
  /** プレイヤー識別子 */
  id: string;
  /** 難易度 */
  difficulty: CpuDifficulty;
  /** カスタムパラメータ（オプション） */
  customParams?: Partial<DifficultyParams>;
}

/**
 * 対局結果
 */
export interface GameResult {
  /** プレイヤーA識別子 */
  playerA: string;
  /** プレイヤーB識別子 */
  playerB: string;
  /** 勝者（"A" | "B" | "draw"） */
  winner: "A" | "B" | "draw";
  /** 終局理由 */
  reason: "five" | "forbidden" | "draw" | "max_moves";
  /** 手数 */
  moves: number;
  /** 対局時間（ミリ秒） */
  duration: number;
  /** 棋譜 */
  moveHistory: Position[];
}

/**
 * 対局オプション
 */
export interface GameOptions {
  /** 最大手数（デフォルト: 225） */
  maxMoves?: number;
  /** 詳細ログ出力 */
  verbose?: boolean;
}

/**
 * 難易度パラメータを取得
 */
function getParams(config: PlayerConfig): DifficultyParams {
  const base = DIFFICULTY_PARAMS[config.difficulty];
  if (!config.customParams) {
    return base;
  }
  return {
    ...base,
    ...config.customParams,
    evaluationOptions: {
      ...base.evaluationOptions,
      ...config.customParams.evaluationOptions,
    },
  };
}

/**
 * ヘッドレス対局を実行
 *
 * @param playerA 黒番（先手）プレイヤー設定
 * @param playerB 白番（後手）プレイヤー設定
 * @param options 対局オプション
 * @returns 対局結果
 */
export function runHeadlessGame(
  playerA: PlayerConfig,
  playerB: PlayerConfig,
  options: GameOptions = {},
): GameResult {
  const { maxMoves = 225, verbose = false } = options;

  const startTime = performance.now();
  let board: BoardState = createEmptyBoard();
  const moveHistory: Position[] = [];
  let currentColor: StoneColor = "black";
  let moveCount = 0;

  const paramsA = getParams(playerA);
  const paramsB = getParams(playerB);

  const log = (message: string): void => {
    if (verbose) {
      // eslint-disable-next-line no-console
      console.log(message);
    }
  };

  log(`Game: ${playerA.id} (black) vs ${playerB.id} (white)`);

  while (moveCount < maxMoves) {
    const isBlack = currentColor === "black";
    const config = isBlack ? playerA : playerB;
    const params = isBlack ? paramsA : paramsB;

    // 着手を決定
    let move: Position | null = null;

    // 開局フェーズ
    const stoneCount = countStones(board);
    if (isOpeningPhase(stoneCount)) {
      move = getOpeningMove(board, currentColor);
    }

    // 通常の探索
    if (!move) {
      const result = findBestMoveIterativeWithTT(
        board,
        currentColor,
        params.depth,
        params.timeLimit,
        params.randomFactor,
        params.evaluationOptions,
      );
      move = result.position;
    }

    if (!move) {
      // 着手不可（全マス埋まっている）
      log("No valid move available - draw");
      return {
        playerA: playerA.id,
        playerB: playerB.id,
        winner: "draw",
        reason: "draw",
        moves: moveCount,
        duration: performance.now() - startTime,
        moveHistory,
      };
    }

    // 黒の禁手チェック
    if (currentColor === "black") {
      const forbidden = checkForbiddenMove(board, move.row, move.col);
      if (forbidden.isForbidden) {
        log(
          `Move ${moveCount + 1}: ${config.id} plays forbidden move at (${move.row}, ${move.col}) - ${forbidden.type}`,
        );
        // 禁手は白の勝利
        return {
          playerA: playerA.id,
          playerB: playerB.id,
          winner: "B",
          reason: "forbidden",
          moves: moveCount + 1,
          duration: performance.now() - startTime,
          moveHistory: [...moveHistory, move],
        };
      }
    }

    // 着手を適用
    board = applyMove(board, move, currentColor);
    moveHistory.push(move);
    moveCount++;

    log(`Move ${moveCount}: ${config.id} plays at (${move.row}, ${move.col})`);

    // 勝利判定
    if (checkWin(board, move, currentColor)) {
      log(`${config.id} wins with five in a row!`);
      return {
        playerA: playerA.id,
        playerB: playerB.id,
        winner: isBlack ? "A" : "B",
        reason: "five",
        moves: moveCount,
        duration: performance.now() - startTime,
        moveHistory,
      };
    }

    // 手番交代
    currentColor = currentColor === "black" ? "white" : "black";
  }

  // 最大手数到達
  log("Max moves reached - draw");
  return {
    playerA: playerA.id,
    playerB: playerB.id,
    winner: "draw",
    reason: "max_moves",
    moves: moveCount,
    duration: performance.now() - startTime,
    moveHistory,
  };
}

/**
 * 複数対局を実行
 *
 * @param playerA プレイヤーA設定
 * @param playerB プレイヤーB設定
 * @param numGames 対局数
 * @param options 対局オプション
 * @returns 対局結果の配列
 */
export function runMultipleGames(
  playerA: PlayerConfig,
  playerB: PlayerConfig,
  numGames: number,
  options: GameOptions = {},
): GameResult[] {
  const results: GameResult[] = [];

  for (let i = 0; i < numGames; i++) {
    // 先手/後手を交互に
    const isABlack = i % 2 === 0;
    const black = isABlack ? playerA : playerB;
    const white = isABlack ? playerB : playerA;

    const result = runHeadlessGame(black, white, options);

    // 結果を正規化（常にplayerA/playerBの視点で記録）
    if (isABlack) {
      results.push(result);
    } else {
      // A が白番だった場合、winner を反転
      const invertWinner = (w: "A" | "B" | "draw"): "A" | "B" | "draw" => {
        if (w === "A") {
          return "B";
        }
        if (w === "B") {
          return "A";
        }
        return "draw";
      };
      results.push({
        ...result,
        playerA: playerA.id,
        playerB: playerB.id,
        winner: invertWinner(result.winner),
      });
    }
  }

  return results;
}

/**
 * 対局統計を計算
 */
export interface GameStats {
  /** 総対局数 */
  total: number;
  /** プレイヤーA勝利数 */
  winsA: number;
  /** プレイヤーB勝利数 */
  winsB: number;
  /** 引き分け数 */
  draws: number;
  /** プレイヤーA勝率 */
  winRateA: number;
  /** 平均手数 */
  avgMoves: number;
  /** 平均対局時間（ミリ秒） */
  avgDuration: number;
}

/**
 * 対局結果から統計を計算
 *
 * @param results 対局結果の配列
 * @returns 統計情報
 */
export function calculateStats(results: GameResult[]): GameStats {
  const total = results.length;
  if (total === 0) {
    return {
      total: 0,
      winsA: 0,
      winsB: 0,
      draws: 0,
      winRateA: 0,
      avgMoves: 0,
      avgDuration: 0,
    };
  }

  const winsA = results.filter((r) => r.winner === "A").length;
  const winsB = results.filter((r) => r.winner === "B").length;
  const draws = results.filter((r) => r.winner === "draw").length;
  const totalMoves = results.reduce((sum, r) => sum + r.moves, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  return {
    total,
    winsA,
    winsB,
    draws,
    winRateA: winsA / total,
    avgMoves: totalMoves / total,
    avgDuration: totalDuration / total,
  };
}
