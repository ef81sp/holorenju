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
import { getOppositeColor } from "../core/boardUtils";
import {
  DEFAULT_EVAL_OPTIONS,
  type EvaluationOptions,
  PATTERN_SCORES,
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
import { findVCFSequence } from "./vcf";

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
}

/**
 * 必須手の事前チェック（探索より優先）
 *
 * 勝利手、脅威防御、VCF、Mise-VCF、VCF防御を順にチェックし、
 * 即座に返すべき手や候補手の制限を決定する。
 *
 * @param board 盤面
 * @param color 手番の色
 * @param ctx 探索コンテキスト
 * @param evaluationOptions 評価オプション
 * @param absoluteDeadline 絶対時間制限のタイムスタンプ
 * @returns 事前チェック結果
 */
function findPreSearchMove(
  board: BoardState,
  color: "black" | "white",
  ctx: SearchContext,
  evaluationOptions: EvaluationOptions,
  absoluteDeadline: number,
): PreSearchResult {
  // 絶対時間制限チェック（VCF探索前）
  if (performance.now() >= absoluteDeadline) {
    // 時間がないので即座に簡易評価で返す（上位5手のみ評価）
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
    return {
      immediateMove: { position: fallbackMove, score: 0 },
    };
  }

  // 1. 自分の即勝ち手（五連完成）をチェック
  const winMove = findWinningMove(board, color);
  if (winMove) {
    return {
      immediateMove: { position: winMove, score: PATTERN_SCORES.FIVE },
    };
  }

  // 2. 相手の脅威（活四・止め四・活三）をチェック
  const opponentColor = getOppositeColor(color);
  const threats = detectOpponentThreats(board, opponentColor);

  // 相手の活四があれば止める（実際には止められないが）
  if (threats.openFours.length > 0) {
    const [defensePos] = threats.openFours;
    if (defensePos) {
      // 黒番で防御位置が禁手の場合は通常探索に任せる
      const isBlack = color === "black";
      if (isBlack) {
        const forbiddenResult = checkForbiddenMoveWithCache(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (!forbiddenResult.isForbidden) {
          return {
            immediateMove: {
              position: defensePos,
              score: -PATTERN_SCORES.FIVE,
            },
          };
        }
        // 禁手追い込み: 防御できないので通常探索で禁手以外の手を選ぶ
      } else {
        return {
          immediateMove: {
            position: defensePos,
            score: -PATTERN_SCORES.FIVE,
          },
        };
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
      // 黒番で防御位置が禁手の場合は通常探索に任せる
      const isBlack = color === "black";
      if (isBlack) {
        const forbiddenResult = checkForbiddenMoveWithCache(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (!forbiddenResult.isForbidden) {
          return {
            immediateMove: {
              position: defensePos,
              score: fourDefenseScore,
            },
          };
        }
        // 禁手追い込み: 防御できないので通常探索で禁手以外の手を選ぶ
      } else {
        return {
          immediateMove: {
            position: defensePos,
            score: fourDefenseScore,
          },
        };
      }
    }
  }

  // 相手VCF結果（VCFレース判定 + Mise-VCFスキップ + 防御候補制限で共有）
  // NOTE: 各VCFは独立に探索するため、手順の相互干渉は考慮しない
  // 3状態: undefined=未探索、null=探索済みVCFなし、VCFSequenceResult=VCFあり
  let opponentVCFResult: ReturnType<typeof findVCFSequence> | undefined =
    undefined;

  // 3. 四追い勝ち（VCF）があれば即座にその手を返す
  // （相手の四がある場合は上記で即return済みなのでここには到達しない）
  const vcfResult = findVCFSequence(board, color);
  if (vcfResult) {
    // findVCFSequence が返す VCF は各防御手の counter-four/counter-five チェック済み。
    // 相手は毎手四を止めるしかないため、相手VCFの有無・長短に関係なく勝利確定。
    return {
      immediateMove: {
        position: vcfResult.firstMove,
        score: PATTERN_SCORES.FIVE,
      },
    };
  }

  // 3.5 Mise-VCF（ミセ→強制応手→VCF勝ち）があれば即座にその手を返す
  // 自VCFがなかった場合、Mise-VCFの前に相手VCFを探索
  if (opponentVCFResult === undefined) {
    opponentVCFResult = findVCFSequence(board, opponentColor, {
      timeLimit: 100,
    });
  }

  // 相手VCFがある場合、Mise-VCFは間に合わない（最低2手+VCF手数が必要）のでスキップ
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
        };
      }
      // 禁手の場合はMise-VCFなしとして通常探索にフォールスルー
    }
  }

  // 4. 相手のVCF（四追い勝ち）があれば候補手を防御手に制限
  // 相手VCF結果を共有変数から取得（重複探索を排除）
  const opponentVCFMove = opponentVCFResult?.firstMove ?? null;
  let vcfDefenseSet: Set<string> | null = null;
  if (opponentVCFMove) {
    vcfDefenseSet = new Set<string>();

    // (a) カウンターフォー: 自分の四を作れる手（相手はVCFを中断して応手が必要）
    const counterFours = findFourMoves(board, color);
    for (const m of counterFours) {
      vcfDefenseSet.add(`${m.row},${m.col}`);
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
        vcfDefenseSet.add(`${blockPos.row},${blockPos.col}`);
      }
    }
  }

  return {
    opponentVCFFirstMove: opponentVCFMove,
    restrictedMoves: vcfDefenseSet
      ? Array.from(vcfDefenseSet).map((key) => {
          const [row, col] = key.split(",").map(Number);
          return { row: row!, col: col! };
        })
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

  // 相手のVCF防御・活三防御で候補手を制限
  let movesRestricted = false;

  // VCF防御が最優先
  if (
    preSearchResult.restrictedMoves &&
    preSearchResult.restrictedMoves.length > 0
  ) {
    const restrictedSet = new Set(
      preSearchResult.restrictedMoves.map((m) => `${m.row},${m.col}`),
    );
    const defenseMoves = moves.filter((m) =>
      restrictedSet.has(`${m.row},${m.col}`),
    );
    if (defenseMoves.length > 0) {
      moves = defenseMoves;
      movesRestricted = true;
    }
    // defenseMoves が空の場合（mandatory defense でフィルタ済みなど）は
    // 活三防御にフォールバックする
  }

  if (!movesRestricted) {
    const opponentColor = getOppositeColor(color);
    const threats = detectOpponentThreats(board, opponentColor);
    if (threats.openThrees.length > 0) {
      // 相手の活三があれば、防御位置のみを候補として探索
      // （どの止め方がいいかは探索で決める）
      const defenseSet = new Set(
        threats.openThrees.map((p) => `${p.row},${p.col}`),
      );
      const defenseMoves = moves.filter((m) =>
        defenseSet.has(`${m.row},${m.col}`),
      );
      // 防御位置が候補手に含まれていれば、それらのみを探索
      if (defenseMoves.length > 0) {
        moves = defenseMoves;
      }
    }
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
