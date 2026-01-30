import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { Scenario } from "@/types/scenario";

import { useScenarioFileOperations } from "./useScenarioFileOperations";

// editorStoreモック
const mockLoadScenario = vi.fn();
const mockSetValidationErrors = vi.fn();
const mockClearValidationErrors = vi.fn();
const mockClearCurrentFileHandle = vi.fn();
const mockSetCurrentFileHandle = vi.fn();
const mockClearOriginalDifficulty = vi.fn();

vi.mock("@/editor/stores/editorStore", () => ({
  useEditorStore: () => ({
    loadScenario: mockLoadScenario,
    setValidationErrors: mockSetValidationErrors,
    clearValidationErrors: mockClearValidationErrors,
    clearCurrentFileHandle: mockClearCurrentFileHandle,
    setCurrentFileHandle: mockSetCurrentFileHandle,
    clearOriginalDifficulty: mockClearOriginalDifficulty,
    currentFileHandle: null as FileSystemFileHandle | null,
  }),
}));

// scenarioFileHandlerモック
const mockValidationResult = {
  isValid: true,
  errors: [] as { type: string; path: string; message: string }[],
};
const mockEmptyScenario: Scenario = {
  id: "new-scenario",
  title: "新しいシナリオ",
  difficulty: "gomoku_beginner",
  description: "",
  objectives: [],
  sections: [],
};

vi.mock("@/logic/scenarioFileHandler", () => ({
  validateScenarioCompletely: vi.fn(() => mockValidationResult),
  scenarioToJSON: vi.fn(() => JSON.stringify(mockEmptyScenario, null, 2)),
  createEmptyScenario: vi.fn(() => mockEmptyScenario),
}));

// scenarioParserモック
vi.mock("@/logic/scenarioParser", () => ({
  parseScenario: vi.fn((data: unknown) => data as Scenario),
}));

// FileReaderモッククラスを作成するヘルパー
function createMockFileReaderClass(fileContent: string): typeof FileReader {
  return class MockFileReader {
    result: string | ArrayBuffer | null = null;
    // eslint-disable-next-line init-declarations
    onload: ((event: ProgressEvent<FileReader>) => void) | null;
    // eslint-disable-next-line init-declarations
    onerror: ((event: ProgressEvent<FileReader>) => void) | null;

    constructor() {
      this.onload = null;
      this.onerror = null;
    }

    readAsText(): void {
      this.result = fileContent;
      setTimeout(() => {
        this.onload?.({
          target: { result: fileContent },
        } as unknown as ProgressEvent<FileReader>);
      }, 0);
    }
  } as unknown as typeof FileReader;
}

describe("useScenarioFileOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockValidationResult.isValid = true;
    mockValidationResult.errors = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("selectedFileはnull", () => {
      const { selectedFile } = useScenarioFileOperations();

      expect(selectedFile.value).toBeNull();
    });

    it("jsonInputは空文字", () => {
      const { jsonInput } = useScenarioFileOperations();

      expect(jsonInput.value).toBe("");
    });

    it("showJsonInputはfalse", () => {
      const { showJsonInput } = useScenarioFileOperations();

      expect(showJsonInput.value).toBe(false);
    });
  });

  describe("handleFileSelect", () => {
    it("有効なJSONファイルを読み込む", async () => {
      const validScenario: Scenario = {
        id: "test",
        title: "Test",
        difficulty: "gomoku_beginner",
        description: "",
        objectives: [],
        sections: [],
      };
      const fileContent = JSON.stringify(validScenario);
      const file = new File([fileContent], "test.json", {
        type: "application/json",
      });

      vi.stubGlobal("FileReader", createMockFileReaderClass(fileContent));

      const { handleFileSelect, selectedFile } = useScenarioFileOperations();

      const event = {
        target: { files: [file] },
      } as unknown as Event;

      handleFileSelect(event);

      // FileReaderの非同期処理を待つ
      await vi.waitFor(() => {
        expect(mockLoadScenario).toHaveBeenCalled();
      });

      expect(selectedFile.value).toBe(file);
    });

    it("ファイルが選択されていない場合は何もしない", () => {
      const { handleFileSelect } = useScenarioFileOperations();

      const event = {
        target: { files: [] },
      } as unknown as Event;

      handleFileSelect(event);

      expect(mockLoadScenario).not.toHaveBeenCalled();
    });

    it("無効なJSONでエラーが処理される", async () => {
      const fileContent = "invalid json {{{";
      const file = new File([fileContent], "test.json", {
        type: "application/json",
      });

      vi.stubGlobal("FileReader", createMockFileReaderClass(fileContent));

      const { handleFileSelect } = useScenarioFileOperations();

      const event = {
        target: { files: [file] },
      } as unknown as Event;

      handleFileSelect(event);

      await vi.waitFor(() => {
        // JSON.parseでエラーが発生するはず
        expect(mockLoadScenario).not.toHaveBeenCalled();
      });
    });

    it("バリデーション失敗でエラーが設定される", async () => {
      mockValidationResult.isValid = false;
      mockValidationResult.errors = [
        { type: "parse", path: "root", message: "Invalid structure" },
      ];

      const validJson = JSON.stringify({ id: "test" });
      const file = new File([validJson], "test.json", {
        type: "application/json",
      });

      vi.stubGlobal("FileReader", createMockFileReaderClass(validJson));

      const { handleFileSelect } = useScenarioFileOperations();

      const event = {
        target: { files: [file] },
      } as unknown as Event;

      handleFileSelect(event);

      await vi.waitFor(() => {
        expect(mockSetValidationErrors).toHaveBeenCalledWith([
          { path: "root", message: "Invalid structure" },
        ]);
      });
    });
  });

  describe("handleCreateNew", () => {
    it("空のシナリオが作成される", () => {
      const { handleCreateNew } = useScenarioFileOperations();

      handleCreateNew();

      expect(mockLoadScenario).toHaveBeenCalledWith(mockEmptyScenario);
    });

    it("バリデーションエラーがクリアされる", () => {
      const { handleCreateNew } = useScenarioFileOperations();

      handleCreateNew();

      expect(mockClearValidationErrors).toHaveBeenCalled();
    });

    it("selectedFileがnullになる", () => {
      const { handleCreateNew, selectedFile } = useScenarioFileOperations();

      handleCreateNew();

      expect(selectedFile.value).toBeNull();
    });

    it("showJsonInputがfalseになる", () => {
      const { handleCreateNew, showJsonInput } = useScenarioFileOperations();

      handleCreateNew();

      expect(showJsonInput.value).toBe(false);
    });

    it("jsonInputが更新される", () => {
      const { handleCreateNew, jsonInput } = useScenarioFileOperations();

      handleCreateNew();

      expect(jsonInput.value).toBe(JSON.stringify(mockEmptyScenario, null, 2));
    });
  });
});
