import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { shallowRef, ref, type ShallowRef } from "vue";

import type FullscreenPrompt from "@/components/common/FullscreenPrompt.vue";

import { useFullscreenPrompt } from "./useFullscreenPrompt";

type PromptRef = ShallowRef<InstanceType<typeof FullscreenPrompt> | null>;

// localStorageモック
const createLocalStorageMock = (): Storage & {
  store: Record<string, string>;
} => {
  const store: Record<string, string> = {};
  return {
    store,
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete store[key];
      });
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
};

// useMediaQueryモック
const mockIsMobileByMedia = ref(false);
vi.mock("@vueuse/core", () => ({
  useMediaQuery: vi.fn(() => mockIsMobileByMedia),
}));

describe("useFullscreenPrompt", () => {
  // eslint-disable-next-line init-declarations
  let localStorageMock: ReturnType<typeof createLocalStorageMock>;
  // eslint-disable-next-line init-declarations
  let mockPromptRef: PromptRef;

  beforeEach(() => {
    localStorageMock = createLocalStorageMock();
    vi.stubGlobal("localStorage", localStorageMock);

    mockIsMobileByMedia.value = false;

    // PWA判定のmatchMediaモック（デフォルト: 非PWA）
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      })),
    );

    mockPromptRef = shallowRef({
      showModal: vi.fn(),
    }) as unknown as PromptRef;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("isMobile", () => {
    it("タッチポイントありでtrue", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
      mockIsMobileByMedia.value = false;

      const { isMobile } = useFullscreenPrompt(mockPromptRef);

      expect(isMobile.value).toBe(true);
    });

    it("hover: noneメディアクエリでtrue", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 0,
        configurable: true,
      });
      mockIsMobileByMedia.value = true;

      const { isMobile } = useFullscreenPrompt(mockPromptRef);

      expect(isMobile.value).toBe(true);
    });

    it("デスクトップでfalse", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 0,
        configurable: true,
      });
      mockIsMobileByMedia.value = false;

      const { isMobile } = useFullscreenPrompt(mockPromptRef);

      expect(isMobile.value).toBe(false);
    });
  });

  describe("isPromptDisabled", () => {
    it("localStorageにフラグがなければfalse", () => {
      const { isPromptDisabled } = useFullscreenPrompt(mockPromptRef);

      expect(isPromptDisabled()).toBe(false);
    });

    it("localStorageにフラグがあればtrue", () => {
      localStorageMock.store["holorenju-fullscreen-prompt-disabled"] = "true";

      const { isPromptDisabled } = useFullscreenPrompt(mockPromptRef);

      expect(isPromptDisabled()).toBe(true);
    });
  });

  describe("showFullscreenPrompt", () => {
    it("モバイルで未dismissならshowModalが呼ばれる", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
      mockIsMobileByMedia.value = true;

      const { showFullscreenPrompt } = useFullscreenPrompt(mockPromptRef);
      showFullscreenPrompt();

      expect(mockPromptRef.value?.showModal).toHaveBeenCalled();
    });

    it("dismiss済みならshowModalは呼ばれない", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
      mockIsMobileByMedia.value = true;
      localStorageMock.store["holorenju-fullscreen-prompt-disabled"] = "true";

      const { showFullscreenPrompt } = useFullscreenPrompt(mockPromptRef);
      showFullscreenPrompt();

      expect(mockPromptRef.value?.showModal).not.toHaveBeenCalled();
    });

    it("デスクトップならshowModalは呼ばれない", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 0,
        configurable: true,
      });
      mockIsMobileByMedia.value = false;

      const { showFullscreenPrompt } = useFullscreenPrompt(mockPromptRef);
      showFullscreenPrompt();

      expect(mockPromptRef.value?.showModal).not.toHaveBeenCalled();
    });

    it("PWA起動時かつ真のfullscreenならshowModalが呼ばれない", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
      mockIsMobileByMedia.value = true;

      // PWAモード（display-mode: fullscreen）をシミュレート
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query.includes("display-mode"),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
          onchange: null,
        })),
      );

      // document.fullscreenElement が truthy
      vi.stubGlobal("document", { fullscreenElement: {} });

      const { showFullscreenPrompt } = useFullscreenPrompt(mockPromptRef);
      showFullscreenPrompt();

      expect(mockPromptRef.value?.showModal).not.toHaveBeenCalled();
    });

    it("PWA起動時かつ非fullscreenならshowModalが呼ばれる", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
      mockIsMobileByMedia.value = true;

      // PWAモード（display-mode: fullscreen）をシミュレート
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query.includes("display-mode"),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
          onchange: null,
        })),
      );

      // document.fullscreenElement が null（ステータスバーが見えている）
      vi.stubGlobal("document", { fullscreenElement: null });

      const { showFullscreenPrompt } = useFullscreenPrompt(mockPromptRef);
      showFullscreenPrompt();

      expect(mockPromptRef.value?.showModal).toHaveBeenCalled();
    });

    it("promptRefがnullの場合は何もしない", () => {
      Object.defineProperty(navigator, "maxTouchPoints", {
        value: 5,
        configurable: true,
      });
      mockIsMobileByMedia.value = true;
      const nullRef = shallowRef(null) as unknown as PromptRef;

      const { showFullscreenPrompt } = useFullscreenPrompt(nullRef);

      // エラーなく呼び出せることを確認
      expect(() => showFullscreenPrompt()).not.toThrow();
    });
  });

  describe("isPWA", () => {
    it("PWAモードならtrue", () => {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query.includes("display-mode"),
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
          onchange: null,
        })),
      );

      const { isPWA } = useFullscreenPrompt(mockPromptRef);
      expect(isPWA).toBe(true);
    });

    it("非PWAモードならfalse", () => {
      const { isPWA } = useFullscreenPrompt(mockPromptRef);
      expect(isPWA).toBe(false);
    });
  });

  describe("handleNeverShow", () => {
    it("localStorageに保存される", () => {
      const { handleNeverShow } = useFullscreenPrompt(mockPromptRef);

      handleNeverShow();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        "holorenju-fullscreen-prompt-disabled",
        "true",
      );
    });

    it("handleNeverShow後はisPromptDisabledがtrue", () => {
      const { handleNeverShow, isPromptDisabled } =
        useFullscreenPrompt(mockPromptRef);

      expect(isPromptDisabled()).toBe(false);
      handleNeverShow();
      expect(isPromptDisabled()).toBe(true);
    });
  });
});
