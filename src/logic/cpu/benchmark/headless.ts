/**
 * ヘッドレス対局エンジン
 *
 * GUI なしで CPU同士の対局を実行する
 */

import type { BoardState, Position } from "../../../types/game.ts";

import {
  DIFFICULTY_PARAMS,
  type CandidateMove,
  type CpuDifficulty,
  type DepthResult,
  type DifficultyParams,
  type RandomSelectionInfo,
  type ScoreBreakdown,
} from "../../../types/cpu.ts";
import {
  checkDraw,
  checkForbiddenMove,
  checkWin,
  createEmptyBoard,
  DRAW_MOVE_LIMIT,
} from "../../renjuRules.ts";
import { applyMove, countStones } from "../core/boardUtils.ts";
import {
  evaluateBoardWithBreakdown,
  evaluatePositionWithBreakdown,
} from "../evaluation.ts";
import {
  applyPatternScoreOverrides,
  PATTERN_SCORES,
  type PatternScoreValues,
} from "../evaluation/patternScores.ts";
import { detectOpponentThreats } from "../evaluation/threatDetection.ts";
import { getOpeningMove, isOpeningPhase } from "../opening.ts";
import { findBestMoveIterativeWithTT } from "../search/minimax.ts";

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
 * 探索統計情報
 */
export interface SearchStatsRecord {
  /** 探索ノード数 */
  nodes: number;
  /** TTヒット数 */
  ttHits: number;
  /** TTカットオフ数 */
  ttCutoffs: number;
  /** Beta剪定数 */
  betaCutoffs: number;
  /** 設定された最大探索深度 */
  maxDepth: number;
  /** 実際に到達した探索深度 */
  completedDepth: number;
  /** 中断されたか */
  interrupted: boolean;
  /** 禁手判定回数 */
  forbiddenCheckCalls: number;
  /** 盤面コピー回数 */
  boardCopies: number;
  /** 脅威検出回数 */
  threatDetectionCalls: number;
  /** 評価関数呼び出し回数 */
  evaluationCalls: number;
  /** Null Move Pruning によるカットオフ数 */
  nullMoveCutoffs?: number;
  /** Futility Pruning によるスキップ数 */
  futilityPrunes?: number;
}

/**
 * 着手記録（Position を拡張）
 */
export interface MoveRecord {
  /** 行 */
  row: number;
  /** 列 */
  col: number;
  /** 思考時間（ミリ秒） */
  time: number;
  /** 開局定石だったか */
  isOpening: boolean;
  /** 到達探索深度（開局時は undefined） */
  depth?: number;
  /** 探索統計（開局時は undefined） */
  stats?: SearchStatsRecord;
  /** 選択された手のスコア */
  score?: number;
  /** 上位候補手（最大5手、breakdown/PV/leafEvaluation含む） */
  candidates?: CandidateMove[];
  /** 選択された手の順位（1始まり） */
  selectedRank?: number;
  /** ランダム選択情報 */
  randomSelection?: RandomSelectionInfo;
  /** 深度別の最善手履歴 */
  depthHistory?: DepthResult[];
  /** 禁手追い込みで勝った場合true（最終手のみ） */
  forcedForbidden?: boolean;
  /** 強制手フラグ（候補手1つ、スコアは参考値） */
  forcedMove?: boolean;
  /** 時間制限フォールバックが発動したか */
  timePressureFallback?: boolean;
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
  reason: "five" | "forbidden" | "draw" | "move_limit";
  /** 手数 */
  moves: number;
  /** 対局時間（ミリ秒） */
  duration: number;
  /** 棋譜（思考時間付き） */
  moveHistory: MoveRecord[];
  /** プレイヤーAが黒番（先手）か */
  isABlack: boolean;
}

/**
 * 対局オプション
 */
export interface GameOptions {
  /** 最大手数（デフォルト: DRAW_MOVE_LIMIT = 70） */
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
  const { maxMoves = DRAW_MOVE_LIMIT, verbose = false } = options;

  const startTime = performance.now();
  let board: BoardState = createEmptyBoard();
  const moveHistory: MoveRecord[] = [];
  let currentColor: "black" | "white" = "black";
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

    // 思考時間計測開始
    const moveStartTime = performance.now();
    let isOpening = false;
    let depth: number | undefined = undefined;

    // 着手を決定
    let move: Position | null = null;

    // 開局フェーズ
    const stoneCount = countStones(board);
    if (isOpeningPhase(stoneCount)) {
      move = getOpeningMove(board, currentColor);
      if (move) {
        isOpening = true;
      }
    }

    // 通常の探索
    let stats: SearchStatsRecord | undefined = undefined;
    let score: number | undefined = undefined;
    let candidates: CandidateMove[] | undefined = undefined;
    let selectedRank: number | undefined = undefined;
    let randomSelection: RandomSelectionInfo | undefined = undefined;
    let depthHistory: DepthResult[] | undefined = undefined;
    let forcedMove: boolean | undefined = undefined;
    let timePressureFallback: boolean | undefined = undefined;

    if (!move) {
      // パターンスコアオーバーライドの適用（チューニング用）
      const overrides = params.evaluationOptions.patternScoreOverrides;
      let savedScores: Partial<PatternScoreValues> | undefined = undefined;
      if (overrides) {
        // 現在の値を保存
        savedScores = {} as Partial<PatternScoreValues>;
        for (const key of Object.keys(
          overrides,
        ) as (keyof PatternScoreValues)[]) {
          (savedScores as Record<string, unknown>)[key] = PATTERN_SCORES[key];
        }
        applyPatternScoreOverrides(overrides);
      }

      const result = findBestMoveIterativeWithTT(
        board,
        currentColor,
        params.depth,
        params.timeLimit,
        params.randomFactor,
        params.evaluationOptions,
        params.maxNodes,
      );
      move = result.position;
      depth = result.completedDepth;
      ({ score } = result);
      ({ forcedMove } = result);
      ({ timePressureFallback } = result);

      // 候補手情報を記録（最大5手、breakdown/PV/leafEvaluation含む）
      if (result.candidates && result.candidates.length > 0) {
        // ループ外変数をキャプチャ（no-loop-func対策）
        const capturedBoard = board;
        const capturedColor = currentColor;
        candidates = result.candidates.slice(0, 5).map((entry, index) => {
          // 即時評価の内訳を計算
          const { score: breakdownScore, breakdown } =
            evaluatePositionWithBreakdown(
              capturedBoard,
              entry.move.row,
              entry.move.col,
              capturedColor,
              params.evaluationOptions,
            );

          // 探索末端の評価内訳を計算（PVがある場合）
          const leafEvaluation =
            entry.pvLeafBoard && entry.pvLeafColor
              ? evaluateBoardWithBreakdown(entry.pvLeafBoard, capturedColor)
              : undefined;

          return {
            position: entry.move,
            score: Math.round(breakdownScore), // 即時評価（内訳の合計）
            searchScore: entry.score, // 探索スコア（順位の根拠）
            rank: index + 1,
            breakdown: breakdown as ScoreBreakdown,
            principalVariation: entry.pv, // 予想手順
            leafEvaluation, // 探索末端の評価内訳
          };
        });

        // 選択された手の順位を計算（上位5候補内の場合のみ）
        const rankIndex = candidates.findIndex(
          (c) => c.position.row === move?.row && c.position.col === move?.col,
        );
        selectedRank = rankIndex >= 0 ? rankIndex + 1 : undefined;
      }

      // ランダム選択情報を記録（randomFactorを追加）
      if (result.randomSelection) {
        randomSelection = {
          ...result.randomSelection,
          randomFactor: params.randomFactor,
        };
      }

      // 深度履歴を記録
      depthHistory = result.depthHistory?.map((entry) => ({
        depth: entry.depth,
        position: entry.position,
        score: entry.score,
      }));

      stats = {
        nodes: result.stats.nodes,
        ttHits: result.stats.ttHits,
        ttCutoffs: result.stats.ttCutoffs,
        betaCutoffs: result.stats.betaCutoffs,
        maxDepth: params.depth,
        completedDepth: result.completedDepth,
        interrupted: result.interrupted,
        forbiddenCheckCalls: result.stats.forbiddenCheckCalls,
        boardCopies: result.stats.boardCopies,
        threatDetectionCalls: result.stats.threatDetectionCalls,
        evaluationCalls: result.stats.evaluationCalls,
        nullMoveCutoffs: result.stats.nullMoveCutoffs,
        futilityPrunes: result.stats.futilityPrunes,
      };

      // パターンスコアオーバーライドの復元
      if (savedScores) {
        applyPatternScoreOverrides(savedScores);
      }
    }

    const moveTime = performance.now() - moveStartTime;

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
        isABlack: true,
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
        const forbiddenMoveRecord: MoveRecord = {
          row: move.row,
          col: move.col,
          time: moveTime,
          isOpening,
          depth,
          stats,
          score,
          candidates,
          selectedRank,
          randomSelection,
          depthHistory,
        };
        return {
          playerA: playerA.id,
          playerB: playerB.id,
          winner: "B",
          reason: "forbidden",
          moves: moveCount + 1,
          duration: performance.now() - startTime,
          moveHistory: [...moveHistory, forbiddenMoveRecord],
          isABlack: true,
        };
      }
    }

    // 着手を適用
    board = applyMove(board, move, currentColor);
    moveHistory.push({
      row: move.row,
      col: move.col,
      time: moveTime,
      isOpening,
      depth,
      stats,
      score,
      candidates,
      selectedRank,
      randomSelection,
      depthHistory,
      forcedMove,
      timePressureFallback,
    });
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
        isABlack: true,
      };
    }

    // 禁手追い込み判定（白が着手した後、黒の防御位置が禁手なら白の勝ち）
    if (currentColor === "white") {
      const whiteThreats = detectOpponentThreats(board, "white");
      // 白の活四または止め四があるか
      const defensePosArray =
        whiteThreats.openFours.length > 0
          ? whiteThreats.openFours
          : whiteThreats.fours;

      const [defensePos] = defensePosArray;
      if (defensePos) {
        const forbiddenResult = checkForbiddenMove(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          log(
            `${config.id} wins by forbidden trap! Defense position (${defensePos.row}, ${defensePos.col}) is ${forbiddenResult.type}`,
          );
          // 最終手にforcedForbidden: trueを追加
          const lastMove = moveHistory[moveHistory.length - 1];
          const updatedMoveHistory = lastMove
            ? [
                ...moveHistory.slice(0, -1),
                { ...lastMove, forcedForbidden: true },
              ]
            : moveHistory;
          return {
            playerA: playerA.id,
            playerB: playerB.id,
            winner: "B", // 白（後手）の勝ち
            reason: "forbidden",
            moves: moveCount,
            duration: performance.now() - startTime,
            moveHistory: updatedMoveHistory,
            isABlack: true,
          };
        }
      }
    }

    // 引き分け判定（ゲームルールとして70手で引き分け）
    if (checkDraw(moveCount)) {
      log(`Move limit (${DRAW_MOVE_LIMIT}) reached - draw`);
      return {
        playerA: playerA.id,
        playerB: playerB.id,
        winner: "draw",
        reason: "move_limit",
        moves: moveCount,
        duration: performance.now() - startTime,
        moveHistory,
        isABlack: true,
      };
    }

    // 手番交代
    currentColor = currentColor === "black" ? "white" : "black";
  }

  // 最大手数到達（maxMovesオプションによる打ち切り、通常はここには来ない）
  log("Max moves reached - draw");
  return {
    playerA: playerA.id,
    playerB: playerB.id,
    winner: "draw",
    reason: "move_limit",
    moves: moveCount,
    duration: performance.now() - startTime,
    moveHistory,
    isABlack: true,
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
      results.push({
        ...result,
        isABlack: true,
      });
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
        isABlack: false,
      });
    }
  }

  return results;
}

/**
 * 思考時間統計
 */
export interface ThinkingTimeStats {
  /** 平均思考時間（ミリ秒） */
  avg: number;
  /** 最小思考時間（ミリ秒） */
  min: number;
  /** 最大思考時間（ミリ秒） */
  max: number;
  /** 中央値思考時間（ミリ秒） */
  median: number;
  /** 着手数 */
  count: number;
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
  /** プレイヤーA思考時間統計 */
  thinkingTimeA: ThinkingTimeStats;
  /** プレイヤーB思考時間統計 */
  thinkingTimeB: ThinkingTimeStats;
}

/**
 * 思考時間統計を計算するヘルパー関数
 */
function calculateThinkingTimeStats(times: number[]): ThinkingTimeStats {
  if (times.length === 0) {
    return { avg: 0, min: 0, max: 0, median: 0, count: 0 };
  }

  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, t) => acc + t, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

  return {
    avg: sum / sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    median,
    count: sorted.length,
  };
}

/**
 * 対局結果から統計を計算
 *
 * @param results 対局結果の配列
 * @returns 統計情報
 */
export function calculateStats(results: GameResult[]): GameStats {
  const emptyThinkingStats: ThinkingTimeStats = {
    avg: 0,
    min: 0,
    max: 0,
    median: 0,
    count: 0,
  };

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
      thinkingTimeA: emptyThinkingStats,
      thinkingTimeB: emptyThinkingStats,
    };
  }

  const winsA = results.filter((r) => r.winner === "A").length;
  const winsB = results.filter((r) => r.winner === "B").length;
  const draws = results.filter((r) => r.winner === "draw").length;
  const totalMoves = results.reduce((sum, r) => sum + r.moves, 0);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  // プレイヤーごとの思考時間を集計
  // isABlack=true: 偶数インデックス=A（黒）、奇数インデックス=B（白）
  // isABlack=false: 偶数インデックス=B（黒）、奇数インデックス=A（白）
  const timesA: number[] = [];
  const timesB: number[] = [];

  for (const result of results) {
    for (let i = 0; i < result.moveHistory.length; i++) {
      const move = result.moveHistory[i];
      if (!move) {
        continue;
      }

      const isEvenIndex = i % 2 === 0;
      // 偶数インデックス = 黒番の手
      const isBlackMove = isEvenIndex;

      // A が黒番: 黒の手は A、白の手は B
      // A が白番: 黒の手は B、白の手は A
      const isPlayerAMove = result.isABlack === isBlackMove;
      if (isPlayerAMove) {
        timesA.push(move.time);
      } else {
        timesB.push(move.time);
      }
    }
  }

  return {
    total,
    winsA,
    winsB,
    draws,
    winRateA: winsA / total,
    avgMoves: totalMoves / total,
    avgDuration: totalDuration / total,
    thinkingTimeA: calculateThinkingTimeStats(timesA),
    thinkingTimeB: calculateThinkingTimeStats(timesB),
  };
}
