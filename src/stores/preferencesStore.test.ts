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

    it("animation.speedがnormal", () => {
      const store = usePreferencesStore();
      expect(store.speed).toBe("normal");
    });

    it("animation.effectSpeedがnormal", () => {
      const store = usePreferencesStore();
      expect(store.effectSpeed).toBe("normal");
    });

    it("display.textSizeがnormal", () => {
      const store = usePreferencesStore();
      expect(store.textSize).toBe("normal");
    });
  });

  describe("localStorage読み込み", () => {
    it("新形式の保存データを復元する", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: false, speed: "fast", effectSpeed: "slow" },
          display: { textSize: "large" },
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.animationEnabled).toBe(false);
      expect(store.speed).toBe("fast");
      expect(store.effectSpeed).toBe("slow");
      expect(store.textSize).toBe("large");
    });

    it("部分的なデータでもデフォルト値とマージする", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: false },
          // speed, effectSpeed, displayは未定義
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.animationEnabled).toBe(false);
      expect(store.speed).toBe("normal"); // デフォルト値
      expect(store.effectSpeed).toBe("normal"); // デフォルト値
      expect(store.textSize).toBe("normal"); // デフォルト値
    });

    it("不正なJSONでもクラッシュしない", () => {
      localStorageMock.setItem("holorenju_preferences", "invalid json");
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      // デフォルト値が使用される
      expect(store.animationEnabled).toBe(true);
      expect(store.speed).toBe("normal");
      expect(store.effectSpeed).toBe("normal");
      expect(store.textSize).toBe("normal");
    });

    it("空のオブジェクトでもデフォルト値が適用される", () => {
      localStorageMock.setItem("holorenju_preferences", JSON.stringify({}));
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.animationEnabled).toBe(true);
      expect(store.speed).toBe("normal");
      expect(store.effectSpeed).toBe("normal");
      expect(store.textSize).toBe("normal");
    });
  });

  describe("旧形式からのマイグレーション", () => {
    it("旧stoneSpeed=slow → speed=normal, effectSpeed=normal", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: true, stoneSpeed: "slow" },
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.speed).toBe("normal");
      expect(store.effectSpeed).toBe("normal");
    });

    it("旧stoneSpeed=normal → speed=fast, effectSpeed=fast", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: true, stoneSpeed: "normal" },
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.speed).toBe("fast");
      expect(store.effectSpeed).toBe("fast");
    });

    it("旧stoneSpeed=fast → speed=fastest, effectSpeed=fastest", () => {
      localStorageMock.setItem(
        "holorenju_preferences",
        JSON.stringify({
          animation: { enabled: true, stoneSpeed: "fast" },
        }),
      );
      setActivePinia(createPinia());

      const store = usePreferencesStore();

      expect(store.speed).toBe("fastest");
      expect(store.effectSpeed).toBe("fastest");
    });
  });

  describe("設定変更", () => {
    it("animationEnabledを変更できる", () => {
      const store = usePreferencesStore();

      store.animationEnabled = false;

      expect(store.animationEnabled).toBe(false);
    });

    it("speedを変更できる", () => {
      const store = usePreferencesStore();

      store.speed = "slow";

      expect(store.speed).toBe("slow");
    });

    it("effectSpeedを変更できる", () => {
      const store = usePreferencesStore();

      store.effectSpeed = "fastest";

      expect(store.effectSpeed).toBe("fastest");
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
      it("slowest (x2.0)で0.8", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "slowest";

        expect(store.stoneAnimationDuration).toBe(0.8);
      });

      it("slow (x1.5)で0.6", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "slow";

        expect(store.stoneAnimationDuration).toBeCloseTo(0.6);
      });

      it("normal (x1.0)で0.4", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "normal";

        expect(store.stoneAnimationDuration).toBe(0.4);
      });

      it("fast (x0.5)で0.2", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "fast";

        expect(store.stoneAnimationDuration).toBe(0.2);
      });

      it("fastest (x0.25)で0.1", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "fastest";

        expect(store.stoneAnimationDuration).toBe(0.1);
      });

      it("animation無効時は0", () => {
        const store = usePreferencesStore();
        store.animationEnabled = false;

        expect(store.stoneAnimationDuration).toBe(0);
      });
    });

    describe("markAnimationDuration", () => {
      it("normal (x1.0)で0.5", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "normal";

        expect(store.markAnimationDuration).toBe(0.5);
      });

      it("fast (x0.5)で0.25", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "fast";

        expect(store.markAnimationDuration).toBe(0.25);
      });

      it("fastest (x0.25)で0.125", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "fastest";

        expect(store.markAnimationDuration).toBe(0.125);
      });

      it("animation無効時は0", () => {
        const store = usePreferencesStore();
        store.animationEnabled = false;

        expect(store.markAnimationDuration).toBe(0);
      });
    });

    describe("lineAnimationDuration", () => {
      it("normal (x1.0)で0.4", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "normal";

        expect(store.lineAnimationDuration).toBe(0.4);
      });

      it("fast (x0.5)で0.2", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "fast";

        expect(store.lineAnimationDuration).toBe(0.2);
      });

      it("fastest (x0.25)で0.1", () => {
        const store = usePreferencesStore();
        store.animationEnabled = true;
        store.speed = "fastest";

        expect(store.lineAnimationDuration).toBe(0.1);
      });

      it("animation無効時は0", () => {
        const store = usePreferencesStore();
        store.animationEnabled = false;

        expect(store.lineAnimationDuration).toBe(0);
      });
    });
  });

  describe("演出時間計算", () => {
    describe("characterAnimationDuration", () => {
      it("normal (x1.0)で0.3", () => {
        const store = usePreferencesStore();
        store.effectSpeed = "normal";

        expect(store.characterAnimationDuration).toBe(0.3);
      });

      it("slow (x1.5)で0.45", () => {
        const store = usePreferencesStore();
        store.effectSpeed = "slow";

        expect(store.characterAnimationDuration).toBeCloseTo(0.45);
      });

      it("fast (x0.5)で0.15", () => {
        const store = usePreferencesStore();
        store.effectSpeed = "fast";

        expect(store.characterAnimationDuration).toBe(0.15);
      });
    });

    describe("cutinDisplayDuration", () => {
      it("normal (x1.0)で0.8", () => {
        const store = usePreferencesStore();
        store.effectSpeed = "normal";

        expect(store.cutinDisplayDuration).toBe(0.8);
      });

      it("slowest (x2.0)で1.6", () => {
        const store = usePreferencesStore();
        store.effectSpeed = "slowest";

        expect(store.cutinDisplayDuration).toBe(1.6);
      });

      it("fastest (x0.25)で0.2", () => {
        const store = usePreferencesStore();
        store.effectSpeed = "fastest";

        expect(store.cutinDisplayDuration).toBe(0.2);
      });
    });
  });

  describe("preferencesオブジェクト全体", () => {
    it("preferencesオブジェクトに直接アクセスできる", () => {
      const store = usePreferencesStore();
      // 明示的にデフォルト値に設定
      store.animationEnabled = true;
      store.speed = "normal";
      store.effectSpeed = "normal";
      store.textSize = "normal";

      expect(store.preferences).toEqual({
        animation: {
          enabled: true,
          speed: "normal",
          effectSpeed: "normal",
        },
        display: {
          textSize: "normal",
        },
      });
    });
  });
});
