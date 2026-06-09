/**
 * useReviewProgression のプレビュー配線テスト
 *
 * 純ロジック（行展開・分岐）は progressionModel.test が担当。本テストは
 * 「ステップ送り・ホバー・タブ切替で reviewBoardPreviewStore が更新/クリアされる」
 * という store 配線（emit 撤廃後の発火経路）を検証する。
 */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";

import type { Position } from "@/types/game";
import type { EvaluatedMove, ReviewCandidate } from "@/types/review";

import { useReviewBoardPreviewStore } from "@/stores/reviewBoardPreviewStore";

import { useReviewProgression } from "./useReviewProgression";

const pos = (row: number, col: number): Position => ({ row, col });

function candidate(overrides: Partial<ReviewCandidate>): ReviewCandidate {
  return { position: pos(7, 7), searchScore: 0, ...overrides };
}

/** best と played の両タブが出る最小の EvaluatedMove */
function evaluatedMove(): EvaluatedMove {
  return {
    moveIndex: 5,
    position: pos(2, 2),
    isPlayerMove: true,
    quality: "good",
    playedScore: 0,
    bestScore: 0,
    scoreDiff: 0,
    bestMove: pos(1, 1),
    candidates: [
      candidate({
        position: pos(1, 1),
        principalVariation: [pos(1, 1), pos(9, 9)],
      }),
      candidate({
        position: pos(2, 2),
        principalVariation: [pos(2, 2), pos(8, 8)],
      }),
    ],
  };
}

describe("useReviewProgression プレビュー配線", () => {
  // eslint-disable-next-line init-declarations
  let previewStore: ReturnType<typeof useReviewBoardPreviewStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    previewStore = useReviewBoardPreviewStore();
  });

  function setup(): ReturnType<typeof useReviewProgression> {
    return useReviewProgression({
      evaluation: ref<EvaluatedMove | null>(evaluatedMove()),
      moveIndex: ref(5),
    });
  }

  it("初期は best タブが選択され、プレビューは未設定", () => {
    const prog = setup();
    expect(prog.activeTabId.value).toBe("best");
    expect(previewStore.pvPreview).toBeNull();
  });

  it("previewHoverMove で store に PV プレビューがセットされる", () => {
    const prog = setup();
    prog.previewHoverMove(0);
    expect(previewStore.pvPreview).not.toBeNull();
    expect(previewStore.pvPreview?.type).toBe("best");
    // rowIdx 0 まで = 1手（best PV 先頭 = 自分の手 (1,1)）
    expect(previewStore.pvPreview?.items[0]?.position).toEqual(pos(1, 1));
  });

  it("stepForward で可視手列がプレビューに反映される", () => {
    const prog = setup();
    prog.stepForward();
    expect(prog.step.value).toBe(1);
    expect(previewStore.pvPreview?.items).toHaveLength(1);
  });

  it("previewLeave（step=0）は PV プレビューをクリアする", () => {
    const prog = setup();
    prog.previewHoverMove(1);
    expect(previewStore.pvPreview).not.toBeNull();
    prog.previewLeave(); // step は 0 のまま → クリア
    expect(previewStore.pvPreview).toBeNull();
  });

  it("switchTab は PV プレビューをクリアする", () => {
    const prog = setup();
    prog.previewHoverMove(0);
    expect(previewStore.pvPreview).not.toBeNull();
    prog.switchTab("played");
    expect(prog.activeTabId.value).toBe("played");
    expect(previewStore.pvPreview).toBeNull();
  });
});
