import type { Position } from "@/types/game";
import type { DemoSection, DemoDialogue, BoardAction } from "@/types/scenario";

/**
 * ボードアクション（place/remove/setBoard/mark/line）の編集ロジックを提供するComposable
 * ダイアログの各アクションを管理・更新する
 */
export function useBoardActions(
  getCurrentSection: () => DemoSection | null,
  updateDialogue: (index: number, updates: Partial<DemoDialogue>) => void,
): {
  createBoardAction: (type: BoardAction["type"]) => BoardAction;
  addBoardAction: (dialogueIndex: number) => void;
  removeBoardAction: (dialogueIndex: number, actionIndex: number) => void;
  moveBoardAction: (
    dialogueIndex: number,
    fromIndex: number,
    toIndex: number,
  ) => void;
  updateBoardActionInArray: (
    dialogueIndex: number,
    actionIndex: number,
    updates: Partial<BoardAction>,
  ) => void;
  updateBoardActionPosition: (
    dialogueIndex: number,
    actionIndex: number,
    key: "position" | "fromPosition" | "toPosition",
    field: "row" | "col",
    value: number,
  ) => void;
  updateBoardActionColor: (
    dialogueIndex: number,
    actionIndex: number,
    color: "black" | "white",
  ) => void;
  updateBoardActionHighlight: (
    dialogueIndex: number,
    actionIndex: number,
    highlight: boolean,
  ) => void;
  updateBoardActionBoard: (
    dialogueIndex: number,
    actionIndex: number,
    board: string[],
  ) => void;
  addBoardActionMarkPosition: (
    dialogueIndex: number,
    actionIndex: number,
  ) => void;
  updateBoardActionMarkPosition: (
    dialogueIndex: number,
    actionIndex: number,
    posIndex: number,
    field: "row" | "col",
    value: number,
  ) => void;
  removeBoardActionMarkPosition: (
    dialogueIndex: number,
    actionIndex: number,
    posIndex: number,
  ) => void;
  updateBoardActionMarkMeta: (
    dialogueIndex: number,
    actionIndex: number,
    updates: Partial<Extract<BoardAction, { type: "mark" }>>,
  ) => void;
  updateBoardActionLine: (
    dialogueIndex: number,
    actionIndex: number,
    updates: Partial<Extract<BoardAction, { type: "line" }>>,
  ) => void;
  updateBoardActionType: (
    dialogueIndex: number,
    actionIndex: number,
    newType: BoardAction["type"],
  ) => void;
} {
  // ===== アクション作成 =====
  const createBoardAction = (type: BoardAction["type"]): BoardAction => {
    switch (type) {
      case "place":
        return {
          type: "place",
          position: { row: 7, col: 7 },
          color: "black",
          highlight: false,
        };
      case "remove":
        return {
          type: "remove",
          position: { row: 7, col: 7 },
        };
      case "setBoard":
        return {
          type: "setBoard",
          board: Array(15).fill("-".repeat(15)),
        };
      case "mark":
        return {
          type: "mark",
          positions: [],
          markType: "circle",
          action: "draw",
        };
      case "line":
        return {
          type: "line",
          fromPosition: { row: 7, col: 7 },
          toPosition: { row: 7, col: 7 },
          action: "draw",
          style: "solid",
        };
      case "resetAll":
        return {
          type: "resetAll",
        };
      case "resetMarkLine":
        return {
          type: "resetMarkLine",
        };
      default:
        return {
          type: "place",
          position: { row: 7, col: 7 },
          color: "black",
        };
    }
  };

  // ===== 配列操作関数 =====
  const addBoardAction = (dialogueIndex: number): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue) {
      return;
    }

    const newBoardActions = [
      ...dialogue.boardActions,
      createBoardAction("place"),
    ];
    updateDialogue(dialogueIndex, { boardActions: newBoardActions });
  };

  const removeBoardAction = (
    dialogueIndex: number,
    actionIndex: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue) {
      return;
    }

    const newBoardActions = dialogue.boardActions.filter(
      (_, i) => i !== actionIndex,
    );
    updateDialogue(dialogueIndex, { boardActions: newBoardActions });
  };

  const moveBoardAction = (
    dialogueIndex: number,
    fromIndex: number,
    toIndex: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue) {
      return;
    }

    const newBoardActions = [...dialogue.boardActions];
    const [movedAction] = newBoardActions.splice(fromIndex, 1);
    if (movedAction) {
      newBoardActions.splice(toIndex, 0, movedAction);
    }
    updateDialogue(dialogueIndex, { boardActions: newBoardActions });
  };

  const updateBoardActionInArray = (
    dialogueIndex: number,
    actionIndex: number,
    updates: Partial<BoardAction>,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const newBoardActions = [...dialogue.boardActions];
    newBoardActions[actionIndex] = {
      ...newBoardActions[actionIndex],
      ...updates,
    } as BoardAction;
    updateDialogue(dialogueIndex, { boardActions: newBoardActions });
  };

  // ===== 位置更新 =====
  const updateBoardActionPosition = (
    dialogueIndex: number,
    actionIndex: number,
    key: "position" | "fromPosition" | "toPosition",
    field: "row" | "col",
    value: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const nextValue = Math.max(0, Math.min(14, value));
    const action = dialogue.boardActions[actionIndex];

    if (
      (action.type === "place" || action.type === "remove") &&
      key === "position"
    ) {
      const updatedPos: Position = { ...action.position, [field]: nextValue };
      updateBoardActionInArray(dialogueIndex, actionIndex, {
        position: updatedPos,
      });
      return;
    }

    if (action.type === "line") {
      if (key === "fromPosition") {
        const updatedPos: Position = {
          ...action.fromPosition,
          [field]: nextValue,
        };
        updateBoardActionInArray(dialogueIndex, actionIndex, {
          fromPosition: updatedPos,
        });
        return;
      }
      if (key === "toPosition") {
        const updatedPos: Position = {
          ...action.toPosition,
          [field]: nextValue,
        };
        updateBoardActionInArray(dialogueIndex, actionIndex, {
          toPosition: updatedPos,
        });
      }
    }
  };

  // ===== Place アクション用 =====
  const updateBoardActionColor = (
    dialogueIndex: number,
    actionIndex: number,
    color: "black" | "white",
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const action = dialogue.boardActions[actionIndex];
    if (action.type !== "place") {
      return;
    }

    updateBoardActionInArray(dialogueIndex, actionIndex, { color });
  };

  const updateBoardActionHighlight = (
    dialogueIndex: number,
    actionIndex: number,
    highlight: boolean,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const action = dialogue.boardActions[actionIndex];
    if (action.type !== "place") {
      return;
    }

    updateBoardActionInArray(dialogueIndex, actionIndex, { highlight });
  };

  // ===== SetBoard アクション用 =====
  const updateBoardActionBoard = (
    dialogueIndex: number,
    actionIndex: number,
    board: string[],
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const action = dialogue.boardActions[actionIndex];
    if (action.type !== "setBoard") {
      return;
    }

    updateBoardActionInArray(dialogueIndex, actionIndex, { board });
  };

  // ===== Mark アクション用 =====
  const addBoardActionMarkPosition = (
    dialogueIndex: number,
    actionIndex: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const action = dialogue.boardActions[actionIndex];
    if (action.type !== "mark") {
      return;
    }

    const positions = [...action.positions, { row: 7, col: 7 }];
    updateBoardActionInArray(dialogueIndex, actionIndex, { positions });
  };

  const updateBoardActionMarkPosition = (
    dialogueIndex: number,
    actionIndex: number,
    posIndex: number,
    field: "row" | "col",
    value: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const action = dialogue.boardActions[actionIndex];
    if (action.type !== "mark") {
      return;
    }

    const positions = [...action.positions];
    const nextValue = Math.max(0, Math.min(14, value));
    positions[posIndex] = {
      ...positions[posIndex],
      [field]: nextValue,
    } as Position;
    updateBoardActionInArray(dialogueIndex, actionIndex, { positions });
  };

  const removeBoardActionMarkPosition = (
    dialogueIndex: number,
    actionIndex: number,
    posIndex: number,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    const action = dialogue.boardActions[actionIndex];
    if (action.type !== "mark") {
      return;
    }

    const positions = action.positions.filter((_, i) => i !== posIndex);
    updateBoardActionInArray(dialogueIndex, actionIndex, { positions });
  };

  const updateBoardActionMarkMeta = (
    dialogueIndex: number,
    actionIndex: number,
    updates: Partial<Extract<BoardAction, { type: "mark" }>>,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    updateBoardActionInArray(dialogueIndex, actionIndex, updates);
  };

  // ===== Line アクション用 =====
  const updateBoardActionLine = (
    dialogueIndex: number,
    actionIndex: number,
    updates: Partial<Extract<BoardAction, { type: "line" }>>,
  ): void => {
    const section = getCurrentSection();
    if (!section) {
      return;
    }

    const dialogue = section.dialogues[dialogueIndex];
    if (!dialogue || !dialogue.boardActions[actionIndex]) {
      return;
    }

    updateBoardActionInArray(dialogueIndex, actionIndex, updates);
  };

  // ===== タイプ変更 =====
  const updateBoardActionType = (
    dialogueIndex: number,
    actionIndex: number,
    newType: BoardAction["type"],
  ): void => {
    const newAction = createBoardAction(newType);
    updateBoardActionInArray(dialogueIndex, actionIndex, newAction);
  };

  return {
    createBoardAction,
    addBoardAction,
    removeBoardAction,
    moveBoardAction,
    updateBoardActionInArray,
    updateBoardActionPosition,
    updateBoardActionColor,
    updateBoardActionHighlight,
    updateBoardActionBoard,
    addBoardActionMarkPosition,
    updateBoardActionMarkPosition,
    removeBoardActionMarkPosition,
    updateBoardActionMarkMeta,
    updateBoardActionLine,
    updateBoardActionType,
  };
}
