/**
 * 禁手マーク表示のテスト
 */

import { createPinia, setActivePinia } from "pinia";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

import { useBoardStore } from "@/stores/boardStore";

import { useForbiddenMark } from "./useForbiddenMark";

// onUnmountedをモック
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

describe("useForbiddenMark", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("showForbiddenMarkでcrossマークが表示される", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark } = useForbiddenMark();

    showForbiddenMark({ row: 7, col: 7 });

    expect(boardStore.marks).toHaveLength(1);
    expect(boardStore.marks[0]?.markType).toBe("cross");
    expect(boardStore.marks[0]?.positions).toEqual([{ row: 7, col: 7 }]);
  });

  it("1秒後にマークが自動消去される", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark } = useForbiddenMark();

    showForbiddenMark({ row: 7, col: 7 });
    expect(boardStore.marks).toHaveLength(1);

    // 999ms経過 - まだ表示されている
    vi.advanceTimersByTime(999);
    expect(boardStore.marks).toHaveLength(1);

    // 1000ms経過 - 消去される
    vi.advanceTimersByTime(1);
    expect(boardStore.marks).toHaveLength(0);
  });

  it("durationオプションでタイマー時間を変更できる", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark } = useForbiddenMark({ duration: 500 });

    showForbiddenMark({ row: 7, col: 7 });
    expect(boardStore.marks).toHaveLength(1);

    // 499ms経過 - まだ表示されている
    vi.advanceTimersByTime(499);
    expect(boardStore.marks).toHaveLength(1);

    // 500ms経過 - 消去される
    vi.advanceTimersByTime(1);
    expect(boardStore.marks).toHaveLength(0);
  });

  it("連続でshowForbiddenMarkを呼ぶと前のマークがクリアされる", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark } = useForbiddenMark();

    showForbiddenMark({ row: 7, col: 7 });
    expect(boardStore.marks).toHaveLength(1);
    expect(boardStore.marks[0]?.positions).toEqual([{ row: 7, col: 7 }]);

    // 別の位置にマークを表示
    showForbiddenMark({ row: 8, col: 8 });
    expect(boardStore.marks).toHaveLength(1);
    expect(boardStore.marks[0]?.positions).toEqual([{ row: 8, col: 8 }]);
  });

  it("clearForbiddenMarkでマークが即座にクリアされる", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark, clearForbiddenMark } = useForbiddenMark();

    showForbiddenMark({ row: 7, col: 7 });
    expect(boardStore.marks).toHaveLength(1);

    clearForbiddenMark();
    expect(boardStore.marks).toHaveLength(0);
  });

  it("clearForbiddenMark後はタイマーも無効化される", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark, clearForbiddenMark } = useForbiddenMark();

    showForbiddenMark({ row: 7, col: 7 });
    clearForbiddenMark();

    // 手動で新しいマークを追加
    boardStore.addMarks(
      [{ positions: [{ row: 0, col: 0 }], markType: "circle" }],
      0,
    );
    expect(boardStore.marks).toHaveLength(1);

    // 1秒後にもマークは消えない（タイマーが無効化されているため）
    vi.advanceTimersByTime(1000);
    expect(boardStore.marks).toHaveLength(1);
  });

  it("cleanupでタイマーがクリアされる", () => {
    const boardStore = useBoardStore();
    const { showForbiddenMark, cleanup } = useForbiddenMark();

    showForbiddenMark({ row: 7, col: 7 });
    cleanup();

    // 手動でマークをクリアして、新しいマークを追加
    boardStore.clearMarks();
    boardStore.addMarks(
      [{ positions: [{ row: 0, col: 0 }], markType: "circle" }],
      0,
    );

    // 1秒後にもマークは消えない（タイマーがクリアされているため）
    vi.advanceTimersByTime(1000);
    expect(boardStore.marks).toHaveLength(1);
  });

  it("onUnmountedにcleanup関数が登録される", async () => {
    const vue = await import("vue");
    const onUnmountedMock = vue.onUnmounted as Mock;
    onUnmountedMock.mockClear();

    useForbiddenMark();

    expect(onUnmountedMock).toHaveBeenCalledTimes(1);
    expect(typeof onUnmountedMock.mock.calls[0]?.[0]).toBe("function");
  });
});
