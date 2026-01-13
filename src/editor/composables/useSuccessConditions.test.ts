import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type {
  QuestionSection,
  SuccessCondition,
  PositionCondition,
  PatternCondition,
  SequenceCondition,
} from "@/types/scenario";

import { useSuccessConditions } from "./useSuccessConditions";

describe("useSuccessConditions", () => {
  // モックセクション
  let mockSection: QuestionSection;
  let getCurrentSection: Mock<() => QuestionSection | null>;
  let updateSection: Mock<(updates: Partial<QuestionSection>) => void>;

  beforeEach(() => {
    mockSection = {
      id: "section-1",
      type: "question",
      title: "Test Question",
      initialBoard: Array(15).fill("-".repeat(15)),
      description: [],
      dialogues: [],
      successConditions: [],
      feedback: {
        success: [],
        failure: [],
      },
    };

    getCurrentSection = vi.fn(() => mockSection);
    updateSection = vi.fn((updates) => {
      Object.assign(mockSection, updates);
    });
  });

  describe("型ガード", () => {
    it("isPositionCondition: type=positionでtrue", () => {
      const { isPositionCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      const condition: SuccessCondition = {
        type: "position",
        positions: [],
        color: "black",
      };

      expect(isPositionCondition(condition)).toBe(true);
    });

    it("isPositionCondition: type=patternでfalse", () => {
      const { isPositionCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      const condition: SuccessCondition = {
        type: "pattern",
        pattern: "xxxxx",
        color: "black",
      };

      expect(isPositionCondition(condition)).toBe(false);
    });

    it("isPatternCondition: type=patternでtrue", () => {
      const { isPatternCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      const condition: SuccessCondition = {
        type: "pattern",
        pattern: "xxxxx",
        color: "black",
      };

      expect(isPatternCondition(condition)).toBe(true);
    });

    it("isSequenceCondition: type=sequenceでtrue", () => {
      const { isSequenceCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      const condition: SuccessCondition = {
        type: "sequence",
        moves: [],
        strict: false,
      };

      expect(isSequenceCondition(condition)).toBe(true);
    });
  });

  describe("addSuccessCondition", () => {
    it("デフォルトでposition条件を追加", () => {
      const { addSuccessCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      addSuccessCondition();

      expect(updateSection).toHaveBeenCalledWith({
        successConditions: [
          {
            type: "position",
            positions: [],
            color: "black",
          },
        ],
      });
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { addSuccessCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      addSuccessCondition();

      expect(updateSection).not.toHaveBeenCalled();
    });
  });

  describe("removeSuccessCondition", () => {
    it("指定インデックスの条件を削除", () => {
      mockSection.successConditions = [
        { type: "position", positions: [], color: "black" },
        { type: "pattern", pattern: "xxxxx", color: "white" },
      ];

      const { removeSuccessCondition } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      removeSuccessCondition(0);

      expect(updateSection).toHaveBeenCalledWith({
        successConditions: [
          { type: "pattern", pattern: "xxxxx", color: "white" },
        ],
      });
    });
  });

  describe("changeConditionType", () => {
    it("position → pattern に変更", () => {
      mockSection.successConditions = [
        { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
      ];

      const { changeConditionType } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      changeConditionType(0, "pattern");

      expect(updateSection).toHaveBeenCalledWith({
        successConditions: [{ type: "pattern", pattern: "", color: "black" }],
      });
    });

    it("position → sequence に変更", () => {
      mockSection.successConditions = [
        { type: "position", positions: [], color: "black" },
      ];

      const { changeConditionType } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      changeConditionType(0, "sequence");

      expect(updateSection).toHaveBeenCalledWith({
        successConditions: [{ type: "sequence", moves: [], strict: false }],
      });
    });

    it("pattern → position に変更（デフォルト値で初期化）", () => {
      mockSection.successConditions = [
        { type: "pattern", pattern: "xxxxx", color: "white" },
      ];

      const { changeConditionType } = useSuccessConditions(
        getCurrentSection,
        updateSection,
      );

      changeConditionType(0, "position");

      expect(updateSection).toHaveBeenCalledWith({
        successConditions: [
          { type: "position", positions: [], color: "black" },
        ],
      });
    });
  });

  describe("Position条件操作", () => {
    describe("updatePositionCondition", () => {
      it("color を更新", () => {
        mockSection.successConditions = [
          { type: "position", positions: [], color: "black" },
        ];

        const { updatePositionCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePositionCondition(0, { color: "white" });

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PositionCondition;
        expect(condition.color).toBe("white");
      });

      it("position条件でなければ何もしない", () => {
        mockSection.successConditions = [
          { type: "pattern", pattern: "xxxxx", color: "black" },
        ];

        const { updatePositionCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePositionCondition(0, { color: "white" });

        expect(updateSection).not.toHaveBeenCalled();
      });
    });

    describe("addPositionToCondition", () => {
      it("positionsに新しい位置を追加", () => {
        mockSection.successConditions = [
          { type: "position", positions: [], color: "black" },
        ];

        const { addPositionToCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        addPositionToCondition(0);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PositionCondition;
        expect(condition.positions).toHaveLength(1);
        expect(condition.positions[0]).toEqual({
          row: 0,
          col: 0,
        });
      });
    });

    describe("updatePositionField", () => {
      it("rowを更新", () => {
        mockSection.successConditions = [
          { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
        ];

        const { updatePositionField } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePositionField(0, 0, "row", 7);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PositionCondition;
        expect(condition.positions[0].row).toBe(7);
      });

      it("クランプ確認（0-14範囲）- 負の値", () => {
        mockSection.successConditions = [
          { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
        ];

        const { updatePositionField } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePositionField(0, 0, "row", -5);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PositionCondition;
        expect(condition.positions[0].row).toBe(0);
      });

      it("クランプ確認（0-14範囲）- 15以上", () => {
        mockSection.successConditions = [
          { type: "position", positions: [{ row: 0, col: 0 }], color: "black" },
        ];

        const { updatePositionField } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePositionField(0, 0, "col", 99);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PositionCondition;
        expect(condition.positions[0].col).toBe(14);
      });
    });

    describe("removePositionFromCondition", () => {
      it("指定インデックスの位置を削除", () => {
        mockSection.successConditions = [
          {
            type: "position",
            positions: [
              { row: 0, col: 0 },
              { row: 1, col: 1 },
            ],
            color: "black",
          },
        ];

        const { removePositionFromCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        removePositionFromCondition(0, 0);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PositionCondition;
        expect(condition.positions).toHaveLength(1);
        expect(condition.positions[0]).toEqual({
          row: 1,
          col: 1,
        });
      });
    });
  });

  describe("Pattern条件操作", () => {
    describe("updatePatternCondition", () => {
      it("patternを更新", () => {
        mockSection.successConditions = [
          { type: "pattern", pattern: "", color: "black" },
        ];

        const { updatePatternCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePatternCondition(0, { pattern: "xxxxx" });

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PatternCondition;
        expect(condition.pattern).toBe("xxxxx");
      });

      it("colorを更新", () => {
        mockSection.successConditions = [
          { type: "pattern", pattern: "xxxxx", color: "black" },
        ];

        const { updatePatternCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePatternCondition(0, { color: "white" });

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as PatternCondition;
        expect(condition.color).toBe("white");
      });

      it("pattern条件でなければ何もしない", () => {
        mockSection.successConditions = [
          { type: "position", positions: [], color: "black" },
        ];

        const { updatePatternCondition } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updatePatternCondition(0, { pattern: "xxxxx" });

        expect(updateSection).not.toHaveBeenCalled();
      });
    });
  });

  describe("Sequence条件操作", () => {
    describe("addSequenceMove", () => {
      it("movesに新しい手を追加", () => {
        mockSection.successConditions = [
          { type: "sequence", moves: [], strict: false },
        ];

        const { addSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        addSequenceMove(0);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.moves).toHaveLength(1);
        expect(condition.moves[0]).toEqual({
          row: 0,
          col: 0,
          color: "black",
        });
      });

      it("sequence条件でなければ何もしない", () => {
        mockSection.successConditions = [
          { type: "position", positions: [], color: "black" },
        ];

        const { addSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        addSequenceMove(0);

        expect(updateSection).not.toHaveBeenCalled();
      });
    });

    describe("updateSequenceMove", () => {
      it("rowを更新", () => {
        mockSection.successConditions = [
          {
            type: "sequence",
            moves: [{ row: 0, col: 0, color: "black" }],
            strict: false,
          },
        ];

        const { updateSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updateSequenceMove(0, 0, "row", 7);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.moves[0].row).toBe(7);
      });

      it("colを更新", () => {
        mockSection.successConditions = [
          {
            type: "sequence",
            moves: [{ row: 0, col: 0, color: "black" }],
            strict: false,
          },
        ];

        const { updateSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updateSequenceMove(0, 0, "col", 10);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.moves[0].col).toBe(10);
      });

      it("colorを更新", () => {
        mockSection.successConditions = [
          {
            type: "sequence",
            moves: [{ row: 0, col: 0, color: "black" }],
            strict: false,
          },
        ];

        const { updateSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updateSequenceMove(0, 0, "color", "white");

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.moves[0].color).toBe("white");
      });

      it("row/colのクランプ確認", () => {
        mockSection.successConditions = [
          {
            type: "sequence",
            moves: [{ row: 0, col: 0, color: "black" }],
            strict: false,
          },
        ];

        const { updateSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        updateSequenceMove(0, 0, "row", 99);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.moves[0].row).toBe(14);
      });
    });

    describe("removeSequenceMove", () => {
      it("指定インデックスの手を削除", () => {
        mockSection.successConditions = [
          {
            type: "sequence",
            moves: [
              { row: 0, col: 0, color: "black" },
              { row: 1, col: 1, color: "white" },
            ],
            strict: false,
          },
        ];

        const { removeSequenceMove } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        removeSequenceMove(0, 0);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.moves).toHaveLength(1);
        expect(condition.moves[0]).toEqual({
          row: 1,
          col: 1,
          color: "white",
        });
      });
    });

    describe("toggleSequenceStrict", () => {
      it("strictをtrueに変更", () => {
        mockSection.successConditions = [
          { type: "sequence", moves: [], strict: false },
        ];

        const { toggleSequenceStrict } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        toggleSequenceStrict(0, true);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.strict).toBe(true);
      });

      it("strictをfalseに変更", () => {
        mockSection.successConditions = [
          { type: "sequence", moves: [], strict: true },
        ];

        const { toggleSequenceStrict } = useSuccessConditions(
          getCurrentSection,
          updateSection,
        );

        toggleSequenceStrict(0, false);

        const callArgs = updateSection.mock.calls[0][0];
        const condition = callArgs.successConditions[0] as SequenceCondition;
        expect(condition.strict).toBe(false);
      });
    });
  });
});
