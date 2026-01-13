import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { Scenario } from "@/types/scenario";

import { useScenarioExport } from "./useScenarioExport";

// editorStoreモック
const mockScenario: Scenario = {
  id: "test-scenario",
  title: "Test Scenario",
  difficulty: "gomoku_beginner",
  description: "Test description",
  objectives: [],
  sections: [],
};

const mockSetValidationErrors = vi.fn();
const mockClearValidationErrors = vi.fn();
const mockLoadScenario = vi.fn();
const mockMarkClean = vi.fn();

vi.mock("@/editor/stores/editorStore", () => ({
  useEditorStore: () => ({
    scenario: mockScenario,
    setValidationErrors: mockSetValidationErrors,
    clearValidationErrors: mockClearValidationErrors,
    loadScenario: mockLoadScenario,
    markClean: mockMarkClean,
  }),
}));

// scenarioFileHandlerモック - vi.hoistedでホイスティング問題を回避
const { mockValidationResult, mockDownloadScenarioAsJSON } = vi.hoisted(() => ({
  mockValidationResult: { isValid: true, errors: [] as { type: string; path: string; message: string }[] },
  mockDownloadScenarioAsJSON: vi.fn(),
}));

vi.mock("@/logic/scenarioFileHandler", () => ({
  validateScenarioCompletely: vi.fn(() => mockValidationResult),
  downloadScenarioAsJSON: mockDownloadScenarioAsJSON,
  scenarioToJSON: vi.fn(() => JSON.stringify({ id: "test-scenario" }, null, 2)),
}));

describe("useScenarioExport", () => {
  // eslint-disable-next-line init-declarations
  let mockClipboard: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(JSON.stringify(mockScenario)),
    };

    Object.defineProperty(navigator, "clipboard", {
      value: mockClipboard,
      writable: true,
      configurable: true,
    });

    // バリデーション結果をリセット
    mockValidationResult.isValid = true;
    mockValidationResult.errors = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("handleSave", () => {
    it("バリデーション成功でダウンロードが実行される", () => {
      mockValidationResult.isValid = true;
      const { handleSave } = useScenarioExport();

      handleSave();

      expect(mockDownloadScenarioAsJSON).toHaveBeenCalledWith(mockScenario);
      expect(mockMarkClean).toHaveBeenCalled();
    });

    it("バリデーション失敗でエラーが設定される", () => {
      mockValidationResult.isValid = false;
      mockValidationResult.errors = [
        { type: "parse", path: "root", message: "Invalid JSON" },
      ];
      const { handleSave } = useScenarioExport();

      handleSave();

      expect(mockSetValidationErrors).toHaveBeenCalledWith([
        { path: "root", message: "Invalid JSON" },
      ]);
      expect(mockDownloadScenarioAsJSON).not.toHaveBeenCalled();
    });
  });

  describe("handleJsonCopy", () => {
    it("clipboardにJSONがコピーされる", async () => {
      const { handleJsonCopy } = useScenarioExport();

      handleJsonCopy();

      expect(mockClipboard.writeText).toHaveBeenCalled();
    });
  });

  describe("handleJsonPaste", () => {
    it("clipboardからJSONを読み込む", async () => {
      const { handleJsonPaste } = useScenarioExport();

      await handleJsonPaste();

      expect(mockClipboard.readText).toHaveBeenCalled();
    });

    it("パース成功でシナリオが設定される", async () => {
      mockValidationResult.isValid = true;
      const { handleJsonPaste } = useScenarioExport();

      await handleJsonPaste();

      expect(mockLoadScenario).toHaveBeenCalled();
      expect(mockClearValidationErrors).toHaveBeenCalled();
    });

    it("バリデーション失敗でエラーが表示される", async () => {
      mockValidationResult.isValid = false;
      mockValidationResult.errors = [
        { type: "parse", path: "title", message: "Title is required" },
      ];
      const { handleJsonPaste } = useScenarioExport();

      await handleJsonPaste();

      expect(mockSetValidationErrors).toHaveBeenCalledWith([
        { path: "title", message: "Title is required" },
      ]);
      expect(mockLoadScenario).not.toHaveBeenCalled();
    });

    it("不正なJSONでエラーが表示される", async () => {
      mockClipboard.readText.mockResolvedValue("invalid json {{{");
      const { handleJsonPaste } = useScenarioExport();

      await handleJsonPaste();

      expect(mockLoadScenario).not.toHaveBeenCalled();
    });

    it("clipboard読み込み失敗でエラーが処理される", async () => {
      mockClipboard.readText.mockRejectedValue(new Error("Permission denied"));
      const { handleJsonPaste } = useScenarioExport();

      // エラーなく完了することを確認
      await expect(handleJsonPaste()).resolves.not.toThrow();
    });
  });
});
