/**
 * useReviewBoardOverlay のテスト
 *
 * PVホバー石ラベルが手数ベースであること、
 * bestモード時の盤面・ラベル・マークの挙動を検証する。
 */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { CpuBattleRecord } from "@/types/cpu";

import { useCpuReviewStore } from "@/stores/cpuReviewStore";

import { useReviewBoardOverlay } from "./useReviewBoardOverlay";

/** テスト用の対戦記録（H8 H9 I8 = 3手） */
function createTestRecord(): CpuBattleRecord {
  return {
    id: "test-record",
    timestamp: Date.now(),
    difficulty: "medium",
    result: "lose",
    moves: 3,
    playerFirst: true,
    moveHistory: "H8 H9 I8",
  };
}

describe("useReviewBoardOverlay", () => {
  // eslint-disable-next-line init-declarations
  let reviewStore: ReturnType<typeof useCpuReviewStore>;
  // eslint-disable-next-line init-declarations
  let overlay: ReturnType<typeof useReviewBoardOverlay>;

  beforeEach(() => {
    setActivePinia(createPinia());
    reviewStore = useCpuReviewStore();
    reviewStore.openReview(createTestRecord());
    overlay = useReviewBoardOverlay();
  });

  describe("PVホバー石ラベル（手数ベース）", () => {
    it("3手目でPVホバーすると、ラベルが3,4,...と手数ベースになる", () => {
      reviewStore.goToMove(3);

      // 3手目（黒I8）を見ている状態でPVホバー
      overlay.handleHoverPVMove(
        [
          { position: { row: 6, col: 9 }, isSelf: true },
          { position: { row: 5, col: 9 }, isSelf: false },
        ],
        "played",
      );

      const labels = overlay.stoneLabels.value;
      // PVホバー石のラベルは currentMoveIndex(3) + i
      expect(labels.get("6,9")?.text).toBe("3");
      expect(labels.get("5,9")?.text).toBe("4");
    });

    it("2手目でPVホバーすると、ラベルが2,3,...と手数ベースになる", () => {
      reviewStore.goToMove(2);

      overlay.handleHoverPVMove(
        [
          { position: { row: 6, col: 9 }, isSelf: true },
          { position: { row: 5, col: 8 }, isSelf: false },
        ],
        "played",
      );

      const labels = overlay.stoneLabels.value;
      expect(labels.get("6,9")?.text).toBe("2");
      expect(labels.get("5,8")?.text).toBe("3");
    });
  });

  describe("bestモード", () => {
    it("bestモードでPVホバー時、現在の手の石が盤面から除去される", () => {
      reviewStore.goToMove(3);

      // 3手目: 黒 I8 = row:7, col:8
      // eslint-disable-next-line prefer-destructuring
      const currentMove = reviewStore.moves[2];
      expect(currentMove).toBeDefined();
      if (!currentMove) {
        return;
      }

      // bestモードでホバー
      overlay.handleHoverPVMove(
        [{ position: { row: 6, col: 9 }, isSelf: true }],
        "best",
      );

      const board = overlay.displayBoardState.value;
      // 現在の手（I8 = row:7, col:8）が除去されている
      expect(
        board[currentMove.position.row]?.[currentMove.position.col],
      ).toBeNull();
    });

    it("bestモードでPVホバー時、現在手のラベルが除外される", () => {
      reviewStore.goToMove(3);

      overlay.handleHoverPVMove(
        [{ position: { row: 6, col: 9 }, isSelf: true }],
        "best",
      );

      const labels = overlay.stoneLabels.value;
      // eslint-disable-next-line prefer-destructuring
      const currentMove = reviewStore.moves[2];
      expect(currentMove).toBeDefined();
      if (!currentMove) {
        return;
      }
      const key = `${currentMove.position.row},${currentMove.position.col}`;
      expect(labels.has(key)).toBe(false);
    });

    it("bestモードでPVホバー時、現在手マークが非表示になる", () => {
      reviewStore.goToMove(3);

      overlay.handleHoverPVMove(
        [{ position: { row: 6, col: 9 }, isSelf: true }],
        "best",
      );

      const marks = overlay.displayMarks.value;
      expect(marks.find((m) => m.id === "review-current")).toBeUndefined();
    });
  });

  describe("playedモード", () => {
    it("playedモードでPVホバー時、現在の手の石は残る", () => {
      reviewStore.goToMove(3);
      // eslint-disable-next-line prefer-destructuring
      const currentMove = reviewStore.moves[2];
      expect(currentMove).toBeDefined();
      if (!currentMove) {
        return;
      }

      overlay.handleHoverPVMove(
        [{ position: { row: 6, col: 9 }, isSelf: true }],
        "played",
      );

      const board = overlay.displayBoardState.value;
      expect(board[currentMove.position.row]?.[currentMove.position.col]).toBe(
        "black",
      );
    });
  });

  describe("clearPreview", () => {
    it("PVホバー状態がクリアされる", () => {
      reviewStore.goToMove(3);

      overlay.handleHoverPVMove(
        [{ position: { row: 6, col: 9 }, isSelf: true }],
        "best",
      );

      // PVプレビューマークがある
      expect(
        overlay.displayMarks.value.some((m) =>
          m.id.startsWith("review-pv-preview"),
        ),
      ).toBe(true);

      overlay.clearPreview();

      // クリア後はPVプレビューマークなし
      expect(
        overlay.displayMarks.value.some((m) =>
          m.id.startsWith("review-pv-preview"),
        ),
      ).toBe(false);
    });
  });

  describe("候補手ホバー", () => {
    it("ホバーでcircleマークが表示される", () => {
      reviewStore.goToMove(1);
      const pos = { row: 5, col: 5 };

      overlay.handleHoverCandidate(pos);

      const marks = overlay.displayMarks.value;
      const hoverMark = marks.find((m) => m.id === "review-hover");
      expect(hoverMark).toBeDefined();
      expect(hoverMark?.positions).toEqual([pos]);
    });

    it("リーブでマークが消える", () => {
      reviewStore.goToMove(1);

      overlay.handleHoverCandidate({ row: 5, col: 5 });
      overlay.handleLeaveCandidate();

      const marks = overlay.displayMarks.value;
      expect(marks.find((m) => m.id === "review-hover")).toBeUndefined();
    });
  });
});
