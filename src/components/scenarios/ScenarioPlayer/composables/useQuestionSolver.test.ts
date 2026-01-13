import { describe, expect, it, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

import type { QuestionSection } from "@/types/scenario";
import type { BoardState } from "@/types/game";

import { useQuestionSolver } from "./useQuestionSolver";

// ストアをモック
const mockPlaceStone = vi.fn(() => ({ success: true }));
const mockSetBoard = vi.fn();
const mockBoard: BoardState = Array(15)
  .fill(null)
  .map(() => Array(15).fill(null));

vi.mock("@/stores/boardStore", () => ({
  useBoardStore: () => ({
    placeStone: mockPlaceStone,
    board: mockBoard,
    setBoard: mockSetBoard,
  }),
}));

const mockShowMessage = vi.fn();
vi.mock("@/stores/dialogStore", () => ({
  useDialogStore: () => ({
    showMessage: mockShowMessage,
  }),
}));

const mockCompleteSection = vi.fn();
vi.mock("@/stores/progressStore", () => ({
  useProgressStore: () => ({
    completeSection: mockCompleteSection,
  }),
}));

describe("useQuestionSolver", () => {
  // eslint-disable-next-line init-declarations
  let onSectionComplete: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line init-declarations
  let onShowCorrectCutin: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line init-declarations
  let onShowIncorrectCutin: ReturnType<typeof vi.fn>;

  const createQuestionSection = (
    overrides: Partial<QuestionSection> = {},
  ): QuestionSection => ({
    id: "question-1",
    type: "question",
    title: "Test Question",
    initialBoard: Array(15).fill("-".repeat(15)),
    description: [],
    dialogues: [],
    successOperator: "or",
    successConditions: [
      {
        type: "position",
        positions: [{ row: 7, col: 7 }],
        color: "black",
      },
    ],
    feedback: {
      success: [{ character: "fubuki", text: [], emotion: 0 }],
      failure: [{ character: "miko", text: [], emotion: 1 }],
    },
    ...overrides,
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    onSectionComplete = vi.fn();
    onShowCorrectCutin = vi.fn();
    onShowIncorrectCutin = vi.fn();

    // boardをリセット
    for (let i = 0; i < 15; i++) {
      for (let j = 0; j < 15; j++) {
        mockBoard[i][j] = null;
      }
    }
  });

  describe("handlePlaceStone", () => {
    it("空セルに石を配置できる", () => {
      const { handlePlaceStone } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handlePlaceStone({ row: 7, col: 7 }, section, false);

      expect(mockSetBoard).toHaveBeenCalled();
    });

    it("占有セルには配置できない", () => {
      mockBoard[5][5] = "black";
      const { handlePlaceStone } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handlePlaceStone({ row: 5, col: 5 }, section, false);

      // setBoard は呼ばれない（既存の石がある）
      expect(mockSetBoard).not.toHaveBeenCalled();
    });

    it("isSectionCompleted=trueの場合は何もしない", () => {
      const { handlePlaceStone } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handlePlaceStone({ row: 7, col: 7 }, section, true);

      expect(mockSetBoard).not.toHaveBeenCalled();
    });
  });

  describe("条件評価", () => {
    it("checkAllConditions - OR条件でいずれか1つ満たせば正解", () => {
      mockBoard[7][7] = "black";
      const { checkAllConditions } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      const result = checkAllConditions(
        [
          { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
          { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
        ],
        "or",
      );

      expect(result).toBe(true);
    });

    it("checkAllConditions - AND条件で全て満たさないと不正解", () => {
      mockBoard[7][7] = "black";
      const { checkAllConditions } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      const result = checkAllConditions(
        [
          { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
          { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
        ],
        "and",
      );

      expect(result).toBe(false);
    });

    it("checkAllConditions - AND条件で全て満たせば正解", () => {
      mockBoard[7][7] = "black";
      mockBoard[0][0] = "black";
      const { checkAllConditions } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      const result = checkAllConditions(
        [
          { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
          { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
        ],
        "and",
      );

      expect(result).toBe(true);
    });

    it("条件なしの場合は不正解", () => {
      const { checkAllConditions } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      const result = checkAllConditions([], "or");

      expect(result).toBe(false);
    });
  });

  describe("正解時", () => {
    it("onSectionCompleteコールバックが呼ばれる", () => {
      const { handleCorrectMove } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handleCorrectMove(section);

      expect(onSectionComplete).toHaveBeenCalled();
    });

    it("onShowCorrectCutinコールバックが呼ばれる", () => {
      const { handleCorrectMove } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handleCorrectMove(section);

      expect(onShowCorrectCutin).toHaveBeenCalled();
    });

    it("successフィードバックが表示される", () => {
      const { handleCorrectMove } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handleCorrectMove(section);

      expect(mockShowMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          character: "fubuki",
        }),
      );
    });

    it("progressStoreに記録される", () => {
      const { handleCorrectMove } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      handleCorrectMove(section);

      expect(mockCompleteSection).toHaveBeenCalledWith(
        "scenario-1",
        "question-1",
        100,
      );
    });
  });

  describe("submitAnswer", () => {
    it("条件を満たせば正解処理が実行される", () => {
      mockBoard[7][7] = "black";
      const { submitAnswer } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      submitAnswer(section, false);

      expect(onSectionComplete).toHaveBeenCalled();
      expect(onShowCorrectCutin).toHaveBeenCalled();
    });

    it("条件を満たさなければ不正解処理が実行される", () => {
      // 盤面は空のまま
      const { submitAnswer } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      submitAnswer(section, false);

      expect(onShowIncorrectCutin).toHaveBeenCalled();
      expect(onSectionComplete).not.toHaveBeenCalled();
    });

    it("isSectionCompleted=trueの場合は何もしない", () => {
      const { submitAnswer } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createQuestionSection();

      submitAnswer(section, true);

      expect(onSectionComplete).not.toHaveBeenCalled();
      expect(onShowCorrectCutin).not.toHaveBeenCalled();
      expect(onShowIncorrectCutin).not.toHaveBeenCalled();
    });
  });

  describe("checkSuccessCondition", () => {
    it("position条件を評価できる", () => {
      mockBoard[7][7] = "black";
      const { checkSuccessCondition } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      const result = checkSuccessCondition(
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
        mockBoard,
      );

      expect(result).toBe(true);
    });

    it("条件を満たさない場合はfalse", () => {
      const { checkSuccessCondition } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      const result = checkSuccessCondition(
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
        mockBoard,
      );

      expect(result).toBe(false);
    });
  });

  describe("showForbiddenFeedback", () => {
    it("呼び出し可能（将来実装用）", () => {
      const { showForbiddenFeedback } = useQuestionSolver(
        "scenario-1",
        onSectionComplete,
      );

      // エラーなく呼び出せることを確認
      expect(() => showForbiddenFeedback()).not.toThrow();
    });
  });
});
