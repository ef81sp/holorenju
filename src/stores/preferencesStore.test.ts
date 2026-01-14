import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePreferencesStore } from "./preferencesStore";

describe("preferencesStore", () => {
  // localStorageのモック
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        Reflect.deleteProperty(store, key);
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("初期状態", () => {
    it("animation.enabledがtrue", () => {
      const store = usePreferencesStore();
      expect(store.animationEnabled).toBe(true);
    });

    it("animation.stoneSpeedがnormal", () => {
      const store = usePreferencesStore();
      expect(store.stoneSpeed).toBe("normal");
    });

    it("display.textSizeがnormal", () => {
      const store = usePreferencesStore();
      expect(store.textSize).toBe("normal");
    });
  });

  describe("localStorage読み込み", () => {
    it("保存されたデータを復元する", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: false, stoneSpeed: "fast" },
          display: { textSize: "large" },
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.animationEnabled).toBe(false);
      expect(store.stoneSpeed).toBe("fast");
      expect(store.textSize).toBe("large");
    });

    it("部分的なデータでもデフォルト値とマージする", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: false },
          // stoneSpeed, displayは未定義
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.animationEnabled).toBe(false);
      expect(store.stoneSpeed).toBe("normal"); // デフォルト値
      expect(store.textSize).toBe("normal"); // デフォルト値
    });

    it("不正なJSONでもクラッシュしない", () => {
      localStorageMock.setItem("holorenju_preferences", "invalid json");
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      // デフォルト値が使用される
      expect(store.animationEnabled).toBe(true);
      expect(store.stoneSpeed).toBe("normal");
      expect(store.textSize).toBe("normal");
    });

    it("空のオブジェクトでもデフォルト値が適用される", () => {
      localStorageMock.setItem("holorenju_preferences", JSON.stringify({}));
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.animationEnabled).toBe(true);
      expect(store.stoneSpeed).toBe("normal");
      expect(store.textSize).toBe("normal");
    });
  });

  describe("設定変更", () => {
    it("animationEnabledを変更できる", () => {
      const store = usePreferencesStore();

      store.animationEnabled = false;

      expect(store.animationEnabled).toBe(false);
    });

    it("stoneSpeedを変更できる", () => {
      const store = usePreferencesStore();

      store.stoneSpeed = "slow";

      expect(store.stoneSpeed).toBe("slow");
    });

    it("textSizeを変更できる", () => {
      const store = usePreferencesStore();

      store.textSize = "large";

      expect(store.textSize).toBe("large");
    });

    it("変更時に自動保存される", async () => {
      const store = usePreferencesStore();

      store.animationEnabled = false;

      // watchは非同期なのでnextTickを待つ
      await vi.waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          "holorenju_preferences",
          expect.any(String),
        );
      });

      const { calls } = localStorageMock.setItem.mock;
      const savedData = JSON.parse(calls[calls.length - 1]?.[1] ?? "{}");
      expect(savedData.animation.enabled).toBe(false);
    });
  });

  describe("アニメーション時間計算", () => {
    describe("stoneAnimationDuration", () => {
      it("slowで0.4", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "slow";

        expect(store.stoneAnimationDuration).toBe(0.4);
      });

      it("normalで0.2", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "normal";

        expect(store.stoneAnimationDuration).toBe(0.2);
      });

      it("fastで0.1", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "fast";

        expect(store.stoneAnimationDuration).toBe(0.1);
      });

      it("animation無効時は0", () => {
        const store = usePreferencesStore();
        store.animationEnabled = false;

        expect(store.stoneAnimationDuration).toBe(0);
      });
    });

    describe("markAnimationDuration", () => {
      it("slowで0.5", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "slow";

        expect(store.markAnimationDuration).toBe(0.5);
      });

      it("normalで0.25", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "normal";

        expect(store.markAnimationDuration).toBe(0.25);
      });

      it("fastで0.125", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "fast";

        expect(store.markAnimationDuration).toBe(0.125);
      });

      it("animation無効時は0", () => {
        const store = usePreferencesStore();
        store.animationEnabled = false;

        expect(store.markAnimationDuration).toBe(0);
      });
    });

    describe("lineAnimationDuration", () => {
      it("slowで0.4", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "slow";

        expect(store.lineAnimationDuration).toBe(0.4);
      });

      it("normalで0.2", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "normal";

        expect(store.lineAnimationDuration).toBe(0.2);
      });

      it("fastで0.1", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.stoneSpeed = "fast";

        expect(store.lineAnimationDuration).toBe(0.1);
      });

      it("animation無効時は0", () => {
        const store = usePreferencesStore();
        store.animationEnabled = false;

        expect(store.lineAnimationDuration).toBe(0);
      });
    });
  });

  describe("preferencesオブジェクト全体", () => {
    it("preferencesオブジェクトに直接アクセスできる", () => {
      const store = usePreferencesStore();
      // 明示的にデフォルト値に設定
      store.animationEnabled = true;
      store.stoneSpeed = "normal";
      store.textSize = "normal";

      expect(store.preferences).toEqual({
        animation: {
          enabled: true,
          stoneSpeed: "normal",
        },
        display: {
          textSize: "normal",
        },
      });
    });
  });
});
