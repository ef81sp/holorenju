import { describe, expect, it } from "vitest";

import { parseScenario, validateBoardState } from "./scenarioParser";

// 有効な15x15の空盤面
const EMPTY_BOARD = Array(15).fill("-".repeat(15));

// 最小限の有効なダイアログ
const validDialogue = {
  id: "d1",
  character: "fubuki",
  text: [{ type: "text", content: "こんにちは" }],
  emotion: 0,
};

// 最小限の有効なデモセクション
const validDemoSection = {
  id: "demo1",
  type: "demo",
  title: "デモセクション",
  initialBoard: EMPTY_BOARD,
  dialogues: [validDialogue],
};

// 最小限の有効な問題セクション
const validQuestionSection = {
  id: "question1",
  type: "question",
  title: "問題セクション",
  initialBoard: EMPTY_BOARD,
  description: "問題の説明",
  dialogues: [validDialogue],
  successConditions: [
    {
      type: "position",
      positions: [{ row: 7, col: 7 }],
      color: "black",
    },
  ],
  feedback: {
    success: [
      { character: "fubuki", text: [{ type: "text", content: "正解！" }] },
    ],
    failure: [
      { character: "fubuki", text: [{ type: "text", content: "不正解" }] },
    ],
  },
};

// 最小限の有効なシナリオ
const validScenario = {
  id: "test-scenario",
  title: "テストシナリオ",
  difficulty: "renju_beginner",
  description: "テスト用のシナリオです",
  objectives: ["目標1", "目標2"],
  sections: [validDemoSection],
};

describe("parseScenario", () => {
  describe("有効なシナリオ", () => {
    it("最小限の有効なシナリオをパースできる", () => {
      const result = parseScenario(validScenario);

      expect(result.id).toBe("test-scenario");
      expect(result.title).toBe("テストシナリオ");
      expect(result.difficulty).toBe("renju_beginner");
      expect(result.sections).toHaveLength(1);
    });

    it("デモセクションを正しくパースできる", () => {
      const result = parseScenario(validScenario);
      const section = result.sections[0];

      expect(section.type).toBe("demo");
      expect(section.id).toBe("demo1");
      expect(section.title).toBe("デモセクション");
    });

    it("問題セクションを正しくパースできる", () => {
      const scenario = {
        ...validScenario,
        sections: [validQuestionSection],
      };
      const result = parseScenario(scenario);
      const section = result.sections[0];

      expect(section.type).toBe("question");
      if (section.type === "question") {
        expect(section.successConditions).toHaveLength(1);
        expect(section.feedback.success).toHaveLength(1);
      }
    });
  });

  describe("シナリオレベルのバリデーション", () => {
    it("オブジェクトでない場合エラー", () => {
      expect(() => parseScenario("not an object")).toThrow(
        "Scenario must be an object",
      );
      expect(() => parseScenario(null)).toThrow("Scenario must be an object");
      expect(() => parseScenario([])).toThrow("Scenario must be an object");
    });

    it("idが欠けている場合エラー", () => {
      const { id: _, ...noId } = validScenario;
      expect(() => parseScenario(noId)).toThrow("Scenario.id must be a string");
    });

    it("titleが欠けている場合エラー", () => {
      const { title: _, ...noTitle } = validScenario;
      expect(() => parseScenario(noTitle)).toThrow(
        "Scenario.title must be a string",
      );
    });

    it("無効なdifficultyの場合エラー", () => {
      const invalid = { ...validScenario, difficulty: "invalid" };
      expect(() => parseScenario(invalid)).toThrow("must be one of");
    });

    it("sectionsが配列でない場合エラー", () => {
      const invalid = { ...validScenario, sections: "not array" };
      expect(() => parseScenario(invalid)).toThrow("must be an array");
    });
  });

  describe("セクションのバリデーション", () => {
    it("無効なセクションtypeの場合エラー", () => {
      const invalid = {
        ...validScenario,
        sections: [{ ...validDemoSection, type: "invalid" }],
      };
      expect(() => parseScenario(invalid)).toThrow("must be one of");
    });

    it("デモセクションのdialoguesが空の場合エラー", () => {
      const invalid = {
        ...validScenario,
        sections: [{ ...validDemoSection, dialogues: [] as unknown[] }],
      };
      expect(() => parseScenario(invalid)).toThrow("must not be empty");
    });
  });

  describe("盤面操作のバリデーション", () => {
    it("place操作を正しくパースできる", () => {
      const dialogueWithAction = {
        ...validDialogue,
        boardActions: [
          { type: "place", position: { row: 7, col: 7 }, color: "black" },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [{ ...validDemoSection, dialogues: [dialogueWithAction] }],
      };

      const result = parseScenario(scenario);
      const section = result.sections[0];
      if (section.type === "demo") {
        const actions = section.dialogues[0].boardActions;
        expect(actions).toHaveLength(1);
        expect(actions[0].type).toBe("place");
      }
    });

    it("mark操作を正しくパースできる", () => {
      const dialogueWithMark = {
        ...validDialogue,
        boardActions: [
          {
            type: "mark",
            positions: [{ row: 7, col: 7 }],
            markType: "circle",
          },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [{ ...validDemoSection, dialogues: [dialogueWithMark] }],
      };

      const result = parseScenario(scenario);
      const section = result.sections[0];
      if (section.type === "demo") {
        const actions = section.dialogues[0].boardActions;
        expect(actions[0].type).toBe("mark");
      }
    });

    it("line操作を正しくパースできる", () => {
      const dialogueWithLine = {
        ...validDialogue,
        boardActions: [
          {
            type: "line",
            fromPosition: { row: 7, col: 7 },
            toPosition: { row: 7, col: 11 },
            action: "draw",
          },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [{ ...validDemoSection, dialogues: [dialogueWithLine] }],
      };

      const result = parseScenario(scenario);
      const section = result.sections[0];
      if (section.type === "demo") {
        const actions = section.dialogues[0].boardActions;
        expect(actions[0].type).toBe("line");
      }
    });

    it("無効な操作typeの場合エラー", () => {
      const dialogueWithInvalidAction = {
        ...validDialogue,
        boardActions: [{ type: "invalid" }],
      };
      const scenario = {
        ...validScenario,
        sections: [
          { ...validDemoSection, dialogues: [dialogueWithInvalidAction] },
        ],
      };

      expect(() => parseScenario(scenario)).toThrow("must be one of");
    });
  });

  describe("成功条件のバリデーション", () => {
    it("position条件を正しくパースできる", () => {
      const scenario = {
        ...validScenario,
        sections: [validQuestionSection],
      };

      const result = parseScenario(scenario);
      const section = result.sections[0];
      if (section.type === "question") {
        expect(section.successConditions[0].type).toBe("position");
      }
    });

    it("pattern条件を正しくパースできる", () => {
      const questionWithPattern = {
        ...validQuestionSection,
        successConditions: [
          { type: "pattern", pattern: "five", color: "black" },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [questionWithPattern],
      };

      const result = parseScenario(scenario);
      const section = result.sections[0];
      if (section.type === "question") {
        expect(section.successConditions[0].type).toBe("pattern");
      }
    });

    it("sequence条件を正しくパースできる", () => {
      const questionWithSequence = {
        ...validQuestionSection,
        successConditions: [
          {
            type: "sequence",
            moves: [{ position: { row: 7, col: 7 }, color: "black" }],
            strict: true,
          },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [questionWithSequence],
      };

      const result = parseScenario(scenario);
      const section = result.sections[0];
      if (section.type === "question") {
        expect(section.successConditions[0].type).toBe("sequence");
      }
    });

    it("空の成功条件配列はエラー", () => {
      const questionWithEmptyConditions = {
        ...validQuestionSection,
        successConditions: [] as unknown[],
      };
      const scenario = {
        ...validScenario,
        sections: [questionWithEmptyConditions],
      };

      expect(() => parseScenario(scenario)).toThrow("must not be empty");
    });
  });

  describe("位置のバリデーション", () => {
    it("範囲外のrowはエラー", () => {
      const dialogueWithInvalidPosition = {
        ...validDialogue,
        boardActions: [
          { type: "place", position: { row: 15, col: 7 }, color: "black" },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [
          { ...validDemoSection, dialogues: [dialogueWithInvalidPosition] },
        ],
      };

      expect(() => parseScenario(scenario)).toThrow("must be between 0 and 14");
    });

    it("範囲外のcolはエラー", () => {
      const dialogueWithInvalidPosition = {
        ...validDialogue,
        boardActions: [
          { type: "place", position: { row: 7, col: -1 }, color: "black" },
        ],
      };
      const scenario = {
        ...validScenario,
        sections: [
          { ...validDemoSection, dialogues: [dialogueWithInvalidPosition] },
        ],
      };

      expect(() => parseScenario(scenario)).toThrow("must be between 0 and 14");
    });
  });
});

describe("validateBoardState", () => {
  it("有効な空盤面はエラーなし", () => {
    const errors = validateBoardState(EMPTY_BOARD);
    expect(errors).toHaveLength(0);
  });

  it("石が配置された有効な盤面はエラーなし", () => {
    const board = [...EMPTY_BOARD];
    board[7] = "-------x-------";
    board[8] = "-------o-------";

    const errors = validateBoardState(board);
    expect(errors).toHaveLength(0);
  });

  it("配列でない場合エラー", () => {
    const errors = validateBoardState("not array" as unknown as unknown[]);
    expect(errors).toContain("Board must be an array");
  });

  it("行数が15でない場合エラー", () => {
    const board = Array(14).fill("-".repeat(15));
    const errors = validateBoardState(board);
    expect(errors.some((e) => e.includes("must have exactly 15 rows"))).toBe(
      true,
    );
  });

  it("行が文字列でない場合エラー", () => {
    const board = [...EMPTY_BOARD];
    board[5] = 123 as unknown as string;

    const errors = validateBoardState(board);
    expect(errors.some((e) => e.includes("must be a string"))).toBe(true);
  });

  it("行の長さが15でない場合エラー", () => {
    const board = [...EMPTY_BOARD];
    board[5] = "-".repeat(14);

    const errors = validateBoardState(board);
    expect(
      errors.some((e) => e.includes("must have exactly 15 characters")),
    ).toBe(true);
  });

  it("無効な文字が含まれる場合エラー", () => {
    const board = [...EMPTY_BOARD];
    board[5] = "-------?-------";

    const errors = validateBoardState(board);
    expect(errors.some((e) => e.includes("invalid characters"))).toBe(true);
  });

  it("複数のエラーを同時に報告できる", () => {
    const board = Array(14).fill("-".repeat(14));
    board[0] = "invalid";

    const errors = validateBoardState(board);
    expect(errors.length).toBeGreaterThan(1);
  });
});
