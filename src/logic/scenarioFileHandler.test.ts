import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { Scenario } from "@/types/scenario";

import {
  parseScenarioFromText,
  scenarioToJSON,
  validateScenarioCompletely,
  generateScenarioId,
  generateSectionId,
  generateDialogueId,
  createEmptyScenario,
  createEmptyDemoSection,
  createEmptyQuestionSection,
  boardToASCII,
  boardStringToArray,
  boardStringToBoardState,
  boardArrayToString,
  getBoardCell,
  setBoardCell,
  cycleBoardCell,
  downloadScenarioAsJSON,
} from "./scenarioFileHandler";

describe("scenarioFileHandler", () => {
  const validScenario: Scenario = {
    id: "test-scenario",
    title: "Test Scenario",
    difficulty: "gomoku_beginner",
    description: "A test scenario",
    objectives: ["Objective 1"],
    sections: [
      {
        id: "section-1",
        type: "demo",
        title: "Demo Section",
        initialBoard: Array(15).fill("-".repeat(15)),
        dialogues: [
          {
            id: "dialogue-1",
            character: "fubuki",
            emotion: 0,
            text: [{ type: "text", content: "テスト" }],
            boardActions: [],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseScenarioFromText", () => {
    it("有効なJSONをパースする", () => {
      const text = JSON.stringify(validScenario);

      const result = parseScenarioFromText(text);

      expect(result.id).toBe("test-scenario");
      expect(result.title).toBe("Test Scenario");
    });

    it("無効なJSONでエラー", () => {
      expect(() => parseScenarioFromText("invalid json")).toThrow();
    });

    it("空のJSONでエラー", () => {
      expect(() => parseScenarioFromText("{}")).toThrow();
    });
  });

  describe("scenarioToJSON", () => {
    it("シナリオをJSON文字列に変換", () => {
      const result = scenarioToJSON(validScenario);

      expect(typeof result).toBe("string");
      expect(JSON.parse(result)).toEqual(validScenario);
    });

    it("整形されたJSONを出力", () => {
      const result = scenarioToJSON(validScenario);

      // 改行が含まれている（整形されている）
      expect(result).toContain("\n");
      // インデント（2スペース）が含まれている
      expect(result).toContain("  ");
    });
  });

  describe("validateScenarioCompletely", () => {
    it("有効なシナリオでisValid=true", () => {
      const result = validateScenarioCompletely(validScenario);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("nullデータでエラー", () => {
      const result = validateScenarioCompletely(null);

      expect(result.isValid).toBe(false);
    });

    it("必須フィールド欠如でエラー", () => {
      const result = validateScenarioCompletely({ id: "test" });

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("不正な盤面でエラー", () => {
      const invalidScenario = {
        ...validScenario,
        sections: [
          {
            ...validScenario.sections[0],
            initialBoard: ["xxx"], // 不正な盤面
          },
        ],
      };

      const result = validateScenarioCompletely(invalidScenario);

      expect(result.isValid).toBe(false);
      // 盤面エラーはパース時にスローされるため parse エラーになる
      expect(result.errors.some((e) => e.type === "parse")).toBe(true);
      expect(result.errors[0].message).toContain("initialBoard");
    });
  });

  describe("ID生成", () => {
    describe("generateScenarioId", () => {
      it("ユニークIDを生成", () => {
        const id1 = generateScenarioId();
        const id2 = generateScenarioId();

        expect(id1).toMatch(/^scenario_/);
        expect(id1).not.toBe(id2);
      });

      it("scenario_プレフィックスを持つ", () => {
        const id = generateScenarioId();

        expect(id.startsWith("scenario_")).toBe(true);
      });
    });

    describe("generateSectionId", () => {
      it("連番IDを生成", () => {
        expect(generateSectionId([])).toBe("section_1");
        expect(generateSectionId([1])).toBe("section_2");
        expect(generateSectionId([1, 2, 3])).toBe("section_4");
      });
    });

    describe("generateDialogueId", () => {
      it("連番IDを生成", () => {
        expect(generateDialogueId([])).toBe("dialogue_1");
        expect(generateDialogueId([1])).toBe("dialogue_2");
        expect(generateDialogueId([1, 2, 3, 4, 5])).toBe("dialogue_6");
      });
    });
  });

  describe("ファクトリ関数", () => {
    describe("createEmptyScenario", () => {
      it("空シナリオを作成", () => {
        const scenario = createEmptyScenario();

        expect(scenario.id).toMatch(/^scenario_/);
        expect(scenario.title).toBe("新しいシナリオ");
        expect(scenario.sections).toEqual([]);
      });

      it("呼び出すたびに異なるIDを生成", () => {
        const s1 = createEmptyScenario();
        const s2 = createEmptyScenario();

        expect(s1.id).not.toBe(s2.id);
      });
    });

    describe("createEmptyDemoSection", () => {
      it("空デモセクションを作成", () => {
        const section = createEmptyDemoSection();

        expect(section.type).toBe("demo");
        expect(section.dialogues).toEqual([]);
        expect(section.initialBoard).toHaveLength(15);
      });
    });

    describe("createEmptyQuestionSection", () => {
      it("空問題セクションを作成", () => {
        const section = createEmptyQuestionSection();

        expect(section.type).toBe("question");
        expect(section.successConditions).toHaveLength(1);
        expect(section.feedback.success).toHaveLength(1);
        expect(section.feedback.failure).toHaveLength(1);
      });
    });
  });

  describe("盤面変換", () => {
    const testBoard = [
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "-------x-------",
      "------xox------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
      "---------------",
    ];

    describe("boardToASCII", () => {
      it("ASCII表示に変換", () => {
        const result = boardToASCII(testBoard);

        expect(result).toContain("●"); // 黒石
        expect(result).toContain("○"); // 白石
        expect(result).toContain("."); // 空マス
      });
    });

    describe("boardStringToArray", () => {
      it("2次元配列に変換", () => {
        const result = boardStringToArray(testBoard);

        expect(result).toHaveLength(15);
        expect(result[0]).toHaveLength(15);
        expect(result[7][7]).toBe("x");
        expect(result[8][7]).toBe("o");
      });
    });

    describe("boardStringToBoardState", () => {
      it("BoardStateに変換", () => {
        const result = boardStringToBoardState(testBoard);

        expect(result[7][7]).toBe("black");
        expect(result[8][7]).toBe("white");
        expect(result[0][0]).toBe(null);
      });

      it("空マスはnull", () => {
        const emptyBoard = Array(15).fill("-".repeat(15));
        const result = boardStringToBoardState(emptyBoard);

        expect(result[0][0]).toBe(null);
        expect(result[14][14]).toBe(null);
      });
    });

    describe("boardArrayToString", () => {
      it("文字列配列に変換", () => {
        const array = boardStringToArray(testBoard);
        const result = boardArrayToString(array);

        expect(result).toEqual(testBoard);
      });
    });
  });

  describe("セルアクセス", () => {
    const testBoard = Array(15).fill("-".repeat(15));

    describe("getBoardCell", () => {
      it("セル取得", () => {
        const board = setBoardCell(testBoard, { row: 7, col: 7 }, "x");

        expect(getBoardCell(board, { row: 7, col: 7 })).toBe("x");
        expect(getBoardCell(board, { row: 0, col: 0 })).toBe("-");
      });

      it("範囲外はデフォルト値", () => {
        expect(getBoardCell(testBoard, { row: 99, col: 99 })).toBe("-");
      });
    });

    describe("setBoardCell", () => {
      it("セル設定", () => {
        const board = setBoardCell(testBoard, { row: 7, col: 7 }, "x");

        expect(getBoardCell(board, { row: 7, col: 7 })).toBe("x");
      });

      it("元の配列は変更されない", () => {
        const original = [...testBoard];
        setBoardCell(testBoard, { row: 7, col: 7 }, "x");

        expect(testBoard).toEqual(original);
      });
    });

    describe("cycleBoardCell", () => {
      it("状態サイクル: - → x → o → -", () => {
        let board = testBoard;

        expect(getBoardCell(board, { row: 0, col: 0 })).toBe("-");

        board = cycleBoardCell(board, { row: 0, col: 0 });
        expect(getBoardCell(board, { row: 0, col: 0 })).toBe("x");

        board = cycleBoardCell(board, { row: 0, col: 0 });
        expect(getBoardCell(board, { row: 0, col: 0 })).toBe("o");

        board = cycleBoardCell(board, { row: 0, col: 0 });
        expect(getBoardCell(board, { row: 0, col: 0 })).toBe("-");
      });
    });
  });

  describe("downloadScenarioAsJSON", () => {
    it("ダウンロードが実行される", () => {
      const mockLink = {
        click: vi.fn(),
        href: "",
        download: "",
      };
      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockLink),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };
      vi.stubGlobal("document", mockDocument);
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn().mockReturnValue("blob:test"),
        revokeObjectURL: vi.fn(),
      });

      downloadScenarioAsJSON(validScenario);

      expect(mockLink.click).toHaveBeenCalled();
      expect(mockLink.download).toBe("test-scenario.json");
      expect(URL.revokeObjectURL).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
