import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Stone, Mark, Line } from "./boardStore";

import { useScenarioAnimationStore } from "./scenarioAnimationStore";

describe("scenarioAnimationStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe("初期状態", () => {
    it("animatingIdsが空", () => {
      const store = useScenarioAnimationStore();
      expect(store.animatingIds.size).toBe(0);
    });
  });

  describe("prepareForAnimation", () => {
    it("指定したIDをanimatingIdsに登録する", () => {
      const store = useScenarioAnimationStore();
      store.prepareForAnimation(["id-1", "id-2"]);

      expect(store.isAnimating("id-1")).toBe(true);
      expect(store.isAnimating("id-2")).toBe(true);
      expect(store.isAnimating("id-3")).toBe(false);
    });

    it("空配列でも問題なく動作する", () => {
      const store = useScenarioAnimationStore();
      store.prepareForAnimation([]);

      expect(store.animatingIds.size).toBe(0);
    });
  });

  describe("isAnimating", () => {
    it("アニメーション中の要素に対してtrueを返す", async () => {
      const store = useScenarioAnimationStore();
      // eslint-disable-next-line init-declarations
      let resolveCallback: (() => void) | undefined;
      store.setOnStoneAnimateCallback(
        () =>
          new Promise<void>((resolve) => {
            resolveCallback = resolve;
          }),
      );

      const stone: Stone = {
        id: "test-stone",
        position: { row: 7, col: 7 },
        color: "black",
        placedAtDialogueIndex: 0,
      };

      const animatePromise = store.animateStones([stone]);

      // アニメーション開始を待つ
      await vi.waitFor(() =>
        expect(store.isAnimating("test-stone")).toBe(true),
      );

      // コールバックを完了
      resolveCallback?.();
      await animatePromise;
    });

    it("アニメーション中でない要素に対してfalseを返す", () => {
      const store = useScenarioAnimationStore();
      expect(store.isAnimating("non-existent")).toBe(false);
    });
  });

  describe("animateStones", () => {
    it("コールバックが設定されていれば各石に対して呼ばれる", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnStoneAnimateCallback(callback);

      const stones: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
        {
          id: "stone-2",
          position: { row: 7, col: 8 },
          color: "white",
          placedAtDialogueIndex: 0,
        },
      ];

      await store.animateStones(stones);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith({ row: 7, col: 7 });
      expect(callback).toHaveBeenCalledWith({ row: 7, col: 8 });
    });

    it("animate: falseの場合コールバックはスキップ", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnStoneAnimateCallback(callback);

      const stones: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
      ];

      await store.animateStones(stones, { animate: false });

      expect(callback).not.toHaveBeenCalled();
    });

    it("animate: falseの場合、先行登録されたIDがクリアされる", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnStoneAnimateCallback(callback);

      const stones: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
      ];

      // 先行登録
      store.prepareForAnimation(["stone-1"]);
      expect(store.isAnimating("stone-1")).toBe(true);

      // animate: falseでアニメーション実行
      await store.animateStones(stones, { animate: false });

      // 先行登録されたIDがクリアされている
      expect(store.isAnimating("stone-1")).toBe(false);
    });

    it("コールバック未設定の場合、先行登録されたIDがクリアされる", async () => {
      const store = useScenarioAnimationStore();
      // コールバック未設定

      const stones: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
      ];

      // 先行登録
      store.prepareForAnimation(["stone-1"]);
      expect(store.isAnimating("stone-1")).toBe(true);

      // コールバック未設定でアニメーション実行
      await store.animateStones(stones);

      // 先行登録されたIDがクリアされている
      expect(store.isAnimating("stone-1")).toBe(false);
    });

    it("アニメーション完了後はisAnimating(id)がfalse", async () => {
      const store = useScenarioAnimationStore();
      store.setOnStoneAnimateCallback(() => Promise.resolve());

      const stone: Stone = {
        id: "test-stone",
        position: { row: 7, col: 7 },
        color: "black",
        placedAtDialogueIndex: 0,
      };

      await store.animateStones([stone]);

      expect(store.isAnimating("test-stone")).toBe(false);
    });

    it("コールバック未設定でもエラーにならない", async () => {
      const store = useScenarioAnimationStore();

      const stones: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
      ];

      await expect(store.animateStones(stones)).resolves.toBeUndefined();
    });
  });

  describe("animateMarks", () => {
    it("コールバックが設定されていれば各マークに対して呼ばれる", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnMarkAnimateCallback(callback);

      const marks: Mark[] = [
        {
          id: "mark-1",
          positions: [{ row: 7, col: 7 }],
          markType: "circle",
          placedAtDialogueIndex: 0,
        },
        {
          id: "mark-2",
          positions: [{ row: 8, col: 8 }],
          markType: "cross",
          placedAtDialogueIndex: 0,
        },
      ];

      await store.animateMarks(marks);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("animate: falseの場合コールバックはスキップ", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnMarkAnimateCallback(callback);

      const marks: Mark[] = [
        {
          id: "mark-1",
          positions: [{ row: 7, col: 7 }],
          markType: "circle",
          placedAtDialogueIndex: 0,
        },
      ];

      await store.animateMarks(marks, { animate: false });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("animateLines", () => {
    it("コールバックが設定されていれば各ラインに対して呼ばれる", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnLineAnimateCallback(callback);

      const lines: Line[] = [
        {
          id: "line-1",
          fromPosition: { row: 0, col: 0 },
          toPosition: { row: 14, col: 14 },
          style: "solid",
          placedAtDialogueIndex: 0,
        },
        {
          id: "line-2",
          fromPosition: { row: 0, col: 14 },
          toPosition: { row: 14, col: 0 },
          style: "dashed",
          placedAtDialogueIndex: 0,
        },
      ];

      await store.animateLines(lines);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it("animate: falseの場合コールバックはスキップ", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnLineAnimateCallback(callback);

      const lines: Line[] = [
        {
          id: "line-1",
          fromPosition: { row: 0, col: 0 },
          toPosition: { row: 14, col: 14 },
          style: "solid",
          placedAtDialogueIndex: 0,
        },
      ];

      await store.animateLines(lines, { animate: false });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("cancelOngoingAnimations", () => {
    it("onAnimationCancelCallbackを呼ぶ", () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn();
      store.setOnAnimationCancelCallback(callback);

      store.cancelOngoingAnimations();

      expect(callback).toHaveBeenCalled();
    });

    it("animatingIdsをクリアする", async () => {
      const store = useScenarioAnimationStore();
      // eslint-disable-next-line init-declarations
      let resolveCallback: (() => void) | undefined;
      store.setOnStoneAnimateCallback(
        () =>
          new Promise<void>((resolve) => {
            resolveCallback = resolve;
          }),
      );

      const stone: Stone = {
        id: "test-stone",
        position: { row: 7, col: 7 },
        color: "black",
        placedAtDialogueIndex: 0,
      };

      const animatePromise = store.animateStones([stone]);

      // アニメーション開始を待つ
      await vi.waitFor(() => expect(store.animatingIds.size).toBe(1));

      store.cancelOngoingAnimations();

      expect(store.animatingIds.size).toBe(0);

      // プロミスを解決
      resolveCallback?.();
      await animatePromise;
    });
  });

  describe("レースコンディション対策", () => {
    it("animateStones中にcancelが呼ばれると残りがスキップされる", async () => {
      const store = useScenarioAnimationStore();
      // eslint-disable-next-line init-declarations
      let resolveCallback: (() => void) | undefined;
      const callback = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCallback = resolve;
          }),
      );
      store.setOnStoneAnimateCallback(callback);

      const stones: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
        {
          id: "stone-2",
          position: { row: 7, col: 8 },
          color: "white",
          placedAtDialogueIndex: 0,
        },
      ];

      // アニメーション開始
      const animatePromise = store.animateStones(stones);

      // 最初の石のアニメーション中にキャンセル
      await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
      store.cancelOngoingAnimations();

      // 最初のコールバックを解決
      resolveCallback?.();
      await animatePromise;

      // 2番目の石はコールバックが呼ばれない（キャンセルされたため）
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("新しいanimateStonesが開始されると古い呼び出しはスキップされる", async () => {
      const store = useScenarioAnimationStore();
      // eslint-disable-next-line init-declarations
      let resolveCallback: (() => void) | undefined;
      const callback = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveCallback = resolve;
          }),
      );
      store.setOnStoneAnimateCallback(callback);

      const stones1: Stone[] = [
        {
          id: "stone-1",
          position: { row: 7, col: 7 },
          color: "black",
          placedAtDialogueIndex: 0,
        },
        {
          id: "stone-2",
          position: { row: 7, col: 8 },
          color: "white",
          placedAtDialogueIndex: 0,
        },
      ];

      const stones2: Stone[] = [
        {
          id: "stone-3",
          position: { row: 8, col: 7 },
          color: "black",
          placedAtDialogueIndex: 1,
        },
      ];

      // 最初のアニメーション開始
      const animatePromise1 = store.animateStones(stones1);

      // 最初の石のアニメーション中に新しいアニメーション開始
      await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));

      // 最初のコールバックを解決
      resolveCallback?.();

      // 新しいアニメーション開始（これにより古い呼び出しがキャンセルされる）
      const animatePromise2 = store.animateStones(stones2);

      await animatePromise1;

      // 新しいアニメーションのコールバックを待つ
      await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));

      // 新しいコールバックを解決
      resolveCallback?.();
      await animatePromise2;

      // stone-1とstone-3のみ、stone-2はスキップ
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith({ row: 7, col: 7 }); // stone-1
      expect(callback).toHaveBeenCalledWith({ row: 8, col: 7 }); // stone-3
    });
  });

  describe("$reset", () => {
    it("全ての状態をリセットする", async () => {
      const store = useScenarioAnimationStore();
      const callback = vi.fn(() => Promise.resolve());
      store.setOnStoneAnimateCallback(callback);

      const stone: Stone = {
        id: "test-stone",
        position: { row: 7, col: 7 },
        color: "black",
        placedAtDialogueIndex: 0,
      };

      await store.animateStones([stone]);

      store.$reset();

      expect(store.animatingIds.size).toBe(0);
      // コールバックがクリアされていることを確認
      await store.animateStones([stone]);
      expect(callback).toHaveBeenCalledTimes(1); // $reset前の1回のみ
    });
  });
});
