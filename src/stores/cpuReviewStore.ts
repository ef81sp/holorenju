/**
 * CPU対戦振り返りストア
 *
 * 振り返り対象の対局データ・手順ナビゲーション・評価結果を管理
 */

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { CpuBattleRecord } from "@/types/cpu";
import type { BoardState, Position, StoneColor } from "@/types/game";
import type { EvaluatedMove, GameReview } from "@/types/review";

import { parseGameRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

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

export const useCpuReviewStore = defineStore("cpuReview", () => {
  // ========== State ==========
  /** 振り返り対象のレコード */
  const currentRecord = ref<CpuBattleRecord | null>(null);
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
   * 振り返りを開始
   */
  function openReview(record: CpuBattleRecord): void {
    currentRecord.value = record;
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

    // キャッシュに保存
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
   * 振り返りを閉じる
   */
  function closeReview(): void {
    currentRecord.value = null;
    moves.value = [];
    currentMoveIndex.value = 0;
    evaluatedMoves.value = [];
    isEvaluating.value = false;
    evaluationProgress.value = 0;
  }

  return {
    // State
    currentRecord,
    moves,
    currentMoveIndex,
    evaluatedMoves,
    isEvaluating,
    evaluationProgress,
    // Computed
    boardAtCurrentMove,
    currentEvaluation,
    playerAccuracy,
    criticalErrors,
    // Actions
    openReview,
    goToMove,
    nextMove,
    prevMove,
    goToStart,
    goToEnd,
    setEvaluationResults,
    clearCacheForRecord,
    closeReview,
  };
});
