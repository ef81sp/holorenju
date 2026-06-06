/**
 * reviewBoardPreviewStore の単体テスト
 *
 * 振り返り盤面プレビューの SSoT。候補ホバー / PV プレビューのセット・クリアを検証する。
 */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useReviewBoardPreviewStore } from "./reviewBoardPreviewStore";

describe("reviewBoardPreviewStore", () => {
  // eslint-disable-next-line init-declarations
  let store: ReturnType<typeof useReviewBoardPreviewStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useReviewBoardPreviewStore();
  });

  it("初期状態は両プレビューとも null", () => {
    expect(store.hoveredCandidate).toBeNull();
    expect(store.pvPreview).toBeNull();
  });

  it("候補ホバーのセット・クリア", () => {
    store.setHoveredCandidate({ row: 5, col: 7 });
    expect(store.hoveredCandidate).toEqual({ row: 5, col: 7 });
    store.clearHoveredCandidate();
    expect(store.hoveredCandidate).toBeNull();
  });

  it("PVプレビューのセット・クリア（items と type を保持）", () => {
    const items = [
      { position: { row: 6, col: 9 }, isSelf: true },
      { position: { row: 5, col: 9 }, isSelf: false },
    ];
    store.setPvPreview(items, "best");
    expect(store.pvPreview).toEqual({ items, type: "best" });
    store.clearPvPreview();
    expect(store.pvPreview).toBeNull();
  });

  it("clearAll は両プレビューを同時にクリアする", () => {
    store.setHoveredCandidate({ row: 1, col: 1 });
    store.setPvPreview(
      [{ position: { row: 2, col: 2 }, isSelf: true }],
      "played",
    );
    store.clearAll();
    expect(store.hoveredCandidate).toBeNull();
    expect(store.pvPreview).toBeNull();
  });

  it("候補ホバーと PV プレビューは独立（片方のクリアが他方に影響しない）", () => {
    store.setHoveredCandidate({ row: 3, col: 3 });
    store.setPvPreview(
      [{ position: { row: 4, col: 4 }, isSelf: true }],
      "best",
    );

    store.clearHoveredCandidate();
    expect(store.hoveredCandidate).toBeNull();
    expect(store.pvPreview).not.toBeNull();

    store.setHoveredCandidate({ row: 3, col: 3 });
    store.clearPvPreview();
    expect(store.pvPreview).toBeNull();
    expect(store.hoveredCandidate).toEqual({ row: 3, col: 3 });
  });
});
