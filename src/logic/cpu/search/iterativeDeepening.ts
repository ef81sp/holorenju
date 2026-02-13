/**
 * 反復深化探索（TT統合版）
 *
 * Iterative Deepening + Aspiration Windows + 事前チェック（VCF/脅威防御）
 */

import type { BoardState, Position } from "@/types/game";

import {
  checkForbiddenMoveWithCache,
  clearForbiddenCache,
  setCurrentBoardHash,
} from "../cache/forbiddenCache";
import { countStones, getOppositeColor } from "../core/boardUtils";
import {
  DEFAULT_EVAL_OPTIONS,
  type EvaluationOptions,
  PATTERN_SCORES,
  type ThreatInfo,
} from "../evaluation/patternScores";
import { detectOpponentThreats } from "../evaluation/threatDetection";
import { generateSortedMoves } from "../moveGenerator";
import { getCounters, resetCounters } from "../profiling/counters";
import { globalTT } from "../transpositionTable";
import { computeBoardHash } from "../zobrist";
import {
  createSearchContext,
  type SearchContext,
  type SearchStats,
} from "./context";
import { findBestMoveWithTT } from "./minimaxCore";
import { findMiseVCFMove } from "./miseVcf";
import {
  applyTimePressureFallback,
  type DepthHistoryEntry,
  type IterativeDeepingResult,
} from "./results";
import {
  ASPIRATION_WINDOW,
  calculateDynamicTimeLimit,
  DEFAULT_ABSOLUTE_TIME_LIMIT,
} from "./techniques";
import {
  findFourMoves,
  findWinningMove,
  getFourDefensePosition,
} from "./threatPatterns";
import { findVCFSequence, type VCFSequenceResult } from "./vcf";
import { findVCTMove, VCT_STONE_THRESHOLD } from "./vct";

/**
 * プロファイリングカウンターの値をSearchStatsにマージ
 *
 * @param stats 探索統計
 * @returns カウンター値がマージされた統計
 */
function mergeProfilingCounters(stats: SearchStats): SearchStats {
  const counters = getCounters();
  return {
    ...stats,
    forbiddenCheckCalls: counters.forbiddenCheckCalls,
    boardCopies: counters.boardCopies,
    threatDetectionCalls: counters.threatDetectionCalls,
    evaluationCalls: counters.evaluationCalls,
  };
}

/**
 * 事前チェック結果
 */
interface PreSearchResult {
  /** 即座に返すべき手（勝利手・必須防御手） */
  immediateMove?: { position: Position; score: number };
  /** 候補手の制限セット（VCF防御・活三防御） */
  restrictedMoves?: Position[];
  /** 相手VCFの初手（VCF防御用） */
  opponentVCFFirstMove?: Position | null;
  /** VCTヒント手（偽陽性の可能性があるためminimax検証に委ねる） */
  vctHintMove?: Position;
  /** 活三防御の候補手（相手の活三を止める位置） */
  openThreeDefenseMoves?: Position[];
}

// =========================================================================
// findPreSearchMove サブ関数群
// =========================================================================

/** 絶対時間制限超過時の緊急フォールバック */
function checkEmergencyTimeout(
  board: BoardState,
  color: "black" | "white",
  ctx: SearchContext,
  evaluationOptions: EvaluationOptions,
  absoluteDeadline: number,
): PreSearchResult | null {
  if (performance.now() < absoluteDeadline) {
    return null;
  }
  const moves = generateSortedMoves(board, color, {
    ttMove: null,
    killers: ctx.killers,
    depth: 1,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions,
    maxStaticEvalCount: 5,
  });
  const fallbackMove = moves[0] ?? { row: 7, col: 7 };
  return { immediateMove: { position: fallbackMove, score: 0 } };
}

/** 即勝ち手（五連完成）の検出 */
function checkImmediateWin(
  board: BoardState,
  color: "black" | "white",
): PreSearchResult | null {
  const winMove = findWinningMove(board, color);
  if (!winMove) {
    return null;
  }
  return {
    immediateMove: { position: winMove, score: PATTERN_SCORES.FIVE },
  };
}

/**
 * 相手の活四・止め四に対する必須防御
 *
 * 黒番で防御位置が禁手の場合は null を返し、通常探索に委ねる。
 */
function checkMustDefend(
  board: BoardState,
  color: "black" | "white",
  threats: ThreatInfo,
): PreSearchResult | null {
  // 相手の活四があれば止める（実際には止められないが）
  if (threats.openFours.length > 0) {
    const [defensePos] = threats.openFours;
    if (defensePos) {
      const result = tryDefenseMove(
        board,
        color,
        defensePos,
        -PATTERN_SCORES.FIVE,
      );
      if (result) {
        return result;
      }
    }
  }

  // 相手の止め四があれば止める（止めないと負け）
  // 四三の場合も、まず四を止める（どうせ負けだが）
  if (threats.fours.length > 0) {
    const [defensePos] = threats.fours;
    if (defensePos) {
      const fourDefenseScore =
        threats.openThrees.length > 0 ? -PATTERN_SCORES.FIVE : 0;
      const result = tryDefenseMove(board, color, defensePos, fourDefenseScore);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

/** 防御手を返す。黒番で防御位置が禁手の場合は null（通常探索に委ねる） */
function tryDefenseMove(
  board: BoardState,
  color: "black" | "white",
  defensePos: Position,
  score: number,
): PreSearchResult | null {
  if (color === "black") {
    const { isForbidden } = checkForbiddenMoveWithCache(
      board,
      defensePos.row,
      defensePos.col,
    );
    if (isForbidden) {
      return null;
    } // 禁手追い込み: 通常探索で禁手以外の手を選ぶ
  }
  return { immediateMove: { position: defensePos, score } };
}

/** checkForcedWinSequences の戻り値 */
interface ForcedWinCheckResult {
  immediateMove?: { position: Position; score: number };
  opponentVCFResult: VCFSequenceResult | null;
  vctHintMove?: Position;
}

/**
 * VCF・Mise-VCF・VCTの強制勝ち探索
 *
 * 自VCF → 相手VCF（Mise-VCFスキップ判定用） → Mise-VCF → VCTヒント の順に探索。
 */
function checkForcedWinSequences(
  board: BoardState,
  color: "black" | "white",
  opponentColor: "black" | "white",
  evaluationOptions: EvaluationOptions,
): ForcedWinCheckResult {
  // 自VCF（四追い勝ち）
  // 相手の四がある場合は checkMustDefend で即return済みなのでここには到達しない
  const vcfResult = findVCFSequence(board, color);
  if (vcfResult) {
    return {
      immediateMove: {
        position: vcfResult.firstMove,
        score: PATTERN_SCORES.FIVE,
      },
      opponentVCFResult: null,
    };
  }

  // 相手VCF（Mise-VCFスキップ判定 + 防御候補制限で共有）
  const opponentVCFResult =
    findVCFSequence(board, opponentColor, { timeLimit: 100 }) ?? null;

  // Mise-VCF（ミセ→強制応手→VCF勝ち）
  // 相手VCFがある場合は間に合わない（最低2手+VCF手数が必要）のでスキップ
  if (!opponentVCFResult) {
    const miseVcfMove = findMiseVCFMove(board, color, {
      vcfOptions: { maxDepth: 12, timeLimit: 300 },
      timeLimit: 500,
    });
    if (miseVcfMove) {
      const isForbidden =
        color === "black" &&
        checkForbiddenMoveWithCache(board, miseVcfMove.row, miseVcfMove.col)
          .isForbidden;
      if (!isForbidden) {
        return {
          immediateMove: {
            position: miseVcfMove,
            score: PATTERN_SCORES.FIVE,
          },
          opponentVCFResult: null,
        };
      }
    }
  }

  // VCTヒント（偽陽性の可能性があるためminimax検証に委ねる）
  let vctHintMove: Position | undefined;
  if (evaluationOptions.enableVCT) {
    const stoneCount = countStones(board);
    if (stoneCount >= VCT_STONE_THRESHOLD) {
      const vctMove = findVCTMove(board, color, {
        maxDepth: 4,
        timeLimit: 150,
      });
      if (vctMove) {
        const isForbidden =
          color === "black" &&
          checkForbiddenMoveWithCache(board, vctMove.row, vctMove.col)
            .isForbidden;
        if (!isForbidden) {
          vctHintMove = vctMove;
        }
      }
    }
  }

  return { opponentVCFResult, vctHintMove };
}

/** 相手VCFに対する候補手制限（カウンターフォー + ブロック） */
function computeVCFDefenseMoves(
  board: BoardState,
  color: "black" | "white",
  opponentColor: "black" | "white",
  opponentVCFMove: Position,
): Position[] {
  const defenseSet = new Set<string>();

  // (a) カウンターフォー: 自分の四を作れる手（相手はVCFを中断して応手が必要）
  for (const m of findFourMoves(board, color)) {
    defenseSet.add(`${m.row},${m.col}`);
  }

  // (b) ブロック: 相手VCF開始手をシミュレートし、四の防御位置を取得
  const vcfRow = board[opponentVCFMove.row];
  if (vcfRow) {
    vcfRow[opponentVCFMove.col] = opponentColor;
    const blockPos = getFourDefensePosition(
      board,
      opponentVCFMove,
      opponentColor,
    );
    vcfRow[opponentVCFMove.col] = null;
    if (blockPos) {
      defenseSet.add(`${blockPos.row},${blockPos.col}`);
    }
  }

  return Array.from(defenseSet).map((key) => {
    const [row, col] = key.split(",").map(Number);
    return { row: row!, col: col! };
  });
}

// =========================================================================
// findPreSearchMove パイプライン
// =========================================================================

/**
 * 必須手の事前チェック（探索より優先）
 *
 * 緊急タイムアウト → 即勝ち → 必須防御 → 強制勝ち探索 → 候補手制限
 * の順にチェックし、即座に返すべき手や候補手の制限を決定する。
 */
function findPreSearchMove(
  board: BoardState,
  color: "black" | "white",
  ctx: SearchContext,
  evaluationOptions: EvaluationOptions,
  absoluteDeadline: number,
): PreSearchResult {
  const timeout = checkEmergencyTimeout(
    board,
    color,
    ctx,
    evaluationOptions,
    absoluteDeadline,
  );
  if (timeout) {
    return timeout;
  }

  const win = checkImmediateWin(board, color);
  if (win) {
    return win;
  }

  const opponentColor = getOppositeColor(color);
  const threats = detectOpponentThreats(board, opponentColor);

  const defense = checkMustDefend(board, color, threats);
  if (defense) {
    return defense;
  }

  const forced = checkForcedWinSequences(
    board,
    color,
    opponentColor,
    evaluationOptions,
  );
  if (forced.immediateMove) {
    return { immediateMove: forced.immediateMove };
  }

  const opponentVCFMove = forced.opponentVCFResult?.firstMove;
  return {
    opponentVCFFirstMove: opponentVCFMove ?? null,
    vctHintMove: forced.vctHintMove,
    openThreeDefenseMoves: threats.openThrees,
    restrictedMoves: opponentVCFMove
      ? computeVCFDefenseMoves(board, color, opponentColor, opponentVCFMove)
      : undefined,
  };
}

/**
 * Iterative Deepeningで最善手を探索（TT統合版）
 *
 * @param board 盤面
 * @param color 手番の色
 * @param maxDepth 最大探索深度
 * @param timeLimit 時間制限（ミリ秒）
 * @param randomFactor ランダム要素（0-1）
 * @param evaluationOptions 評価オプション
 * @param maxNodes ノード数上限（省略時は無制限）
 * @param absoluteTimeLimit 絶対時間制限（ミリ秒、デフォルト: 10000ms）
 * @param scoreThreshold ランダム選択時の許容スコア差（デフォルト: 200）
 * @returns 最善手と探索情報
 */
export function findBestMoveIterativeWithTT(
  board: BoardState,
  color: "black" | "white",
  maxDepth: number,
  timeLimit: number,
  randomFactor = 0,
  evaluationOptions: EvaluationOptions = DEFAULT_EVAL_OPTIONS,
  maxNodes?: number,
  absoluteTimeLimit: number = DEFAULT_ABSOLUTE_TIME_LIMIT,
  scoreThreshold = 200,
): IterativeDeepingResult & { stats: SearchStats } {
  const startTime = performance.now();
  const ctx = createSearchContext(globalTT, evaluationOptions);

  // プロファイリングカウンターをリセット
  resetCounters();

  // 禁手判定キャッシュをクリア
  clearForbiddenCache();

  // 初期盤面のハッシュを計算して設定
  const initialHash = computeBoardHash(board);
  setCurrentBoardHash(initialHash);

  // 新しい探索開始
  ctx.tt.newGeneration();

  // =========================================================================
  // 必須手の事前チェック（探索より優先）
  // =========================================================================

  const absoluteDeadline = startTime + absoluteTimeLimit;

  const preSearchResult = findPreSearchMove(
    board,
    color,
    ctx,
    evaluationOptions,
    absoluteDeadline,
  );

  // 即座に返すべき手がある場合
  if (preSearchResult.immediateMove) {
    return {
      position: preSearchResult.immediateMove.position,
      score: preSearchResult.immediateMove.score,
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
    };
  }

  // =========================================================================
  // 通常の探索
  // =========================================================================

  // 候補手を生成
  let moves = generateSortedMoves(board, color, {
    ttMove: null,
    killers: ctx.killers,
    depth: 1,
    history: ctx.history,
    useStaticEval: true,
    evaluationOptions,
  });

  // 候補手制限の適用（優先順: VCF防御 > 活三防御）
  // 各制限は候補手とのANDで適用し、空なら次の制限にフォールバック
  const restrictions = [
    preSearchResult.restrictedMoves,
    preSearchResult.openThreeDefenseMoves,
  ];
  for (const restriction of restrictions) {
    if (restriction && restriction.length > 0) {
      const restrictedSet = new Set(
        restriction.map((m) => `${m.row},${m.col}`),
      );
      const filtered = moves.filter((m) =>
        restrictedSet.has(`${m.row},${m.col}`),
      );
      if (filtered.length > 0) {
        moves = filtered;
        break;
      }
    }
  }

  // VCTヒント手がある場合、候補手の先頭に配置してminimax検証に委ねる
  if (preSearchResult.vctHintMove) {
    const hint = preSearchResult.vctHintMove;
    const hintKey = `${hint.row},${hint.col}`;
    // 重複を除去して先頭に配置
    moves = [hint, ...moves.filter((m) => `${m.row},${m.col}` !== hintKey)];
  }

  // deadline ベースの時間設定
  // VCF時間の特別扱いは撤廃: deadline = startTime + dynamicTimeLimit で
  // VCF時間は自然に予算に含まれる
  const dynamicTimeLimit = calculateDynamicTimeLimit(
    timeLimit,
    board,
    moves.length,
  );
  const searchDeadline = startTime + dynamicTimeLimit;
  ctx.deadline = searchDeadline;
  ctx.timeoutFlag = false;

  // ノード数上限を設定
  ctx.maxNodes = maxNodes;
  ctx.nodeCountExceeded = false;

  // 絶対停止タイムスタンプを設定
  ctx.absoluteDeadline = absoluteDeadline;
  ctx.absoluteDeadlineExceeded = false;

  // NOTE: Phase 6の最適化（precomputedThreats）は一旦無効化
  // 理由: 深いノードでは手番が変わるため、ルートノードで計算した脅威情報が
  // 不適切に使われる問題がある。毎回detectOpponentThreatsを呼ぶようにする。
  // 将来的には、ルートノードの候補手評価にのみ適用する形で最適化可能。

  // 唯一の候補手なら即座に返す
  if (moves.length === 1 && moves[0]) {
    return {
      position: moves[0],
      score: 0,
      completedDepth: 0,
      interrupted: false,
      elapsedTime: performance.now() - startTime,
      stats: mergeProfilingCounters(ctx.stats),
      forcedMove: true,
    };
  }

  // 深度履歴を記録
  const depthHistory: DepthHistoryEntry[] = [];

  // 初期結果（深さ1で必ず結果を得る）
  // 活三防御時はmovesが防御位置のみに制限されているので、それを渡す
  let bestResult = findBestMoveWithTT(
    board,
    color,
    1,
    randomFactor,
    ctx,
    undefined,
    moves,
    scoreThreshold,
  );
  let completedDepth = 1;
  let interrupted = false;

  // 深度1の結果を記録
  depthHistory.push({
    depth: 1,
    position: bestResult.position,
    score: bestResult.score,
  });

  // 深さ2から開始して、時間制限内で可能な限り深く探索
  // ループ内で使う deadline（0.8倍 = 残り20%の時間を確保）
  const loopDeadline = startTime + dynamicTimeLimit * 0.8;

  for (let depth = 2; depth <= maxDepth; depth++) {
    // PVムーブを先頭に移動（move ordering最適化）
    const pvMove = bestResult.position;
    const pvIndex = moves.findIndex(
      (m) => m.row === pvMove.row && m.col === pvMove.col,
    );
    if (pvIndex > 0) {
      const [pv] = moves.splice(pvIndex, 1);
      if (pv) {
        moves.unshift(pv);
      }
    }

    const now = performance.now();

    // 絶対時間制限チェック
    if (now >= absoluteDeadline) {
      ctx.absoluteDeadlineExceeded = true;
      interrupted = true;
      break;
    }

    // 動的時間制限チェック（deadline ベース）
    if (now >= loopDeadline || ctx.timeoutFlag || ctx.nodeCountExceeded) {
      interrupted = true;
      break;
    }

    // Aspiration Windowsで探索
    let result = findBestMoveWithTT(
      board,
      color,
      depth,
      randomFactor,
      ctx,
      {
        previousScore: bestResult.score,
        windowSize: ASPIRATION_WINDOW,
      },
      moves,
      scoreThreshold,
    );

    // 探索中にタイムアウト、ノード数上限、または絶対時間制限に達した場合は前の結果を使用
    if (
      ctx.timeoutFlag ||
      ctx.nodeCountExceeded ||
      ctx.absoluteDeadlineExceeded
    ) {
      interrupted = true;
      break;
    }

    // ウィンドウ外の結果が出たら再探索（フルウィンドウ）
    const lowerBound = bestResult.score - ASPIRATION_WINDOW;
    const upperBound = bestResult.score + ASPIRATION_WINDOW;
    if (result.score <= lowerBound || result.score >= upperBound) {
      // 再探索（フルウィンドウ）
      result = findBestMoveWithTT(
        board,
        color,
        depth,
        randomFactor,
        ctx,
        undefined,
        moves,
        scoreThreshold,
      );

      // 再探索中にタイムアウト、ノード数上限、または絶対時間制限に達した場合
      if (
        ctx.timeoutFlag ||
        ctx.nodeCountExceeded ||
        ctx.absoluteDeadlineExceeded
      ) {
        interrupted = true;
        break;
      }
    }

    // 深度履歴に記録
    depthHistory.push({
      depth,
      position: result.position,
      score: result.score,
    });

    // ループ末尾の deadline チェック
    if (performance.now() >= searchDeadline) {
      bestResult = result;
      completedDepth = depth;
      interrupted = true;
      break;
    }

    bestResult = result;
    completedDepth = depth;
  }

  const finalResult: IterativeDeepingResult & { stats: SearchStats } = {
    position: bestResult.position,
    score: bestResult.score,
    candidates: bestResult.candidates,
    randomSelection: bestResult.randomSelection,
    completedDepth,
    interrupted,
    elapsedTime: performance.now() - startTime,
    depthHistory,
    stats: mergeProfilingCounters(ctx.stats),
  };
  return applyTimePressureFallback(
    finalResult,
    depthHistory,
    interrupted,
  ) as typeof finalResult;
}
