/**
 * CPU対戦振り返りストア
 *
 * 振り返り対象の対局データ・手順ナビゲーション・評価結果を管理
 * ReviewSource で CPU対戦記録・外部棋譜の2ソースに対応
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { BattleResult, CpuBattleRecord } from "@/types/cpu";
import type { BoardState, Position, StoneColor } from "@/types/game";
import type {
  EvaluatedMove,
  GameReview,
  PlayerSide,
  ReviewSource,
} from "@/types/review";

import { parseGameRecord } from "@/logic/gameRecordParser";
import { checkWin, createEmptyBoard } from "@/logic/renjuRules";

/** localStorageキャッシュキー */
const REVIEW_CACHE_KEY = "holorenju-review-cache";
/** キャッシュの最大件数 */
const MAX_CACHE_ENTRIES = 20;

/**
 * キャッシュの読み込み
 */
function loadCache(): Map<string, GameReview> {
  try {
    const stored = localStorage.getItem(REVIEW_CACHE_KEY);
    if (stored) {
      const entries = JSON.parse(stored) as [string, GameReview][];
      return new Map(entries);
    }
  } catch {
    console.warn("Failed to load review cache from localStorage");
  }
  return new Map();
}

/**
 * キャッシュの保存
 */
function saveCache(cache: Map<string, GameReview>): void {
  try {
    // 最大件数を超えたら古いエントリを削除
    const entries = [...cache.entries()];
    if (entries.length > MAX_CACHE_ENTRIES) {
      const trimmed = entries.slice(entries.length - MAX_CACHE_ENTRIES);
      localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(entries));
    }
  } catch {
    console.warn("Failed to save review cache to localStorage");
  }
}

/**
 * 棋譜から勝者を検出する（五連判定のみ）
 */
function detectWinnerFromMoves(
  moves: { position: Position; color: StoneColor }[],
): BattleResult | null {
  if (moves.length === 0) {
    return null;
  }

  const board = createEmptyBoard();
  for (const move of moves) {
    const row = board[move.position.row];
    if (row) {
      row[move.position.col] = move.color;
    }
  }

  // 最終手で五連したか確認
  const lastMove = moves[moves.length - 1];
  if (lastMove && checkWin(board, lastMove.position, lastMove.color)) {
    // 最終手で五連した色がわかった → playerSide次第でwin/lose
    // ここでは勝った色だけ返す（呼び出し側でwin/loseを判定）
    return lastMove.color === "black" ? "win" : "lose";
  }

  return null;
}

export const useCpuReviewStore = defineStore("cpuReview", () => {
  // ========== State ==========
  /** レビューソース（CPU対戦 or 外部棋譜） */
  const reviewSource = ref<ReviewSource | null>(null);
  /** パース済み手順 */
  const moves = ref<{ position: Position; color: StoneColor }[]>([]);
  /** 表示中の手数（0=初期盤面、moves.length=最終盤面） */
  const currentMoveIndex = ref(0);
  /** 評価結果 */
  const evaluatedMoves = ref<EvaluatedMove[]>([]);
  /** 評価中フラグ */
  const isEvaluating = ref(false);
  /** 評価進捗（0-1） */
  const evaluationProgress = ref(0);
  /** キャッシュ */
  const reviewCache = ref<Map<string, GameReview>>(loadCache());

  // ========== Computed（後方互換） ==========

  /** CPU対戦記録（cpuBattleソースのみ、それ以外はnull） */
  const currentRecord = computed(() =>
    reviewSource.value?.type === "cpuBattle" ? reviewSource.value.record : null,
  );

  /** 棋譜文字列への統一アクセサ */
  const moveHistory = computed(() => {
    if (!reviewSource.value) {
      return null;
    }
    return reviewSource.value.type === "cpuBattle"
      ? (reviewSource.value.record.moveHistory ?? null)
      : reviewSource.value.moveHistory;
  });

  /** プレイヤーが先手か */
  const playerFirst = computed(() => {
    if (!reviewSource.value) {
      return true;
    }
    return reviewSource.value.type === "cpuBattle"
      ? reviewSource.value.record.playerFirst
      : reviewSource.value.playerSide !== "white";
  });

  /** 全手分析モードか */
  const isAnalyzeAll = computed(
    () =>
      reviewSource.value?.type === "imported" &&
      reviewSource.value.playerSide === "both",
  );

  /** 決着結果（importedでは五連検出、検出不可ならnull） */
  const gameResult = computed<BattleResult | null>(() => {
    if (!reviewSource.value) {
      return null;
    }
    if (reviewSource.value.type === "cpuBattle") {
      return reviewSource.value.record.result;
    }
    // imported: 五連検出。playerSideに応じてwin/loseを反転
    const rawResult = detectWinnerFromMoves(moves.value);
    if (!rawResult) {
      return null;
    }
    const { playerSide } = reviewSource.value;
    if (playerSide === "both") {
      return rawResult;
    } // 全手分析では素のまま
    // "win" = 黒勝ち、"lose" = 白勝ち
    if (playerSide === "black") {
      return rawResult;
    }
    // playerSide === "white": 白視点なので反転
    return rawResult === "win" ? "lose" : "win";
  });

  // ========== Computed ==========

  /** 現在の手数までの盤面 */
  const boardAtCurrentMove = computed<BoardState>(() => {
    const board = createEmptyBoard();
    for (let i = 0; i < currentMoveIndex.value && i < moves.value.length; i++) {
      const move = moves.value[i];
      if (!move) {
        continue;
      }
      const row = board[move.position.row];
      if (row) {
        row[move.position.col] = move.color;
      }
    }
    return board;
  });

  /** 現在の手の評価 */
  const currentEvaluation = computed<EvaluatedMove | null>(() => {
    if (currentMoveIndex.value === 0) {
      return null;
    }
    return (
      evaluatedMoves.value.find(
        (e) => e.moveIndex === currentMoveIndex.value - 1,
      ) ?? null
    );
  });

  /** プレイヤー精度 */
  const playerAccuracy = computed(() => {
    const playerMoves = evaluatedMoves.value.filter((m) => m.isPlayerMove);
    if (playerMoves.length === 0) {
      return null;
    }
    const goodOrBetter = playerMoves.filter(
      (m) => m.quality === "excellent" || m.quality === "good",
    ).length;
    return Math.round((goodOrBetter / playerMoves.length) * 100);
  });

  /** ミス数（mistake + blunder） */
  const criticalErrors = computed(
    () =>
      evaluatedMoves.value.filter(
        (m) =>
          m.isPlayerMove &&
          (m.quality === "mistake" || m.quality === "blunder"),
      ).length,
  );

  // ========== Actions ==========

  /**
   * CPU対戦記録の振り返りを開始
   */
  function openReview(record: CpuBattleRecord): void {
    reviewSource.value = { type: "cpuBattle", record };
    if (record.moveHistory) {
      moves.value = parseGameRecord(record.moveHistory);
    } else {
      moves.value = [];
    }
    currentMoveIndex.value = Math.min(1, moves.value.length); // 1手目から開始
    evaluatedMoves.value = [];
    isEvaluating.value = false;
    evaluationProgress.value = 0;

    // キャッシュチェック
    const cached = reviewCache.value.get(record.id);
    if (cached) {
      evaluatedMoves.value = cached.evaluatedMoves;
    }
  }

  /**
   * 外部棋譜の振り返りを開始
   */
  function openReviewFromImport(
    importedMoveHistory: string,
    playerSide: PlayerSide,
  ): void {
    reviewSource.value = {
      type: "imported",
      moveHistory: importedMoveHistory,
      playerSide,
    };
    moves.value = parseGameRecord(importedMoveHistory);
    currentMoveIndex.value = Math.min(1, moves.value.length);
    evaluatedMoves.value = []; // キャッシュなし。都度分析
    isEvaluating.value = false;
    evaluationProgress.value = 0;
  }

  /**
   * 指定手数に移動
   */
  function goToMove(index: number): void {
    currentMoveIndex.value = Math.max(0, Math.min(index, moves.value.length));
  }

  /**
   * 次の手に移動
   */
  function nextMove(): void {
    goToMove(currentMoveIndex.value + 1);
  }

  /**
   * 前の手に移動
   */
  function prevMove(): void {
    goToMove(currentMoveIndex.value - 1);
  }

  /**
   * 最初に移動
   */
  function goToStart(): void {
    goToMove(0);
  }

  /**
   * 最後に移動
   */
  function goToEnd(): void {
    goToMove(moves.value.length);
  }

  /**
   * 評価結果を設定
   */
  function setEvaluationResults(results: EvaluatedMove[]): void {
    evaluatedMoves.value = results;

    // cpuBattle のみキャッシュ保存
    if (currentRecord.value) {
      const review: GameReview = {
        evaluatedMoves: results,
        accuracy: playerAccuracy.value ?? 100,
        criticalErrors: criticalErrors.value,
      };
      reviewCache.value.set(currentRecord.value.id, review);
      saveCache(reviewCache.value);
    }
  }

  /**
   * 指定レコードのキャッシュを削除し、評価結果をクリア
   */
  function clearCacheForRecord(recordId: string): void {
    reviewCache.value.delete(recordId);
    saveCache(reviewCache.value);
    evaluatedMoves.value = [];
  }

  /**
   * 評価結果のみクリア（imported用）
   */
  function clearEvaluation(): void {
    evaluatedMoves.value = [];
  }

  /**
   * 振り返りを閉じる
   */
  function closeReview(): void {
    reviewSource.value = null;
    moves.value = [];
    currentMoveIndex.value = 0;
    evaluatedMoves.value = [];
    isEvaluating.value = false;
    evaluationProgress.value = 0;
  }

  return {
    // State
    reviewSource,
    currentRecord,
    moves,
    currentMoveIndex,
    evaluatedMoves,
    isEvaluating,
    evaluationProgress,
    // Computed
    moveHistory,
    playerFirst,
    isAnalyzeAll,
    gameResult,
    boardAtCurrentMove,
    currentEvaluation,
    playerAccuracy,
    criticalErrors,
    // Actions
    openReview,
    openReviewFromImport,
    goToMove,
    nextMove,
    prevMove,
    goToStart,
    goToEnd,
    setEvaluationResults,
    clearCacheForRecord,
    clearEvaluation,
    closeReview,
  };
});
