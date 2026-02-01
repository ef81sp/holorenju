import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { ref } from "vue";

import { useCutinDisplay } from "./useCutinDisplay";

// onUnmountedをモック
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    onUnmounted: vi.fn(),
  };
});

// preferencesStoreをモック
vi.mock("@/stores/preferencesStore", () => ({
  usePreferencesStore: () => ({
    cutinDisplayDuration: 0.8, // 800ms
  }),
}));

describe("useCutinDisplay", () => {
  // eslint-disable-next-line init-declarations
  let mockCutinRef: ReturnType<
    typeof ref<{ showPopover: Mock; hidePopover: Mock } | null>
  >;
  // eslint-disable-next-line init-declarations
  let mockAddEventListener: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line init-declarations
  let mockRemoveEventListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();

    mockCutinRef = ref({
      showPopover: vi.fn(),
      hidePopover: vi.fn(),
    });

    mockAddEventListener = vi.fn();
    mockRemoveEventListener = vi.fn();
    vi.stubGlobal("window", {
      addEventListener: mockAddEventListener,
      removeEventListener: mockRemoveEventListener,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("showCutin", () => {
    it("popoverのshowPopoverが呼ばれる", () => {
      const { showCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");

      expect(mockCutinRef.value?.showPopover).toHaveBeenCalled();
    });

    it("isCutinVisibleがtrueになる", () => {
      const { showCutin, isCutinVisible } = useCutinDisplay(mockCutinRef);

      expect(isCutinVisible.value).toBe(false);
      showCutin("correct");
      expect(isCutinVisible.value).toBe(true);
    });

    it("correctタイプでカットインが表示される", () => {
      const { showCutin, isCutinVisible } = useCutinDisplay(mockCutinRef);

      showCutin("correct");

      expect(isCutinVisible.value).toBe(true);
      expect(mockCutinRef.value?.showPopover).toHaveBeenCalled();
    });

    it("wrongタイプでカットインが表示される", () => {
      const { showCutin, isCutinVisible } = useCutinDisplay(mockCutinRef);

      showCutin("wrong");

      expect(isCutinVisible.value).toBe(true);
      expect(mockCutinRef.value?.showPopover).toHaveBeenCalled();
    });

    it("cutinRefがnullの場合は何もしない", () => {
      const nullRef = ref(null);
      const { showCutin, isCutinVisible } = useCutinDisplay(nullRef);

      showCutin("correct");

      expect(isCutinVisible.value).toBe(false);
    });

    it("既にカットイン表示中なら一度閉じてから開く", () => {
      const { showCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");
      showCutin("wrong");

      expect(mockCutinRef.value?.hidePopover).toHaveBeenCalled();
      expect(mockCutinRef.value?.showPopover).toHaveBeenCalledTimes(2);
    });
  });

  describe("自動非表示", () => {
    it("800ms後にhidePopoverが呼ばれる", () => {
      const { showCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");
      expect(mockCutinRef.value?.hidePopover).not.toHaveBeenCalled();

      vi.advanceTimersByTime(800);

      expect(mockCutinRef.value?.hidePopover).toHaveBeenCalled();
    });

    it("wrongタイプも800ms後に非表示", () => {
      const { showCutin } = useCutinDisplay(mockCutinRef);

      showCutin("wrong");

      vi.advanceTimersByTime(800);

      expect(mockCutinRef.value?.hidePopover).toHaveBeenCalled();
    });

    it("タイマー中にhideCutinで即座に非表示", () => {
      const { showCutin, hideCutin, isCutinVisible } =
        useCutinDisplay(mockCutinRef);

      showCutin("correct");
      expect(isCutinVisible.value).toBe(true);

      // 400ms経過（まだタイマー実行前）
      vi.advanceTimersByTime(400);
      expect(mockCutinRef.value?.hidePopover).not.toHaveBeenCalled();

      // 手動で非表示
      hideCutin();

      expect(mockCutinRef.value?.hidePopover).toHaveBeenCalled();
      expect(isCutinVisible.value).toBe(false);
    });
  });

  describe("キーボードスキップ", () => {
    it("カットイン表示時にキーボードリスナーが登録される", () => {
      const { showCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");

      expect(mockAddEventListener).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        { capture: true },
      );
    });

    it("非表示時にイベントリスナーが削除される", () => {
      const { showCutin, hideCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");
      hideCutin();

      expect(mockRemoveEventListener).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
        { capture: true },
      );
    });
  });

  describe("hideCutin", () => {
    it("isCutinVisibleがfalseになる", () => {
      const { showCutin, hideCutin, isCutinVisible } =
        useCutinDisplay(mockCutinRef);

      showCutin("correct");
      expect(isCutinVisible.value).toBe(true);

      hideCutin();
      expect(isCutinVisible.value).toBe(false);
    });

    it("非表示状態で呼んでも何もしない", () => {
      const { hideCutin, isCutinVisible } = useCutinDisplay(mockCutinRef);

      expect(isCutinVisible.value).toBe(false);
      hideCutin();

      expect(mockCutinRef.value?.hidePopover).not.toHaveBeenCalled();
    });

    it("hidePopoverが呼ばれる", () => {
      const { showCutin, hideCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");
      hideCutin();

      expect(mockCutinRef.value?.hidePopover).toHaveBeenCalled();
    });
  });

  describe("タイマークリア", () => {
    it("hideCutin呼び出しでタイマーがクリアされる", () => {
      const { showCutin, hideCutin } = useCutinDisplay(mockCutinRef);

      showCutin("correct");
      hideCutin();

      // 800ms経過してもhidePopoverは1回だけ
      vi.advanceTimersByTime(800);

      expect(mockCutinRef.value?.hidePopover).toHaveBeenCalledTimes(1);
    });
  });
});
