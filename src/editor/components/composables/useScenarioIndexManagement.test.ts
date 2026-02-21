import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { useScenarioIndexManagement } from "./useScenarioIndexManagement";

// indexFileHandlerモック
const mockRegenerateScenarioIndexWithOrder = vi
  .fn()
  .mockResolvedValue(undefined);

vi.mock("@/editor/logic/indexFileHandler", () => ({
  DIFFICULTY_LABELS: {
    gomoku_beginner: "五目並べ：初級",
    gomoku_intermediate: "五目並べ：中級",
    gomoku_advanced: "五目並べ：上級",
    renju_beginner: "連珠：初級",
    renju_intermediate: "連珠：中級",
    renju_advanced: "連珠：上級",
  },
  regenerateScenarioIndexWithOrder: (...args: unknown[]) =>
    mockRegenerateScenarioIndexWithOrder(...args),
}));

// nextTickモック
vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    nextTick: vi.fn().mockResolvedValue(undefined),
  };
});

describe("useScenarioIndexManagement", () => {
  // eslint-disable-next-line init-declarations
  let mockFileHandle: {
    getFile: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line init-declarations
  let mockDirHandle: {
    getFileHandle: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line init-declarations
  let mockDialogRef: {
    showModal: () => void;
  };

  interface ScenarioEntry {
    id: string;
    title: string;
    description: string;
    path: string;
  }
  const sampleIndexData = {
    difficulties: {
      gomoku_beginner: {
        label: "五目並べ：初級",
        scenarios: [
          {
            id: "s1",
            title: "シナリオ1",
            description: "",
            path: "gomoku_beginner/s1.json",
          },
        ],
      },
      gomoku_intermediate: {
        label: "五目並べ：中級",
        scenarios: [] as ScenarioEntry[],
      },
      gomoku_advanced: {
        label: "五目並べ：上級",
        scenarios: [] as ScenarioEntry[],
      },
      renju_beginner: { label: "連珠：初級", scenarios: [] as ScenarioEntry[] },
      renju_intermediate: {
        label: "連珠：中級",
        scenarios: [] as ScenarioEntry[],
      },
      renju_advanced: { label: "連珠：上級", scenarios: [] as ScenarioEntry[] },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockFileHandle = {
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(sampleIndexData)),
      }),
    };

    mockDirHandle = {
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
    };

    mockDialogRef = {
      showModal: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("currentIndexDataはnull", () => {
      const { currentIndexData } = useScenarioIndexManagement();

      expect(currentIndexData.value).toBeNull();
    });
  });

  describe("handleGenerateIndex", () => {
    it("index.jsonの読み込みを試みる", async () => {
      const { handleGenerateIndex } = useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      expect(mockDirHandle.getFileHandle).toHaveBeenCalledWith("index.json", {
        create: false,
      });
    });

    it("index.json読み込み後にcurrentIndexDataが設定される", async () => {
      const { handleGenerateIndex, currentIndexData } =
        useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      expect(currentIndexData.value).not.toBeNull();
      expect(
        currentIndexData.value?.difficulties.gomoku_beginner.scenarios,
      ).toHaveLength(1);
    });

    it("index.jsonが存在しない場合は空のIndexDataを使用", async () => {
      mockDirHandle.getFileHandle = vi
        .fn()
        .mockRejectedValue(new Error("Not found"));

      const { handleGenerateIndex, currentIndexData } =
        useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      expect(currentIndexData.value).not.toBeNull();
      expect(
        currentIndexData.value?.difficulties.gomoku_beginner.scenarios,
      ).toHaveLength(0);
    });

    it("ダイアログのshowModalが呼ばれる", async () => {
      const { handleGenerateIndex } = useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      expect(mockDialogRef.showModal).toHaveBeenCalled();
    });

    it("dialogRefがnullでもエラーにならない", async () => {
      const { handleGenerateIndex } = useScenarioIndexManagement();

      await expect(
        handleGenerateIndex(
          mockDirHandle as unknown as FileSystemDirectoryHandle,
          null,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("handleReorderConfirm", () => {
    it("scenarioDirがnullの場合はエラー", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");

      const { handleReorderConfirm } = useScenarioIndexManagement();

      await handleReorderConfirm({}, null);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Invalid state");
    });

    it("currentIndexDataがnullの場合はエラー", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");

      const { handleReorderConfirm } = useScenarioIndexManagement();

      await handleReorderConfirm(
        {},
        mockDirHandle as unknown as FileSystemDirectoryHandle,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith("Invalid state");
    });

    it("regenerateScenarioIndexWithOrderが呼ばれる", async () => {
      const { handleGenerateIndex, handleReorderConfirm, currentIndexData } =
        useScenarioIndexManagement();

      // まずindex.jsonを読み込む
      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      const reorderedData = { gomoku_beginner: ["s1"] };

      await handleReorderConfirm(
        reorderedData,
        mockDirHandle as unknown as FileSystemDirectoryHandle,
      );

      expect(mockRegenerateScenarioIndexWithOrder).toHaveBeenCalledWith(
        mockDirHandle,
        currentIndexData.value,
        reorderedData,
      );
    });

    it("エラー時はconsole.errorが呼ばれる", async () => {
      mockRegenerateScenarioIndexWithOrder.mockRejectedValue(
        new Error("Failed"),
      );

      const consoleErrorSpy = vi.spyOn(console, "error");
      const { handleGenerateIndex, handleReorderConfirm } =
        useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      await handleReorderConfirm(
        {},
        mockDirHandle as unknown as FileSystemDirectoryHandle,
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("index.json の生成に失敗しました"),
        expect.any(Error),
      );
    });
  });

  describe("mergeIndexData内部ロジック", () => {
    it("部分的なdifficultyデータがマージされる", async () => {
      // labelがないデータ
      const partialIndexData = {
        difficulties: {
          gomoku_beginner: {
            scenarios: [
              {
                id: "s1",
                title: "シナリオ1",
                description: "",
                path: "gomoku_beginner/s1.json",
              },
            ],
          },
        },
      };

      mockFileHandle.getFile = vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(partialIndexData)),
      });

      const { handleGenerateIndex, currentIndexData } =
        useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      // labelがDIFFICULTY_LABELSから補完される
      expect(currentIndexData.value?.difficulties.gomoku_beginner.label).toBe(
        "五目並べ：初級",
      );
      // scenariosは保持される
      expect(
        currentIndexData.value?.difficulties.gomoku_beginner.scenarios,
      ).toHaveLength(1);
    });

    it("空の難易度も初期化される", async () => {
      const { handleGenerateIndex, currentIndexData } =
        useScenarioIndexManagement();

      await handleGenerateIndex(
        mockDirHandle as unknown as FileSystemDirectoryHandle,
        mockDialogRef,
      );

      // 全難易度が存在する
      expect(currentIndexData.value?.difficulties.renju_advanced).toBeDefined();
      expect(
        currentIndexData.value?.difficulties.renju_advanced.scenarios,
      ).toEqual([]);
    });
  });
});
