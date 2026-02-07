import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { Scenario } from "@/types/scenario";
import type { TextNode } from "@/types/text";

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
  validateTitleLength,
  countDisplayCharacters,
  countDisplayCharactersPerLine,
  validateDialogueLength,
  TITLE_MAX_LENGTH,
  DIALOGUE_MAX_LENGTH_NO_NEWLINE,
  DIALOGUE_MAX_LENGTH_PER_LINE,
  DIALOGUE_MAX_LINES,
} from "./scenarioFileHandler";

describe("scenarioFileHandler", () => {
  const validScenario: Scenario = {
    id: "test-scenario",
    title: "テスト", // 3文字（7文字以内）
    difficulty: "gomoku_beginner",
    description: "A test scenario",
    objectives: ["Objective 1"],
    sections: [
      {
        id: "section-1",
        type: "demo",
        title: "デモ", // 2文字（7文字以内）
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
      expect(result.title).toBe("テスト");
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

  describe("文字数バリデーション", () => {
    describe("validateTitleLength", () => {
      it("7文字以内はnullを返す", () => {
        expect(validateTitleLength("1234567")).toBeNull();
        expect(validateTitleLength("タイトル")).toBeNull();
        expect(validateTitleLength("")).toBeNull();
      });

      it("8文字以上はエラーメッセージを返す", () => {
        const result = validateTitleLength("12345678");
        expect(result).not.toBeNull();
        expect(result).toContain("7文字以内");
        expect(result).toContain("8文字");
      });

      it("定数TITLE_MAX_LENGTHが7", () => {
        expect(TITLE_MAX_LENGTH).toBe(7);
      });
    });

    describe("countDisplayCharacters", () => {
      it("プレーンテキストの文字数をカウント", () => {
        const nodes: TextNode[] = [{ type: "text", content: "こんにちは" }];
        expect(countDisplayCharacters(nodes)).toBe(5);
      });

      it("ルビはbaseのみカウント", () => {
        const nodes: TextNode[] = [
          { type: "ruby", base: "漢字", ruby: "かんじ" },
        ];
        expect(countDisplayCharacters(nodes)).toBe(2);
      });

      it("強調は中身のみカウント（マークダウン記号を除外）", () => {
        const nodes: TextNode[] = [
          {
            type: "emphasis",
            content: [{ type: "text", content: "太字" }],
          },
        ];
        expect(countDisplayCharacters(nodes)).toBe(2);
      });

      it("複合ノードを正しくカウント", () => {
        const nodes: TextNode[] = [
          { type: "text", content: "これは" },
          { type: "ruby", base: "連珠", ruby: "れんじゅ" },
          { type: "text", content: "です" },
        ];
        // "これは"(3) + "連珠"(2) + "です"(2) = 7
        expect(countDisplayCharacters(nodes)).toBe(7);
      });

      it("改行は文字数としてカウントしない", () => {
        const nodes: TextNode[] = [
          { type: "text", content: "abc" },
          { type: "lineBreak" },
          { type: "text", content: "def" },
        ];
        expect(countDisplayCharacters(nodes)).toBe(6);
      });

      it("ネストした強調をカウント", () => {
        const nodes: TextNode[] = [
          {
            type: "emphasis",
            content: [
              { type: "text", content: "太" },
              { type: "ruby", base: "字", ruby: "じ" },
            ],
          },
        ];
        expect(countDisplayCharacters(nodes)).toBe(2);
      });
    });

    describe("countDisplayCharactersPerLine", () => {
      it("改行で分割して各行の文字数を返す", () => {
        const nodes: TextNode[] = [
          { type: "text", content: "12345" },
          { type: "lineBreak" },
          { type: "text", content: "abc" },
        ];
        expect(countDisplayCharactersPerLine(nodes)).toEqual([5, 3]);
      });

      it("改行がない場合は1行として返す", () => {
        const nodes: TextNode[] = [{ type: "text", content: "hello" }];
        expect(countDisplayCharactersPerLine(nodes)).toEqual([5]);
      });

      it("空の入力は空配列の1行を返す", () => {
        const nodes: TextNode[] = [];
        expect(countDisplayCharactersPerLine(nodes)).toEqual([0]);
      });
    });

    describe("validateDialogueLength", () => {
      it("改行なし40文字以内はnullを返す", () => {
        const nodes: TextNode[] = [{ type: "text", content: "あ".repeat(40) }];
        expect(validateDialogueLength(nodes)).toBeNull();
      });

      it("改行なし41文字以上はエラーを返す", () => {
        const nodes: TextNode[] = [{ type: "text", content: "あ".repeat(41) }];
        const result = validateDialogueLength(nodes);
        expect(result).not.toBeNull();
        expect(result).toContain("40文字以内");
      });

      it("改行あり2行以内・各行20文字以内はnullを返す", () => {
        const nodes: TextNode[] = [
          { type: "text", content: "あ".repeat(20) },
          { type: "lineBreak" },
          { type: "text", content: "い".repeat(20) },
        ];
        expect(validateDialogueLength(nodes)).toBeNull();
      });

      it("改行あり3行以上はエラーを返す", () => {
        const nodes: TextNode[] = [
          { type: "text", content: "a" },
          { type: "lineBreak" },
          { type: "text", content: "b" },
          { type: "lineBreak" },
          { type: "text", content: "c" },
        ];
        const result = validateDialogueLength(nodes);
        expect(result).not.toBeNull();
        expect(result).toContain("2行以内");
      });

      it("改行あり1行21文字以上はエラーを返す", () => {
        const nodes: TextNode[] = [
          { type: "text", content: "あ".repeat(21) },
          { type: "lineBreak" },
          { type: "text", content: "い".repeat(5) },
        ];
        const result = validateDialogueLength(nodes);
        expect(result).not.toBeNull();
        expect(result).toContain("20文字以内");
        expect(result).toContain("1行目");
      });

      it("定数が正しい値を持つ", () => {
        expect(DIALOGUE_MAX_LENGTH_NO_NEWLINE).toBe(40);
        expect(DIALOGUE_MAX_LENGTH_PER_LINE).toBe(20);
        expect(DIALOGUE_MAX_LINES).toBe(2);
      });
    });

    describe("validateScenarioCompletely - 文字数チェック", () => {
      it("checkLength: false（デフォルト）では文字数チェックしない", () => {
        const scenario = {
          ...validScenario,
          title: "12345678", // 8文字（オーバー）
        };
        const result = validateScenarioCompletely(scenario);

        expect(result.isValid).toBe(true);
        expect(result.errors.some((e) => e.type === "length")).toBe(false);
      });

      it("checkLength: true でシナリオタイトルが8文字以上でエラー", () => {
        const scenario = {
          ...validScenario,
          title: "12345678", // 8文字
        };
        const result = validateScenarioCompletely(scenario, {
          checkLength: true,
        });

        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.type === "length")).toBe(true);
        expect(result.errors.some((e) => e.path === "title")).toBe(true);
      });

      it("checkLength: true でセクションタイトルが8文字以上でエラー", () => {
        const scenario = {
          ...validScenario,
          sections: [
            {
              ...validScenario.sections[0],
              title: "セクション名長すぎ", // 9文字
            },
          ],
        };
        const result = validateScenarioCompletely(scenario, {
          checkLength: true,
        });

        expect(result.isValid).toBe(false);
        expect(
          result.errors.some(
            (e) => e.type === "length" && e.path.includes("sections[0].title"),
          ),
        ).toBe(true);
      });

      it("checkLength: true でダイアログテキストが41文字以上でエラー", () => {
        const scenario = {
          ...validScenario,
          sections: [
            {
              ...validScenario.sections[0],
              dialogues: [
                {
                  id: "dialogue-1",
                  character: "fubuki" as const,
                  emotion: 0,
                  text: [{ type: "text" as const, content: "あ".repeat(41) }],
                  boardActions: [] as [],
                },
              ],
            },
          ],
        };
        const result = validateScenarioCompletely(scenario, {
          checkLength: true,
        });

        expect(result.isValid).toBe(false);
        expect(
          result.errors.some(
            (e) => e.type === "length" && e.path.includes("dialogues[0].text"),
          ),
        ).toBe(true);
      });

      it("checkLength: true ですべて有効な文字数の場合はエラーなし", () => {
        const scenario = {
          ...validScenario,
          title: "タイトル", // 4文字
          sections: [
            {
              ...validScenario.sections[0],
              title: "セクション", // 5文字
              dialogues: [
                {
                  id: "dialogue-1",
                  character: "fubuki" as const,
                  emotion: 0,
                  text: [{ type: "text" as const, content: "短いテキスト" }],
                  boardActions: [] as [],
                },
              ],
            },
          ],
        };
        const result = validateScenarioCompletely(scenario, {
          checkLength: true,
        });

        expect(result.isValid).toBe(true);
        expect(result.errors.filter((e) => e.type === "length")).toHaveLength(
          0,
        );
      });
    });
  });
});
