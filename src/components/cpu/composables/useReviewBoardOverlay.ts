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
  handleHoverPVMove: (position: Position, isSelf: boolean) => void;
  handleLeavePVMove: () => void;
  handleShowPvLine: (
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ) => void;
  handleHidePvLine: () => void;
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

  /** PV手単発ホバーの仮石 */
  const pvPreviewStone = ref<{
    position: Position;
    color: StoneColor;
  } | null>(null);

  /** PVライン全体表示のアイテム */
  const pvLineItems = ref<{ position: Position; isSelf: boolean }[]>([]);

  /** PVラインの種別（"best" 時は現在手を除去） */
  const pvLineType = ref<"best" | "played" | null>(null);

  // ========== Helpers ==========

  /** 評価対象手の色を取得 */
  function getEvalMoveColor(): "black" | "white" | null {
    const evalMove = reviewStore.moves[reviewStore.currentMoveIndex - 1];
    return evalMove?.color ?? null;
  }

  // ========== Event handlers ==========

  function handleHoverCandidate(position: Position): void {
    hoveredCandidatePosition.value = position;
  }

  function handleLeaveCandidate(): void {
    hoveredCandidatePosition.value = null;
  }

  function handleHoverPVMove(position: Position, isSelf: boolean): void {
    const evalMove = reviewStore.moves[reviewStore.currentMoveIndex - 1];
    if (!evalMove?.color) {
      return;
    }
    const color: StoneColor = isSelf
      ? evalMove.color
      : getOppositeColor(evalMove.color);
    pvPreviewStone.value = { position, color };
  }

  function handleLeavePVMove(): void {
    pvPreviewStone.value = null;
  }

  function handleShowPvLine(
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ): void {
    pvLineItems.value = items;
    pvLineType.value = type;
  }

  function handleHidePvLine(): void {
    pvLineItems.value = [];
    pvLineType.value = null;
  }

  /** 手数変更時などにすべてのプレビューをクリア */
  function clearPreview(): void {
    pvPreviewStone.value = null;
    pvLineItems.value = [];
    pvLineType.value = null;
  }

  // ========== Computed: 盤面 ==========

  /** PVプレビュー石を含む盤面 */
  const displayBoardState = computed<BoardState>(() => {
    const board = reviewStore.boardAtCurrentMove;
    const preview = pvPreviewStone.value;
    const lineItems = pvLineItems.value;

    if (!preview && lineItems.length === 0) {
      return board;
    }

    const newBoard = board.map((row) => [...row]) as BoardState;
    const evalColor = getEvalMoveColor();
    const lineType = pvLineType.value;

    // "best" PVライン表示時: 現在の手の石を除去
    if (lineType === "best" && reviewStore.currentMoveIndex > 0) {
      const currentMove = reviewStore.moves[reviewStore.currentMoveIndex - 1];
      if (currentMove) {
        const row = newBoard[currentMove.position.row];
        if (row) {
          row[currentMove.position.col] = null;
        }
      }
    }

    // PVライン全体の石を追加
    if (lineItems.length > 0 && evalColor) {
      for (const item of lineItems) {
        if (!newBoard[item.position.row]?.[item.position.col]) {
          const row = newBoard[item.position.row];
          if (row) {
            row[item.position.col] = item.isSelf
              ? evalColor
              : getOppositeColor(evalColor);
          }
        }
      }
    }

    // 単発ホバーの石を追加
    if (preview && !newBoard[preview.position.row]?.[preview.position.col]) {
      const row = newBoard[preview.position.row];
      if (row) {
        row[preview.position.col] = preview.color;
      }
    }

    return newBoard;
  });

  // ========== Computed: ラベル ==========

  /** 石の通し番号ラベル（PVライン石の番号含む） */
  const stoneLabels = computed(() => {
    const labels = new Map<string, StoneLabel>();
    const lineType = pvLineType.value;

    for (let i = 0; i < reviewStore.currentMoveIndex; i++) {
      const move = reviewStore.moves[i];
      if (!move) {
        continue;
      }
      // "best" PVライン表示時: 現在の手のラベルを除外
      if (lineType === "best" && i === reviewStore.currentMoveIndex - 1) {
        continue;
      }
      labels.set(`${move.position.row},${move.position.col}`, {
        text: String(i + 1),
        color: move.color === "black" ? "#ffffff" : "#000000",
      });
    }

    // PVライン石の番号ラベル（currentMoveIndexから開始）
    const lineItems = pvLineItems.value;
    const evalColor = getEvalMoveColor();
    if (lineItems.length > 0 && evalColor) {
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        if (!item) {
          continue;
        }
        const key = `${item.position.row},${item.position.col}`;
        if (!labels.has(key)) {
          const stoneColor = item.isSelf
            ? evalColor
            : getOppositeColor(evalColor);
          labels.set(key, {
            text: String(reviewStore.currentMoveIndex + i),
            color: stoneColor === "black" ? "#ffffff" : "#000000",
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
    const lineType = pvLineType.value;

    // 現在の手をcircleマークで表示（"best" PVライン時は非表示）
    if (reviewStore.currentMoveIndex > 0 && lineType !== "best") {
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

    // 評価がinaccuracy以上の場合、最善手をcrossマークで表示（"best" PVライン時は非表示）
    const evaluation = reviewStore.currentEvaluation;
    if (
      lineType !== "best" &&
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

    // PVライン全体表示時のcircleマーク
    for (const item of pvLineItems.value) {
      marks.push({
        id: `review-pv-line-${item.position.row}-${item.position.col}`,
        positions: [item.position],
        markType: "circle",
        placedAtDialogueIndex: -2,
      });
    }

    // PV手ホバー時のcircleマーク
    if (pvPreviewStone.value) {
      marks.push({
        id: "review-pv-preview",
        positions: [pvPreviewStone.value.position],
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
    handleShowPvLine,
    handleHidePvLine,
    clearPreview,
    displayBoardState,
    stoneLabels,
    displayMarks,
  };
}
