import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { DemoSection, DemoDialogue } from "@/types/scenario";

import { useDialogueEditor, type DialogueSection } from "./useDialogueEditor";

// editorStoreとscenarioFileHandlerをモック
const mockUpdateCurrentSection = vi.fn();

vi.mock("@/editor/stores/editorStore", () => ({
  useEditorStore: () => ({
    updateCurrentSection: mockUpdateCurrentSection,
  }),
}));

vi.mock("@/logic/scenarioFileHandler", () => ({
  generateDialogueId: vi.fn(() => "dialogue_new"),
}));

describe("useDialogueEditor", () => {
  // eslint-disable-next-line init-declarations
  let mockSection: DemoSection;
  // eslint-disable-next-line init-declarations
  let getCurrentSection: Mock<() => DialogueSection | null>;

  const createDialogue = (id: string): DemoDialogue => ({
    id,
    character: "fubuki",
    text: [],
    emotion: 0,
    boardActions: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockSection = {
      id: "section-1",
      type: "demo",
      title: "Test Section",
      initialBoard: Array(15).fill("-".repeat(15)),
      dialogues: [
        createDialogue("dialogue_1"),
        createDialogue("dialogue_2"),
        createDialogue("dialogue_3"),
      ],
    };

    getCurrentSection = vi.fn(() => mockSection);
  });

  describe("dialogues", () => {
    it("セクションのdialoguesを返す", () => {
      const { dialogues } = useDialogueEditor(getCurrentSection);

      expect(dialogues.value).toHaveLength(3);
      expect(dialogues.value[0].id).toBe("dialogue_1");
    });

    it("セクションがnullなら空配列", () => {
      getCurrentSection = vi.fn(() => null);
      const { dialogues } = useDialogueEditor(getCurrentSection);

      expect(dialogues.value).toEqual([]);
    });
  });

  describe("addDialogue", () => {
    it("末尾に新しいダイアログを追加", () => {
      const { addDialogue } = useDialogueEditor(getCurrentSection);

      addDialogue();

      expect(mockUpdateCurrentSection).toHaveBeenCalledWith({
        dialogues: expect.arrayContaining([
          expect.objectContaining({ id: "dialogue_new" }),
        ]),
      });
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues).toHaveLength(4);
    });

    it("新しいダイアログはデフォルト値で作成される", () => {
      const { addDialogue } = useDialogueEditor(getCurrentSection);

      addDialogue();

      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      const [, , , newDialogue] = callArgs.dialogues;
      expect(newDialogue.character).toBe("fubuki");
      expect(newDialogue.text).toEqual([]);
      expect(newDialogue.emotion).toBe(0);
      expect(newDialogue.boardActions).toEqual([]);
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { addDialogue } = useDialogueEditor(getCurrentSection);

      addDialogue();

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });
  });

  describe("insertDialogueAfter", () => {
    it("指定インデックスの後ろに挿入", () => {
      const { insertDialogueAfter } = useDialogueEditor(getCurrentSection);

      insertDialogueAfter(1);

      expect(mockUpdateCurrentSection).toHaveBeenCalled();
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues).toHaveLength(4);
      // IDが再採番される
      expect(callArgs.dialogues[0].id).toBe("dialogue_1");
      expect(callArgs.dialogues[1].id).toBe("dialogue_2");
      expect(callArgs.dialogues[2].id).toBe("dialogue_3");
      expect(callArgs.dialogues[3].id).toBe("dialogue_4");
    });

    it("インデックス0で先頭の後ろに挿入", () => {
      const { insertDialogueAfter } = useDialogueEditor(getCurrentSection);

      insertDialogueAfter(0);

      expect(mockUpdateCurrentSection).toHaveBeenCalled();
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues).toHaveLength(4);
    });

    it("範囲外インデックス（負の値）では何もしない", () => {
      const { insertDialogueAfter } = useDialogueEditor(getCurrentSection);

      insertDialogueAfter(-1);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });

    it("範囲外インデックス（大きい値）では何もしない", () => {
      const { insertDialogueAfter } = useDialogueEditor(getCurrentSection);

      insertDialogueAfter(99);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { insertDialogueAfter } = useDialogueEditor(getCurrentSection);

      insertDialogueAfter(0);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });
  });

  describe("removeDialogue", () => {
    it("指定インデックスのダイアログを削除", () => {
      const { removeDialogue } = useDialogueEditor(getCurrentSection);

      removeDialogue(1);

      expect(mockUpdateCurrentSection).toHaveBeenCalled();
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues).toHaveLength(2);
    });

    it("削除後にIDが再採番される", () => {
      const { removeDialogue } = useDialogueEditor(getCurrentSection);

      removeDialogue(0);

      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues[0].id).toBe("dialogue_1");
      expect(callArgs.dialogues[1].id).toBe("dialogue_2");
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { removeDialogue } = useDialogueEditor(getCurrentSection);

      removeDialogue(0);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });
  });

  describe("updateDialogue", () => {
    it("指定インデックスのダイアログを更新", () => {
      const { updateDialogue } = useDialogueEditor(getCurrentSection);

      updateDialogue(0, { character: "miko", emotion: 5 });

      expect(mockUpdateCurrentSection).toHaveBeenCalled();
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues[0].character).toBe("miko");
      expect(callArgs.dialogues[0].emotion).toBe(5);
    });

    it("元のダイアログの他のプロパティは保持される", () => {
      const { updateDialogue } = useDialogueEditor(getCurrentSection);

      updateDialogue(0, { character: "miko" });

      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues[0].id).toBe("dialogue_1");
      expect(callArgs.dialogues[0].boardActions).toEqual([]);
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { updateDialogue } = useDialogueEditor(getCurrentSection);

      updateDialogue(0, { character: "miko" });

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });
  });

  describe("moveDialogueUp", () => {
    it("ダイアログを1つ上に移動", () => {
      const { moveDialogueUp } = useDialogueEditor(getCurrentSection);

      moveDialogueUp(1);

      expect(mockUpdateCurrentSection).toHaveBeenCalled();
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues[0].id).toBe("dialogue_2");
      expect(callArgs.dialogues[1].id).toBe("dialogue_1");
      expect(callArgs.dialogues[2].id).toBe("dialogue_3");
    });

    it("インデックス0では何もしない", () => {
      const { moveDialogueUp } = useDialogueEditor(getCurrentSection);

      moveDialogueUp(0);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });

    it("負のインデックスでは何もしない", () => {
      const { moveDialogueUp } = useDialogueEditor(getCurrentSection);

      moveDialogueUp(-1);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { moveDialogueUp } = useDialogueEditor(getCurrentSection);

      moveDialogueUp(1);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });
  });

  describe("moveDialogueDown", () => {
    it("ダイアログを1つ下に移動", () => {
      const { moveDialogueDown } = useDialogueEditor(getCurrentSection);

      moveDialogueDown(0);

      expect(mockUpdateCurrentSection).toHaveBeenCalled();
      const [[callArgs]] = mockUpdateCurrentSection.mock.calls;
      expect(callArgs.dialogues[0].id).toBe("dialogue_2");
      expect(callArgs.dialogues[1].id).toBe("dialogue_1");
      expect(callArgs.dialogues[2].id).toBe("dialogue_3");
    });

    it("最後のインデックスでは何もしない", () => {
      const { moveDialogueDown } = useDialogueEditor(getCurrentSection);

      moveDialogueDown(2);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });

    it("範囲外インデックスでは何もしない", () => {
      const { moveDialogueDown } = useDialogueEditor(getCurrentSection);

      moveDialogueDown(99);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });

    it("セクションがnullなら何もしない", () => {
      getCurrentSection = vi.fn(() => null);
      const { moveDialogueDown } = useDialogueEditor(getCurrentSection);

      moveDialogueDown(0);

      expect(mockUpdateCurrentSection).not.toHaveBeenCalled();
    });
  });
});
