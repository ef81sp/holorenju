/**
 * 振り返り盤面プレビューストア
 *
 * 振り返り画面の右ペイン（候補手グリッド・進行ツリー）と
 * 盤面オーバーレイ（useReviewBoardOverlay）の間でホバープレビュー状態を
 * 共有するための SSoT。サブコンポーネントが直接アクションを呼ぶことで、
 * ReviewEvalPanel 経由の emit 中継を不要にする。
 */

import { defineStore } from "pinia";
import { ref } from "vue";

import type { Position } from "@/types/game";

/** PVプレビュー1手分（色は盤面側で手番から導出する） */
export interface PVPreviewItem {
  position: Position;
  isSelf: boolean;
}

export const useReviewBoardPreviewStore = defineStore(
  "reviewBoardPreview",
  () => {
    /** 候補手ホバー位置 */
    const hoveredCandidate = ref<Position | null>(null);

    /** PVホバープレビュー（複数手 ＋ 種別） */
    const pvPreview = ref<{
      items: PVPreviewItem[];
      type: "best" | "played";
    } | null>(null);

    function setHoveredCandidate(position: Position): void {
      hoveredCandidate.value = position;
    }

    function clearHoveredCandidate(): void {
      hoveredCandidate.value = null;
    }

    function setPvPreview(
      items: PVPreviewItem[],
      type: "best" | "played",
    ): void {
      pvPreview.value = { items, type };
    }

    function clearPvPreview(): void {
      pvPreview.value = null;
    }

    /** すべてのプレビュー状態をクリア（画面の出入り時） */
    function clearAll(): void {
      hoveredCandidate.value = null;
      pvPreview.value = null;
    }

    return {
      hoveredCandidate,
      pvPreview,
      setHoveredCandidate,
      clearHoveredCandidate,
      setPvPreview,
      clearPvPreview,
      clearAll,
    };
  },
);
