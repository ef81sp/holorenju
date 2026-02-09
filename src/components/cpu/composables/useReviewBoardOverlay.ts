/**
 * 振り返り画面の盤面オーバーレイ
 *
 * 候補手ホバー・PV手プレビュー・PVライン全体表示の
 * 盤面合成・マーク・ラベルを管理する。
 */

import { type ComputedRef, computed, ref } from "vue";

import type { StoneLabel } from "@/components/game/RenjuBoard/RenjuBoard.vue";
import type { Mark } from "@/stores/boardStore";
import type { BoardState, Position, StoneColor } from "@/types/game";

import { getOppositeColor } from "@/logic/cpu/core/boardUtils";
import { useCpuReviewStore } from "@/stores/cpuReviewStore";

interface UseReviewBoardOverlayReturn {
  handleHoverCandidate: (position: Position) => void;
  handleLeaveCandidate: () => void;
  handleHoverPVMove: (
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ) => void;
  handleLeavePVMove: () => void;
  clearPreview: () => void;
  displayBoardState: ComputedRef<BoardState>;
  stoneLabels: ComputedRef<Map<string, StoneLabel>>;
  displayMarks: ComputedRef<Mark[]>;
}

export function useReviewBoardOverlay(): UseReviewBoardOverlayReturn {
  const reviewStore = useCpuReviewStore();

  // ========== State ==========

  /** 候補手ホバー位置 */
  const hoveredCandidatePosition = ref<Position | null>(null);

  /** PVホバーの仮石（複数手） */
  const pvPreviewStones = ref<{ position: Position; color: StoneColor }[]>([]);

  /** PVホバーの種別（"best" 時は現在手を除去） */
  const pvHoverType = ref<"best" | "played" | null>(null);

  // ========== Event handlers ==========

  function handleHoverCandidate(position: Position): void {
    hoveredCandidatePosition.value = position;
  }

  function handleLeaveCandidate(): void {
    hoveredCandidatePosition.value = null;
  }

  function handleHoverPVMove(
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ): void {
    const evalMove = reviewStore.moves[reviewStore.currentMoveIndex - 1];
    if (!evalMove?.color) {
      return;
    }
    const evalColor = evalMove.color;
    pvPreviewStones.value = items.map((item) => ({
      position: item.position,
      color: item.isSelf ? evalColor : getOppositeColor(evalColor),
    }));
    pvHoverType.value = type;
  }

  function handleLeavePVMove(): void {
    pvPreviewStones.value = [];
    pvHoverType.value = null;
  }

  /** 手数変更時などにすべてのプレビューをクリア */
  function clearPreview(): void {
    pvPreviewStones.value = [];
    pvHoverType.value = null;
  }

  // ========== Computed: 盤面 ==========

  /** PVプレビュー石を含む盤面 */
  const displayBoardState = computed<BoardState>(() => {
    const board = reviewStore.boardAtCurrentMove;
    const previewStones = pvPreviewStones.value;

    if (previewStones.length === 0) {
      return board;
    }

    const newBoard = board.map((row) => [...row]) as BoardState;
    const isBestMode = pvHoverType.value === "best";

    // "best" モード時: 現在の手の石を除去
    if (isBestMode && reviewStore.currentMoveIndex > 0) {
      const currentMove = reviewStore.moves[reviewStore.currentMoveIndex - 1];
      if (currentMove) {
        const row = newBoard[currentMove.position.row];
        if (row) {
          row[currentMove.position.col] = null;
        }
      }
    }

    // PVホバーの石を追加
    for (const stone of previewStones) {
      if (!newBoard[stone.position.row]?.[stone.position.col]) {
        const row = newBoard[stone.position.row];
        if (row) {
          row[stone.position.col] = stone.color;
        }
      }
    }

    return newBoard;
  });

  // ========== Computed: ラベル ==========

  /** 石の通し番号ラベル（PVプレビュー石の番号含む） */
  const stoneLabels = computed(() => {
    const labels = new Map<string, StoneLabel>();
    const isBestMode = pvHoverType.value === "best";

    for (let i = 0; i < reviewStore.currentMoveIndex; i++) {
      const move = reviewStore.moves[i];
      if (!move) {
        continue;
      }
      // "best" モード時: 現在の手のラベルを除外
      if (isBestMode && i === reviewStore.currentMoveIndex - 1) {
        continue;
      }
      labels.set(`${move.position.row},${move.position.col}`, {
        text: String(i + 1),
        color: move.color === "black" ? "#ffffff" : "#000000",
      });
    }

    // PVホバー石の番号ラベル（手数ベース）
    const previewStones = pvPreviewStones.value;
    if (previewStones.length > 0) {
      for (let i = 0; i < previewStones.length; i++) {
        const stone = previewStones[i];
        if (!stone) {
          continue;
        }
        const key = `${stone.position.row},${stone.position.col}`;
        if (!labels.has(key)) {
          labels.set(key, {
            text: String(reviewStore.currentMoveIndex + i),
            color: stone.color === "black" ? "#ffffff" : "#000000",
          });
        }
      }
    }

    return labels;
  });

  // ========== Computed: マーク ==========

  /** 盤面マーク（現在手・最善手・ホバー・PVプレビュー） */
  const displayMarks = computed<Mark[]>(() => {
    const marks: Mark[] = [];
    const isBestMode = pvHoverType.value === "best";

    // 現在の手をcircleマークで表示（"best" モード時は非表示）
    if (reviewStore.currentMoveIndex > 0 && !isBestMode) {
      const lastMove = reviewStore.moves[reviewStore.currentMoveIndex - 1];
      if (lastMove) {
        marks.push({
          id: "review-current",
          positions: [lastMove.position],
          markType: "circle",
          placedAtDialogueIndex: -2,
        });
      }
    }

    // 評価がinaccuracy以上の場合、最善手をcrossマークで表示（"best" モード時は非表示）
    const evaluation = reviewStore.currentEvaluation;
    if (
      !isBestMode &&
      evaluation?.isPlayerMove &&
      (evaluation.quality === "inaccuracy" ||
        evaluation.quality === "mistake" ||
        evaluation.quality === "blunder")
    ) {
      marks.push({
        id: "review-best",
        positions: [evaluation.bestMove],
        markType: "cross",
        placedAtDialogueIndex: -2,
      });
    }

    // 候補手ホバー時のcircleマーク
    if (hoveredCandidatePosition.value) {
      marks.push({
        id: "review-hover",
        positions: [hoveredCandidatePosition.value],
        markType: "circle",
        placedAtDialogueIndex: -2,
      });
    }

    // PVホバー時のcircleマーク
    for (const stone of pvPreviewStones.value) {
      marks.push({
        id: `review-pv-preview-${stone.position.row}-${stone.position.col}`,
        positions: [stone.position],
        markType: "circle",
        placedAtDialogueIndex: -2,
      });
    }

    return marks;
  });

  return {
    handleHoverCandidate,
    handleLeaveCandidate,
    handleHoverPVMove,
    handleLeavePVMove,
    clearPreview,
    displayBoardState,
    stoneLabels,
    displayMarks,
  };
}
