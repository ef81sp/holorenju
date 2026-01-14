import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { QuestionSection } from "@/types/scenario";

import { useFeedbackEditor } from "./useFeedbackEditor";

describe("useFeedbackEditor", () => {
  // eslint-disable-next-line init-declarations
  let mockSection: QuestionSection;
  // eslint-disable-next-line init-declarations
  let getCurrentSection: Mock<() => QuestionSection | null>;
  // eslint-disable-next-line init-declarations
  let updateSection: Mock<(updates: Partial<QuestionSection>) => void>;

  const createMockSection = (
    feedback: QuestionSection["feedback"] = {
      success: [],
      failure: [],
      progress: [],
    },
  ): QuestionSection => ({
    id: "section-1",
    type: "question",
    title: "Test Section",
    initialBoard: Array(15).fill("-".repeat(15)),
    description: [],
    dialogues: [],
    successConditions: [],
    feedback,
  });

  beforeEach(() => {
    mockSection = createMockSection({
      success: [{ character: "fubuki", text: [], emotion: 0 }],
      failure: [{ character: "miko", text: [], emotion: 1 }],
      progress: [{ character: "fubuki", text: [], emotion: 2 }],
    });

    getCurrentSection = vi.fn(() => mockSection);
    updateSection = vi.fn((updates) => {
      Object.assign(mockSection, updates);
    });
  });

  describe("getFeedbackLines", () => {
    it("successキーのラインを取得", () => {
      const { getFeedbackLines } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      const lines = getFeedbackLines("success");

      expect(lines).toHaveLength(1);
      expect(lines[0].character).toBe("fubuki");
    });

    it("failureキーのラインを取得", () => {
      const { getFeedbackLines } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      const lines = getFeedbackLines("failure");

      expect(lines).toHaveLength(1);
      expect(lines[0].character).toBe("miko");
    });

    it("progressキーのラインを取得", () => {
      const { getFeedbackLines } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      const lines = getFeedbackLines("progress");

      expect(lines).toHaveLength(1);
      expect(lines[0].emotion).toBe(2);
    });

    it("セクションがnullなら空配列", () => {
      getCurrentSection = vi.fn(() => null);
      const { getFeedbackLines } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      const lines = getFeedbackLines("success");

      expect(lines).toEqual([]);
    });

    it("feedbackキーが存在しない場合は空配列", () => {
      mockSection = createMockSection({
        success: [],
        failure: [],
      });
      const { getFeedbackLines } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      const lines = getFeedbackLines("progress");

      expect(lines).toEqual([]);
    });
  });

  describe("addFeedbackLine", () => {
    it("successに新しいラインを追加", () => {
      mockSection = createMockSection({
        success: [],
        failure: [],
        progress: [],
      });
      const { addFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      addFeedbackLine("success");

      expect(updateSection).toHaveBeenCalledWith({
        feedback: {
          success: [{ character: "fubuki", text: [], emotion: 0 }],
          failure: [],
          progress: [],
        },
      });
    });

    it("failureに新しいラインを追加", () => {
      mockSection = createMockSection({
        success: [],
        failure: [],
        progress: [],
      });
      const { addFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      addFeedbackLine("failure");

      expect(updateSection).toHaveBeenCalledWith({
        feedback: {
          success: [],
          failure: [{ character: "fubuki", text: [], emotion: 0 }],
          progress: [],
        },
      });
    });

    it("progressに新しいラインを追加", () => {
      mockSection = createMockSection({
        success: [],
        failure: [],
        progress: [],
      });
      const { addFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      addFeedbackLine("progress");

      expect(updateSection).toHaveBeenCalledWith({
        feedback: {
          success: [],
          failure: [],
          progress: [{ character: "fubuki", text: [], emotion: 0 }],
        },
      });
    });

    it("既存のラインに追加", () => {
      const { addFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      addFeedbackLine("success");

      expect(updateSection).toHaveBeenCalledWith({
        feedback: expect.objectContaining({
          success: [
            { character: "fubuki", text: [], emotion: 0 },
            { character: "fubuki", text: [], emotion: 0 },
          ],
        }),
      });
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { addFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      addFeedbackLine("success");

      expect(updateSection).not.toHaveBeenCalled();
    });
  });

  describe("updateFeedbackLine", () => {
    it("指定インデックスのラインを更新", () => {
      const { updateFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      updateFeedbackLine("success", 0, { character: "miko", emotion: 5 });

      expect(updateSection).toHaveBeenCalled();
      const [[callArgs]] = updateSection.mock.calls;
      expect(callArgs.feedback?.success?.[0]).toEqual({
        character: "miko",
        text: [],
        emotion: 5,
      });
    });

    it("textを更新", () => {
      const { updateFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      updateFeedbackLine("success", 0, {
        text: [{ type: "text", content: "テスト" }],
      });

      expect(updateSection).toHaveBeenCalled();
      const [[callArgs]] = updateSection.mock.calls;
      expect(callArgs.feedback?.success?.[0].text).toEqual([
        { type: "text", content: "テスト" },
      ]);
    });

    it("範囲外インデックスは何もしない", () => {
      const { updateFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      updateFeedbackLine("success", 99, { character: "miko" });

      expect(updateSection).not.toHaveBeenCalled();
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { updateFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      updateFeedbackLine("success", 0, { character: "miko" });

      expect(updateSection).not.toHaveBeenCalled();
    });
  });

  describe("removeFeedbackLine", () => {
    it("指定インデックスのラインを削除", () => {
      mockSection = createMockSection({
        success: [
          { character: "fubuki", text: [], emotion: 0 },
          { character: "miko", text: [], emotion: 1 },
        ],
        failure: [],
        progress: [],
      });
      const { removeFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      removeFeedbackLine("success", 0);

      expect(updateSection).toHaveBeenCalledWith({
        feedback: expect.objectContaining({
          success: [{ character: "miko", text: [], emotion: 1 }],
        }),
      });
    });

    it("範囲外インデックスは配列を変更しない", () => {
      const { removeFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      removeFeedbackLine("success", 99);

      // filter は範囲外でも呼び出される（配列は変わらない）
      expect(updateSection).toHaveBeenCalled();
      const [[callArgs]] = updateSection.mock.calls;
      expect(callArgs.feedback?.success).toHaveLength(1);
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { removeFeedbackLine } = useFeedbackEditor(
        getCurrentSection,
        updateSection,
      );

      removeFeedbackLine("success", 0);

      expect(updateSection).not.toHaveBeenCalled();
    });
  });
});
