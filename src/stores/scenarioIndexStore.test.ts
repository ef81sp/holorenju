import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useScenarioIndexStore } from "./scenarioIndexStore";

// fetchモック
const mockIndexData = {
  difficulties: {
    gomoku_beginner: {
      label: "五目並べ:入門",
      scenarios: [
        {
          id: "scenario_1",
          title: "テストシナリオ1",
          description: "説明1",
          path: "gomoku_beginner/scenario_1.json",
        },
        {
          id: "scenario_2",
          title: "テストシナリオ2",
          description: "説明2",
          path: "gomoku_beginner/scenario_2.json",
        },
      ],
    },
    renju_beginner: {
      label: "連珠:入門",
      scenarios: [
        {
          id: "scenario_3",
          title: "テストシナリオ3",
          description: "説明3",
          path: "renju_beginner/scenario_3.json",
        },
      ],
    },
  },
};

describe("scenarioIndexStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("初期状態", () => {
    it("indexはnull", () => {
      const store = useScenarioIndexStore();

      expect(store.index).toBeNull();
    });

    it("isLoadingはfalse", () => {
      const store = useScenarioIndexStore();

      expect(store.isLoading).toBe(false);
    });

    it("errorはnull", () => {
      const store = useScenarioIndexStore();

      expect(store.error).toBeNull();
    });
  });

  describe("loadIndex", () => {
    it("正常にindexを読み込む", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockIndexData),
        }),
      );

      const store = useScenarioIndexStore();
      await store.loadIndex();

      expect(store.index).toEqual(mockIndexData);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("読み込み中はisLoadingがtrue", async () => {
      // eslint-disable-next-line no-empty-function
      let resolvePromise: (value: unknown) => void = () => {};
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      vi.stubGlobal("fetch", vi.fn().mockReturnValue(pendingPromise));

      const store = useScenarioIndexStore();
      const loadPromise = store.loadIndex();

      expect(store.isLoading).toBe(true);

      resolvePromise({
        ok: true,
        json: () => Promise.resolve(mockIndexData),
      });
      await loadPromise;

      expect(store.isLoading).toBe(false);
    });

    it("すでに読み込み済みなら再読み込みしない", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockIndexData),
      });
      vi.stubGlobal("fetch", fetchMock);

      const store = useScenarioIndexStore();
      await store.loadIndex();
      await store.loadIndex();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("HTTPエラー時にerrorが設定される", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        }),
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const store = useScenarioIndexStore();
      await store.loadIndex();

      expect(store.error).toBe("シナリオ一覧の読み込みに失敗しました");
      expect(store.index).toBeNull();
    });

    it("ネットワークエラー時にerrorが設定される", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Network error")),
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const store = useScenarioIndexStore();
      await store.loadIndex();

      expect(store.error).toBe("シナリオ一覧の読み込みに失敗しました");
      expect(store.index).toBeNull();
    });
  });

  describe("findScenarioPath", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(mockIndexData),
        }),
      );
    });

    it("存在するシナリオのパスを返す", async () => {
      const store = useScenarioIndexStore();
      await store.loadIndex();

      const path = store.findScenarioPath("scenario_1");

      expect(path).toBe("gomoku_beginner/scenario_1.json");
    });

    it("別の難易度のシナリオも検索できる", async () => {
      const store = useScenarioIndexStore();
      await store.loadIndex();

      const path = store.findScenarioPath("scenario_3");

      expect(path).toBe("renju_beginner/scenario_3.json");
    });

    it("存在しないシナリオはnullを返す", async () => {
      const store = useScenarioIndexStore();
      await store.loadIndex();

      const path = store.findScenarioPath("nonexistent");

      expect(path).toBeNull();
    });

    it("indexが未読み込みならnullを返す", () => {
      const store = useScenarioIndexStore();

      const path = store.findScenarioPath("scenario_1");

      expect(path).toBeNull();
    });
  });
});
