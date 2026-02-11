import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref, type Ref } from "vue";

import type { BoardState, Position } from "@/types/game";

import { createEmptyBoard } from "@/logic/renjuRules";
import { usePreferencesStore } from "@/stores/preferencesStore";

import { useBoardAnnouncer } from "./useBoardAnnouncer";

/** テスト用ヘルパー: 盤面にstoneを配置 */
function placeStone(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): void {
  const boardRow = board[row];
  if (boardRow) {
    boardRow[col] = color;
  }
}

interface AnnouncerFixture {
  announcer: ReturnType<typeof useBoardAnnouncer>;
  board: BoardState;
  cursorPosition: Ref<Position>;
  isCursorActivated: Ref<boolean>;
}

describe("useBoardAnnouncer", () => {
  // localStorageのモック（preferencesStoreが使用）
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      clear: vi.fn(() => {
        store = {};
      }),
    };
  })();

  beforeEach(() => {
    vi.stubGlobal("localStorage", localStorageMock);
    localStorageMock.clear();
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** デフォルトオプションでインスタンスを作成するヘルパー */
  function createAnnouncer(
    overrides: {
      board?: BoardState;
      cursorPosition?: Position;
      isCursorActivated?: boolean;
    } = {},
  ): AnnouncerFixture {
    const boardData = overrides.board ?? createEmptyBoard();
    const board = computed(() => boardData);
    const cursorPosition = ref<Position>(
      overrides.cursorPosition ?? { row: 7, col: 7 },
    );
    const isCursorActivated = ref(overrides.isCursorActivated ?? true);

    const announcer = useBoardAnnouncer({
      board,
      cursorPosition,
      isCursorActivated,
    });

    return { announcer, board: boardData, cursorPosition, isCursorActivated };
  }

  /** デバウンスを消化するヘルパー */
  function flush(): void {
    vi.advanceTimersByTime(500);
  }

  describe("announceCursorMove", () => {
    it("空の交点で「H8 なし」形式のメッセージをセット", () => {
      const { announcer } = createAnnouncer({
        cursorPosition: { row: 7, col: 7 },
      });

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value.replace(/\u200B/g, "")).toBe(
        "H8 なし",
      );
    });

    it("黒石のある交点で「H8 黒」形式のメッセージをセット", () => {
      const board = createEmptyBoard();
      placeStone(board, 7, 7, "black");

      const { announcer } = createAnnouncer({
        board,
        cursorPosition: { row: 7, col: 7 },
      });

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value.replace(/\u200B/g, "")).toBe(
        "H8 黒",
      );
    });

    it("白石のある交点で「H8 白」形式のメッセージをセット", () => {
      const board = createEmptyBoard();
      placeStone(board, 7, 7, "white");

      const { announcer } = createAnnouncer({
        board,
        cursorPosition: { row: 7, col: 7 },
      });

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value.replace(/\u200B/g, "")).toBe(
        "H8 白",
      );
    });

    it("isCursorActivated=false のとき politeMessage を更新しない", () => {
      const { announcer } = createAnnouncer({ isCursorActivated: false });

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value).toBe("");
    });

    it("同一座標で連続呼び出しでもテキストが異なる（U+200Bトグル）", () => {
      const { announcer } = createAnnouncer({
        cursorPosition: { row: 7, col: 7 },
      });

      announcer.announceCursorMove();
      flush();
      const first = announcer.politeMessage.value;

      announcer.announceCursorMove();
      flush();
      const second = announcer.politeMessage.value;

      // テキスト内容は同じだがU+200Bの有無が異なる
      expect(first.replace(/\u200B/g, "")).toBe(second.replace(/\u200B/g, ""));
      expect(first).not.toBe(second);
    });

    it("境界座標A1（row=14, col=0）で正しい座標を読み上げ", () => {
      const { announcer, cursorPosition } = createAnnouncer();
      cursorPosition.value = { row: 14, col: 0 };

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value.replace(/\u200B/g, "")).toBe(
        "A1 なし",
      );
    });

    it("境界座標O15（row=0, col=14）で正しい座標を読み上げ", () => {
      const { announcer, cursorPosition } = createAnnouncer();
      cursorPosition.value = { row: 0, col: 14 };

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value.replace(/\u200B/g, "")).toBe(
        "O15 なし",
      );
    });

    it("連打時はデバウンスにより最後の位置だけ読み上げ", () => {
      const { announcer, cursorPosition } = createAnnouncer({
        cursorPosition: { row: 7, col: 7 },
      });

      // 3回連続で移動（デバウンス間隔内）
      announcer.announceCursorMove();
      cursorPosition.value = { row: 6, col: 7 };
      announcer.announceCursorMove();
      cursorPosition.value = { row: 5, col: 7 };
      announcer.announceCursorMove();

      // デバウンス前は未更新
      expect(announcer.politeMessage.value).toBe("");

      flush();

      // 最後の位置だけ反映
      expect(announcer.politeMessage.value.replace(/\u200B/g, "")).toBe(
        "H10 なし",
      );
    });
  });

  describe("announceCpuMove", () => {
    it("「相手の着手: H8」形式のメッセージをassertiveMessageにセット", () => {
      const { announcer } = createAnnouncer();

      announcer.announceCpuMove({ row: 7, col: 7 });

      expect(announcer.assertiveMessage.value).toBe("相手の着手: H8");
    });

    it("境界座標A1で正しい座標を読み上げ", () => {
      const { announcer } = createAnnouncer();

      announcer.announceCpuMove({ row: 14, col: 0 });

      expect(announcer.assertiveMessage.value).toBe("相手の着手: A1");
    });

    it("境界座標O15で正しい座標を読み上げ", () => {
      const { announcer } = createAnnouncer();

      announcer.announceCpuMove({ row: 0, col: 14 });

      expect(announcer.assertiveMessage.value).toBe("相手の着手: O15");
    });
  });

  describe("boardAnnounce設定がオフの場合", () => {
    it("announceCursorMove は politeMessage を更新しない", () => {
      const preferencesStore = usePreferencesStore();
      preferencesStore.boardAnnounce = false;

      const { announcer } = createAnnouncer();

      announcer.announceCursorMove();
      flush();

      expect(announcer.politeMessage.value).toBe("");
    });

    it("announceCpuMove は assertiveMessage を更新しない", () => {
      const preferencesStore = usePreferencesStore();
      preferencesStore.boardAnnounce = false;

      const { announcer } = createAnnouncer();

      announcer.announceCpuMove({ row: 7, col: 7 });

      expect(announcer.assertiveMessage.value).toBe("");
    });
  });
});
