import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useKeyboardNavigation } from "./useKeyboardNavigation";

describe("useKeyboardNavigation", () => {
  // モック関数
  // eslint-disable-next-line init-declarations
  let onPlaceStone: () => void;
  // eslint-disable-next-line init-declarations
  let onDialogueNavigate: (direction: "next" | "previous") => void;

  // キーボードイベントを作成するヘルパー（Node環境用）
  const createKeyEvent = (key: string): KeyboardEvent =>
    ({
      key,
      preventDefault: vi.fn(),
    }) as unknown as KeyboardEvent;

  beforeEach(() => {
    onPlaceStone = vi.fn();
    onDialogueNavigate = vi.fn();
  });

  describe("初期状態", () => {
    it("cursorPositionが(7, 7)から始まる", () => {
      const { cursorPosition } = useKeyboardNavigation(onPlaceStone);

      expect(cursorPosition.value).toEqual({ row: 7, col: 7 });
    });
  });

  describe("moveCursor", () => {
    it("up: rowを1減らす", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 7, col: 7 };

      moveCursor("up");

      expect(cursorPosition.value.row).toBe(6);
    });

    it("down: rowを1増やす", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 7, col: 7 };

      moveCursor("down");

      expect(cursorPosition.value.row).toBe(8);
    });

    it("left: colを1減らす", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 7, col: 7 };

      moveCursor("left");

      expect(cursorPosition.value.col).toBe(6);
    });

    it("right: colを1増やす", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 7, col: 7 };

      moveCursor("right");

      expect(cursorPosition.value.col).toBe(8);
    });

    it("境界値: row=0からupで0のまま", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 0, col: 7 };

      moveCursor("up");

      expect(cursorPosition.value.row).toBe(0);
    });

    it("境界値: row=14からdownで14のまま", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 14, col: 7 };

      moveCursor("down");

      expect(cursorPosition.value.row).toBe(14);
    });

    it("境界値: col=0からleftで0のまま", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 7, col: 0 };

      moveCursor("left");

      expect(cursorPosition.value.col).toBe(0);
    });

    it("境界値: col=14からrightで14のまま", () => {
      const { cursorPosition, moveCursor } =
        useKeyboardNavigation(onPlaceStone);
      cursorPosition.value = { row: 7, col: 14 };

      moveCursor("right");

      expect(cursorPosition.value.col).toBe(14);
    });
  });

  describe("handleKeyDown", () => {
    describe("WASDキーでカーソル移動", () => {
      it("wキーでupに移動", () => {
        const { cursorPosition, handleKeyDown } =
          useKeyboardNavigation(onPlaceStone);
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("w"));

        expect(cursorPosition.value.row).toBe(6);
      });

      it("Wキー（大文字）でもupに移動", () => {
        const { cursorPosition, handleKeyDown } =
          useKeyboardNavigation(onPlaceStone);
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("W"));

        expect(cursorPosition.value.row).toBe(6);
      });

      it("aキーでleftに移動", () => {
        const { cursorPosition, handleKeyDown } =
          useKeyboardNavigation(onPlaceStone);
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("a"));

        expect(cursorPosition.value.col).toBe(6);
      });

      it("sキーでdownに移動", () => {
        const { cursorPosition, handleKeyDown } =
          useKeyboardNavigation(onPlaceStone);
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("s"));

        expect(cursorPosition.value.row).toBe(8);
      });

      it("dキーでrightに移動", () => {
        const { cursorPosition, handleKeyDown } =
          useKeyboardNavigation(onPlaceStone);
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("d"));

        expect(cursorPosition.value.col).toBe(8);
      });
    });

    describe("石配置キー", () => {
      it("SpaceキーでonPlaceStoneを呼ぶ", () => {
        const { handleKeyDown } = useKeyboardNavigation(onPlaceStone);

        handleKeyDown(createKeyEvent(" "));

        expect(onPlaceStone).toHaveBeenCalledTimes(1);
      });

      it("Enterキーでも onPlaceStoneを呼ぶ", () => {
        const { handleKeyDown } = useKeyboardNavigation(onPlaceStone);

        handleKeyDown(createKeyEvent("Enter"));

        expect(onPlaceStone).toHaveBeenCalledTimes(1);
      });
    });

    describe("矢印キーでセリフナビゲーション", () => {
      it("ArrowLeftキーでonDialogueNavigate('previous')を呼ぶ", () => {
        const { handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
        );

        handleKeyDown(createKeyEvent("ArrowLeft"));

        expect(onDialogueNavigate).toHaveBeenCalledWith("previous");
      });

      it("ArrowRightキーでonDialogueNavigate('next')を呼ぶ", () => {
        const { handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
        );

        handleKeyDown(createKeyEvent("ArrowRight"));

        expect(onDialogueNavigate).toHaveBeenCalledWith("next");
      });

      it("onDialogueNavigateがない時、矢印キーは何もしない", () => {
        const { handleKeyDown } = useKeyboardNavigation(onPlaceStone);

        // エラーが発生しないことを確認
        expect(() => handleKeyDown(createKeyEvent("ArrowLeft"))).not.toThrow();
        expect(() => handleKeyDown(createKeyEvent("ArrowRight"))).not.toThrow();
      });
    });

    describe("isDisabled時の動作", () => {
      it("isDisabledがtrueの時、カーソル移動キーは無視", () => {
        const isDisabled = ref(true);
        const { cursorPosition, handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
          isDisabled,
        );
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("w"));
        handleKeyDown(createKeyEvent("a"));
        handleKeyDown(createKeyEvent("s"));
        handleKeyDown(createKeyEvent("d"));

        // 移動していない
        expect(cursorPosition.value).toEqual({ row: 7, col: 7 });
      });

      it("isDisabledがtrueの時、石配置キーは無視", () => {
        const isDisabled = ref(true);
        const { handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
          isDisabled,
        );

        handleKeyDown(createKeyEvent(" "));
        handleKeyDown(createKeyEvent("Enter"));

        expect(onPlaceStone).not.toHaveBeenCalled();
      });

      it("isDisabledがtrueの時、矢印キーは有効（会話送り）", () => {
        const isDisabled = ref(true);
        const { handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
          isDisabled,
        );

        handleKeyDown(createKeyEvent("ArrowLeft"));
        handleKeyDown(createKeyEvent("ArrowRight"));

        expect(onDialogueNavigate).toHaveBeenCalledTimes(2);
        expect(onDialogueNavigate).toHaveBeenCalledWith("previous");
        expect(onDialogueNavigate).toHaveBeenCalledWith("next");
      });

      it("isDisabledがfalseの時、全てのキーが有効", () => {
        const isDisabled = ref(false);
        const { cursorPosition, handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
          isDisabled,
        );
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("w"));
        expect(cursorPosition.value.row).toBe(6);

        handleKeyDown(createKeyEvent(" "));
        expect(onPlaceStone).toHaveBeenCalled();
      });
    });

    describe("preventDefaultの呼び出し", () => {
      it("WASDキーでpreventDefaultが呼ばれる", () => {
        const { handleKeyDown } = useKeyboardNavigation(onPlaceStone);

        const event = createKeyEvent("w");
        handleKeyDown(event);

        expect(event.preventDefault).toHaveBeenCalled();
      });

      it("Space/EnterキーでpreventDefaultが呼ばれる", () => {
        const { handleKeyDown } = useKeyboardNavigation(onPlaceStone);

        const spaceEvent = createKeyEvent(" ");
        handleKeyDown(spaceEvent);
        expect(spaceEvent.preventDefault).toHaveBeenCalled();

        const enterEvent = createKeyEvent("Enter");
        handleKeyDown(enterEvent);
        expect(enterEvent.preventDefault).toHaveBeenCalled();
      });

      it("矢印キーでpreventDefaultが呼ばれる", () => {
        const { handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
        );

        const leftEvent = createKeyEvent("ArrowLeft");
        handleKeyDown(leftEvent);
        expect(leftEvent.preventDefault).toHaveBeenCalled();
      });
    });

    describe("未定義キー", () => {
      it("未定義のキーは何もしない", () => {
        const { cursorPosition, handleKeyDown } = useKeyboardNavigation(
          onPlaceStone,
          onDialogueNavigate,
        );
        cursorPosition.value = { row: 7, col: 7 };

        handleKeyDown(createKeyEvent("x"));
        handleKeyDown(createKeyEvent("Escape"));
        handleKeyDown(createKeyEvent("Tab"));

        expect(cursorPosition.value).toEqual({ row: 7, col: 7 });
        expect(onPlaceStone).not.toHaveBeenCalled();
        expect(onDialogueNavigate).not.toHaveBeenCalled();
      });
    });
  });

  describe("placeStoneAtCursor", () => {
    it("onPlaceStoneコールバックを呼ぶ", () => {
      const { placeStoneAtCursor } = useKeyboardNavigation(onPlaceStone);

      placeStoneAtCursor();

      expect(onPlaceStone).toHaveBeenCalledTimes(1);
    });
  });
});
