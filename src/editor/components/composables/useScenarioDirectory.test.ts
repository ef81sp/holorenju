import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { Scenario } from "@/types/scenario";

import { useScenarioDirectory } from "./useScenarioDirectory";

// editorStoreモック
const mockScenario: Scenario = {
  id: "test-scenario",
  title: "Test Scenario",
  difficulty: "gomoku_beginner",
  description: "Test description",
  objectives: ["Objective 1"],
  sections: [],
};
const mockLoadScenario = vi.fn();
const mockSetValidationErrors = vi.fn();
const mockClearValidationErrors = vi.fn();
const mockMarkClean = vi.fn();

vi.mock("@/editor/stores/editorStore", () => ({
  useEditorStore: () => ({
    get scenario() {
      return mockScenario;
    },
    loadScenario: mockLoadScenario,
    setValidationErrors: mockSetValidationErrors,
    clearValidationErrors: mockClearValidationErrors,
    markClean: mockMarkClean,
  }),
}));

// directionHandleStorageモック
const mockSaveDirectoryHandle = vi.fn().mockResolvedValue(undefined);
const mockLoadDirectoryHandle = vi.fn().mockResolvedValue(null);

vi.mock("@/editor/logic/directionHandleStorage", () => ({
  saveDirectoryHandle: (...args: unknown[]) => mockSaveDirectoryHandle(...args),
  loadDirectoryHandle: () => mockLoadDirectoryHandle(),
}));

// scenarioFileHandlerモック
const mockValidationResult = {
  isValid: true,
  errors: [] as { type: string; path: string; message: string }[],
};

vi.mock("@/logic/scenarioFileHandler", () => ({
  validateScenarioCompletely: vi.fn(() => mockValidationResult),
  scenarioToJSON: vi.fn(() => JSON.stringify(mockScenario, null, 2)),
}));

// scenarioParserモック
vi.mock("@/logic/scenarioParser", () => ({
  parseScenario: vi.fn((data: unknown) => data as Scenario),
}));

describe("useScenarioDirectory", () => {
  // モック用ファイル/ディレクトリハンドル
  // eslint-disable-next-line init-declarations
  let mockWritable: {
    write: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line init-declarations
  let mockFileHandle: {
    getFile: ReturnType<typeof vi.fn>;
    createWritable: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line init-declarations
  let mockSubDirHandle: {
    getFileHandle: ReturnType<typeof vi.fn>;
    entries: ReturnType<typeof vi.fn>;
  };
  // eslint-disable-next-line init-declarations
  let mockDirHandle: {
    name: string;
    getDirectoryHandle: ReturnType<typeof vi.fn>;
    getFileHandle: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockValidationResult.isValid = true;
    mockValidationResult.errors = [];

    mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockFileHandle = {
      getFile: vi.fn().mockResolvedValue({
        text: vi.fn().mockResolvedValue(JSON.stringify(mockScenario)),
      }),
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };

    mockSubDirHandle = {
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      entries: vi.fn().mockReturnValue({
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator]() {
          yield ["scenario.json", { kind: "file", ...mockFileHandle }];
        },
      }),
    };

    mockDirHandle = {
      name: "scenarios",
      getDirectoryHandle: vi.fn().mockResolvedValue(mockSubDirHandle),
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
    };

    mockLoadDirectoryHandle.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("scenarioDirはnull", () => {
      const { scenarioDir } = useScenarioDirectory();

      expect(scenarioDir.value).toBeNull();
    });
  });

  describe("handleSelectDirectory", () => {
    it("showDirectoryPickerが呼ばれる", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory } = useScenarioDirectory();

      await handleSelectDirectory();

      expect(mockShowDirectoryPicker).toHaveBeenCalled();
    });

    it("選択されたハンドルがscenarioDirに設定される", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, scenarioDir } = useScenarioDirectory();

      await handleSelectDirectory();

      expect(scenarioDir.value).toStrictEqual(mockDirHandle);
    });

    it("ハンドルがIndexedDBに保存される", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory } = useScenarioDirectory();

      await handleSelectDirectory();

      expect(mockSaveDirectoryHandle).toHaveBeenCalledWith(mockDirHandle);
    });

    it("APIがサポートされていない場合は何もしない", async () => {
      vi.stubGlobal("window", {});

      const { handleSelectDirectory, scenarioDir } = useScenarioDirectory();

      await handleSelectDirectory();

      expect(scenarioDir.value).toBeNull();
    });

    it("AbortErrorでInterceptedの場合はPlaywright環境として無視", async () => {
      const abortError = new DOMException("Intercepted", "AbortError");
      const mockShowDirectoryPicker = vi.fn().mockRejectedValue(abortError);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, scenarioDir } = useScenarioDirectory();

      await handleSelectDirectory();

      expect(scenarioDir.value).toBeNull();
    });
  });

  describe("restoreDirectoryHandle", () => {
    it("IndexedDBからハンドルを復元する", async () => {
      mockLoadDirectoryHandle.mockResolvedValue(mockDirHandle);

      const { restoreDirectoryHandle, scenarioDir } = useScenarioDirectory();

      await restoreDirectoryHandle();

      expect(scenarioDir.value).toStrictEqual(mockDirHandle);
    });

    it("復元失敗時はnullのまま", async () => {
      mockLoadDirectoryHandle.mockRejectedValue(new Error("Failed"));

      const { restoreDirectoryHandle, scenarioDir } = useScenarioDirectory();

      await restoreDirectoryHandle();

      expect(scenarioDir.value).toBeNull();
    });

    it("保存されたハンドルがない場合はnullのまま", async () => {
      mockLoadDirectoryHandle.mockResolvedValue(null);

      const { restoreDirectoryHandle, scenarioDir } = useScenarioDirectory();

      await restoreDirectoryHandle();

      expect(scenarioDir.value).toBeNull();
    });
  });

  describe("handleSaveToDirectory", () => {
    it("ディレクトリ未選択時は警告", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");

      const { handleSaveToDirectory } = useScenarioDirectory();

      await handleSaveToDirectory();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "先にディレクトリを選択してください",
      );
    });

    it("getDirectoryHandleが呼ばれる", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, handleSaveToDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleSaveToDirectory();

      expect(mockDirHandle.getDirectoryHandle).toHaveBeenCalledWith(
        "gomoku_beginner",
        { create: true },
      );
    });

    it("getFileHandleが呼ばれる", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, handleSaveToDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleSaveToDirectory();

      expect(mockSubDirHandle.getFileHandle).toHaveBeenCalledWith(
        "test-scenario.json",
        { create: true },
      );
    });

    it("writeとcloseが呼ばれる", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, handleSaveToDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleSaveToDirectory();

      expect(mockWritable.write).toHaveBeenCalled();
      expect(mockWritable.close).toHaveBeenCalled();
    });

    it("markCleanが呼ばれる", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, handleSaveToDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleSaveToDirectory();

      expect(mockMarkClean).toHaveBeenCalled();
    });

    it("バリデーション失敗でエラーが設定される", async () => {
      mockValidationResult.isValid = false;
      mockValidationResult.errors = [
        { type: "validation", path: "title", message: "Required" },
      ];

      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });
      vi.stubGlobal("alert", vi.fn());

      const { handleSelectDirectory, handleSaveToDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleSaveToDirectory();

      expect(mockSetValidationErrors).toHaveBeenCalled();
      expect(mockWritable.write).not.toHaveBeenCalled();
    });
  });

  describe("handleLoadFromDirectory", () => {
    it("ディレクトリ未選択時は警告", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");

      const { handleLoadFromDirectory } = useScenarioDirectory();

      await handleLoadFromDirectory();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "先にディレクトリを選択してください",
      );
    });

    it("難易度ディレクトリのJSONファイルを読み込む", async () => {
      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, handleLoadFromDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleLoadFromDirectory();

      expect(mockLoadScenario).toHaveBeenCalled();
    });

    it("難易度ディレクトリが見つからない場合は警告", async () => {
      mockDirHandle.getDirectoryHandle = vi
        .fn()
        .mockRejectedValue(new Error("Not found"));

      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const consoleWarnSpy = vi.spyOn(console, "warn");
      const { handleSelectDirectory, handleLoadFromDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleLoadFromDirectory();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("難易度ディレクトリ"),
      );
    });

    it("バリデーション失敗でエラーが設定される", async () => {
      mockValidationResult.isValid = false;
      mockValidationResult.errors = [
        { type: "validation", path: "id", message: "Invalid" },
      ];

      const mockShowDirectoryPicker = vi.fn().mockResolvedValue(mockDirHandle);
      vi.stubGlobal("window", { showDirectoryPicker: mockShowDirectoryPicker });

      const { handleSelectDirectory, handleLoadFromDirectory } =
        useScenarioDirectory();

      await handleSelectDirectory();
      await handleLoadFromDirectory();

      expect(mockSetValidationErrors).toHaveBeenCalled();
      expect(mockLoadScenario).not.toHaveBeenCalled();
    });
  });
});
