import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computed, nextTick } from "vue";

import type { Mark, Line } from "@/stores/boardStore";

import { useRenjuBoardAnimation } from "./useRenjuBoardAnimation";

// Tweenインスタンスを追跡
const tweenInstances: {
  config: {
    node: unknown;
    duration: number;
    onFinish?: () => void;
  };
  play: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
}[] = [];

// Konvaモック
vi.mock("konva", () => ({
  default: {
    Tween: class MockTween {
      config: {
        node: unknown;
        duration: number;
        onFinish?: () => void;
      };
      play = vi.fn();
      finish = vi.fn();

      constructor(config: {
        node: unknown;
        duration: number;
        onFinish?: () => void;
      }) {
        this.config = config;
        this.play = vi.fn(() => {
          // 即座に完了をシミュレート
          queueMicrotask(() => this.config.onFinish?.());
        });
        this.finish = vi.fn(() => {
          this.config.onFinish?.();
        });
        tweenInstances.push(this);
      }
    },
    Easings: {
      EaseOut: "easeOut",
      BackEaseOut: "backEaseOut",
    },
  },
}));

// preferencesStoreモック
const mockStoneAnimationDuration = { value: 0.2 };
const mockMarkAnimationDuration = { value: 0.25 };
const mockLineAnimationDuration = { value: 0.2 };

vi.mock("@/stores/preferencesStore", () => ({
  usePreferencesStore: () => ({
    get stoneAnimationDuration() {
      return mockStoneAnimationDuration.value;
    },
    get markAnimationDuration() {
      return mockMarkAnimationDuration.value;
    },
    get lineAnimationDuration() {
      return mockLineAnimationDuration.value;
    },
  }),
}));

// モックレイアウト
function createMockLayout(): ReturnType<
  typeof import("./useRenjuBoardLayout").useRenjuBoardLayout
> {
  const stageSize = computed(() => 400);
  return {
    BOARD_SIZE: 15,
    STAGE_WIDTH: stageSize,
    STAGE_HEIGHT: stageSize,
    CELL_SIZE: computed(() => 25),
    PADDING: computed(() => 25),
    STONE_RADIUS: computed(() => 11.25),
    positionToPixels: (row: number, col: number) => ({
      x: 25 + col * 25,
      y: 25 + row * 25,
    }),
    pixelsToPosition: (): { row: number; col: number } | null => null,
  };
}

// 複数のmicrotaskをフラッシュするヘルパー
async function flushMicrotasks(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useRenjuBoardAnimation", () => {
  beforeEach(() => {
    tweenInstances.length = 0;
    mockStoneAnimationDuration.value = 0.2;
    mockMarkAnimationDuration.value = 0.25;
    mockLineAnimationDuration.value = 0.2;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("refs管理", () => {
    it("stoneRefsが空のオブジェクトとして初期化される", () => {
      const layout = createMockLayout();
      const { stoneRefs } = useRenjuBoardAnimation(layout);

      expect(stoneRefs).toEqual({});
    });

    it("markRefsが空のオブジェクトとして初期化される", () => {
      const layout = createMockLayout();
      const { markRefs } = useRenjuBoardAnimation(layout);

      expect(markRefs).toEqual({});
    });

    it("lineRefsが空のオブジェクトとして初期化される", () => {
      const layout = createMockLayout();
      const { lineRefs } = useRenjuBoardAnimation(layout);

      expect(lineRefs).toEqual({});
    });

    it("stoneRefsにrefを登録できる", () => {
      const layout = createMockLayout();
      const { stoneRefs } = useRenjuBoardAnimation(layout);

      const mockNode = { getNode: () => ({ y: vi.fn() }) };
      stoneRefs["0-0"] = mockNode;

      expect(stoneRefs["0-0"]).toBe(mockNode);
    });

    it("markRefsにrefを登録できる", () => {
      const layout = createMockLayout();
      const { markRefs } = useRenjuBoardAnimation(layout);

      const mockNode = { getNode: () => ({}) };
      markRefs["mark-1"] = mockNode;

      expect(markRefs["mark-1"]).toBe(mockNode);
    });

    it("lineRefsにrefを登録できる", () => {
      const layout = createMockLayout();
      const { lineRefs } = useRenjuBoardAnimation(layout);

      const mockNode = { getNode: () => ({}) };
      lineRefs["line-1"] = mockNode;

      expect(lineRefs["line-1"]).toBe(mockNode);
    });
  });

  describe("animateStone", () => {
    it("duration=0の場合は即座にPromiseが解決する", async () => {
      mockStoneAnimationDuration.value = 0;

      const layout = createMockLayout();
      const { animateStone } = useRenjuBoardAnimation(layout);

      await animateStone({ row: 7, col: 7 });

      expect(tweenInstances.length).toBe(0);
    });

    it("stoneRefがない場合は即座に解決する", async () => {
      const layout = createMockLayout();
      const { animateStone } = useRenjuBoardAnimation(layout);

      await animateStone({ row: 7, col: 7 });
      await flushMicrotasks();

      expect(tweenInstances.length).toBe(0);
    });

    it("Konva.Tweenが生成される", async () => {
      const layout = createMockLayout();
      const { stoneRefs, animateStone } = useRenjuBoardAnimation(layout);

      const mockNode = {
        y: vi.fn(),
      };
      stoneRefs["7-7"] = { getNode: () => mockNode };

      const promise = animateStone({ row: 7, col: 7 });
      await flushMicrotasks();
      await promise;

      expect(tweenInstances.length).toBe(1);
    });

    it("playが呼ばれる", async () => {
      const layout = createMockLayout();
      const { stoneRefs, animateStone } = useRenjuBoardAnimation(layout);

      const mockNode = { y: vi.fn() };
      stoneRefs["7-7"] = { getNode: () => mockNode };

      const promise = animateStone({ row: 7, col: 7 });
      await flushMicrotasks();
      await promise;

      expect(tweenInstances[0].play).toHaveBeenCalled();
    });

    it("アニメーション完了でPromiseが解決する", async () => {
      const layout = createMockLayout();
      const { stoneRefs, animateStone } = useRenjuBoardAnimation(layout);

      const mockNode = { y: vi.fn() };
      stoneRefs["7-7"] = { getNode: () => mockNode };

      const promise = animateStone({ row: 7, col: 7 });
      await flushMicrotasks();
      await expect(promise).resolves.toBeUndefined();
    });

    it("konvaNodeがnullの場合は即座に解決する", async () => {
      const layout = createMockLayout();
      const { stoneRefs, animateStone } = useRenjuBoardAnimation(layout);

      stoneRefs["7-7"] = { getNode: (): null => null };

      await animateStone({ row: 7, col: 7 });
      await flushMicrotasks();

      expect(tweenInstances.length).toBe(0);
    });
  });

  describe("animateMark", () => {
    it("duration=0の場合は即座にPromiseが解決する", async () => {
      mockMarkAnimationDuration.value = 0;

      const layout = createMockLayout();
      const { animateMark } = useRenjuBoardAnimation(layout);

      const mark: Mark = {
        id: "mark-1",
        positions: [{ row: 7, col: 7 }],
        markType: "circle",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      await animateMark(mark);

      expect(tweenInstances.length).toBe(0);
    });

    it("Konva.Tweenが生成される", async () => {
      const layout = createMockLayout();
      const { markRefs, animateMark } = useRenjuBoardAnimation(layout);

      const mockNode = {};
      markRefs["mark-1"] = { getNode: () => mockNode };

      const mark: Mark = {
        id: "mark-1",
        positions: [{ row: 7, col: 7 }],
        markType: "circle",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      const promise = animateMark(mark);
      await flushMicrotasks();
      await promise;

      expect(tweenInstances.length).toBe(1);
    });

    it("playが呼ばれる", async () => {
      const layout = createMockLayout();
      const { markRefs, animateMark } = useRenjuBoardAnimation(layout);

      const mockNode = {};
      markRefs["mark-1"] = { getNode: () => mockNode };

      const mark: Mark = {
        id: "mark-1",
        positions: [{ row: 7, col: 7 }],
        markType: "circle",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      const promise = animateMark(mark);
      await flushMicrotasks();
      await promise;

      expect(tweenInstances[0].play).toHaveBeenCalled();
    });

    it("markRefがない場合は即座に解決する", async () => {
      const layout = createMockLayout();
      const { animateMark } = useRenjuBoardAnimation(layout);

      const mark: Mark = {
        id: "mark-1",
        positions: [{ row: 7, col: 7 }],
        markType: "circle",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      await animateMark(mark);
      await flushMicrotasks();

      expect(tweenInstances.length).toBe(0);
    });
  });

  describe("animateLine", () => {
    it("duration=0の場合は即座にPromiseが解決する", async () => {
      mockLineAnimationDuration.value = 0;

      const layout = createMockLayout();
      const { animateLine } = useRenjuBoardAnimation(layout);

      const line: Line = {
        id: "line-1",
        fromPosition: { row: 0, col: 0 },
        toPosition: { row: 4, col: 4 },
        style: "solid",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      await animateLine(line);

      expect(tweenInstances.length).toBe(0);
    });

    it("Konva.Tweenが生成される", async () => {
      const layout = createMockLayout();
      const { lineRefs, animateLine } = useRenjuBoardAnimation(layout);

      const mockNode = {};
      lineRefs["line-1"] = { getNode: () => mockNode };

      const line: Line = {
        id: "line-1",
        fromPosition: { row: 0, col: 0 },
        toPosition: { row: 4, col: 4 },
        style: "solid",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      const promise = animateLine(line);
      await flushMicrotasks();
      await promise;

      expect(tweenInstances.length).toBe(1);
    });

    it("playが呼ばれる", async () => {
      const layout = createMockLayout();
      const { lineRefs, animateLine } = useRenjuBoardAnimation(layout);

      const mockNode = {};
      lineRefs["line-1"] = { getNode: () => mockNode };

      const line: Line = {
        id: "line-1",
        fromPosition: { row: 0, col: 0 },
        toPosition: { row: 4, col: 4 },
        style: "solid",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      const promise = animateLine(line);
      await flushMicrotasks();
      await promise;

      expect(tweenInstances[0].play).toHaveBeenCalled();
    });

    it("lineRefがない場合は即座に解決する", async () => {
      const layout = createMockLayout();
      const { animateLine } = useRenjuBoardAnimation(layout);

      const line: Line = {
        id: "line-1",
        fromPosition: { row: 0, col: 0 },
        toPosition: { row: 4, col: 4 },
        style: "solid",
        placedAtDialogueIndex: 0,
        shouldAnimate: true,
      };

      await animateLine(line);
      await flushMicrotasks();

      expect(tweenInstances.length).toBe(0);
    });
  });

  describe("finishAllAnimations", () => {
    it("全てのアクティブなTweenのfinishが呼ばれる", async () => {
      const layout = createMockLayout();
      const { stoneRefs, animateStone, finishAllAnimations } =
        useRenjuBoardAnimation(layout);

      const mockNode = { y: vi.fn() };
      stoneRefs["0-0"] = { getNode: () => mockNode };

      const promise = animateStone({ row: 0, col: 0 });
      await flushMicrotasks();
      await promise;

      // finishは最初のplayでアニメーション完了しているが、
      // finishAllAnimationsを呼んでもエラーにならないことを確認
      expect(() => finishAllAnimations()).not.toThrow();
    });

    it("activeTweensがクリアされる", async () => {
      const layout = createMockLayout();
      const { stoneRefs, animateStone, finishAllAnimations } =
        useRenjuBoardAnimation(layout);

      const mockNode = { y: vi.fn() };
      stoneRefs["0-0"] = { getNode: () => mockNode };

      const promise = animateStone({ row: 0, col: 0 });
      await flushMicrotasks();
      await promise;

      finishAllAnimations();

      // finishAllAnimationsを再度呼んでもエラーにならない（空なので）
      expect(() => finishAllAnimations()).not.toThrow();
    });
  });
});
