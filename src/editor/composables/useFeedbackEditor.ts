import type { ProblemSection, DialogueLine } from "@/types/scenario";

/**
 * フィードバックメッセージの編集ロジックを提供するComposable
 * success/failure/progressの3種類のフィードバックを管理する
 */
export function useFeedbackEditor(
  getCurrentSection: () => ProblemSection | null,
  updateSection: (updates: Partial<ProblemSection>) => void,
): {
  getFeedbackLines: (key: "success" | "failure" | "progress") => DialogueLine[];
  addFeedbackLine: (key: "success" | "failure" | "progress") => void;
  updateFeedbackLine: (
    key: "success" | "failure" | "progress",
    index: number,
    updates: Partial<DialogueLine>,
  ) => void;
  removeFeedbackLine: (
    key: "success" | "failure" | "progress",
    index: number,
  ) => void;
} {
  type FeedbackKey = "success" | "failure" | "progress";

  const getFeedbackLines = (key: FeedbackKey): DialogueLine[] => {
    const section = getCurrentSection();
    if (!section) {
      return [];
    }

    const { feedback } = section;
    const lines = feedback[key];
    if (Array.isArray(lines)) {
      return lines;
    }
    return [];
  };

  const updateFeedbackLines = (
    key: FeedbackKey,
    lines: DialogueLine[],
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    updateSection({
      feedback: {
        ...section.feedback,
        [key]: lines,
      },
    });
  };

  const addFeedbackLine = (key: FeedbackKey): void => {
    const lines = getFeedbackLines(key);
    updateFeedbackLines(key, [
      ...lines,
      { character: "fubuki", text: [], emotion: 0 },
    ]);
  };

  const updateFeedbackLine = (
    key: FeedbackKey,
    index: number,
    updates: Partial<DialogueLine>,
  ): void => {
    const lines = getFeedbackLines(key);
    if (!lines[index]) {
      return;
    }

    const newLines = [...lines];
    newLines[index] = { ...newLines[index], ...updates } as DialogueLine;
    updateFeedbackLines(key, newLines);
  };

  const removeFeedbackLine = (key: FeedbackKey, index: number): void => {
    const lines = getFeedbackLines(key).filter((_, i) => i !== index);
    updateFeedbackLines(key, lines);
  };

  return {
    getFeedbackLines,
    addFeedbackLine,
    updateFeedbackLine,
    removeFeedbackLine,
  };
}
