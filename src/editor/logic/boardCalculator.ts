/**
 * 盤面計算ロジック
 * PreviewPanel とセクション分割機能で共通利用
 */

import type { BoardState, StoneColor } from "@/types/game";
import type { BoardAction, DemoDialogue } from "@/types/scenario";

import { assertNever } from "@/utils/assertNever";

/**
 * BoardState から string[] への変換
 */
export function boardStateToStringArray(state: BoardState): string[] {
  return state.map((row) =>
    row
      .map((cell) => {
        if (cell === "black") {
          return "x";
        }
        if (cell === "white") {
          return "o";
        }
        return "-";
      })
      .join(""),
  );
}

/**
 * string[] から BoardState への変換
 */
export function stringArrayToBoardState(board: string[]): BoardState {
  return board.map((line) =>
    line.split("").map((char) => {
      if (char === "x") {
        return "black" as StoneColor;
      }
      if (char === "o") {
        return "white" as StoneColor;
      }
      return null;
    }),
  );
}

/**
 * 単一アクションを適用した新しい盤面を返す
 */
export function applyBoardAction(
  action: BoardAction,
  board: BoardState,
): BoardState {
  // ミュータブルな操作を避けるため、必要に応じてコピーを作成
  switch (action.type) {
    case "place": {
      const { row, col } = action.position;
      const newBoard = board.map((r) => [...r]);
      const boardRow = newBoard[row];
      if (boardRow) {
        boardRow[col] = action.color;
      }
      return newBoard;
    }
    case "remove": {
      const { row, col } = action.position;
      const newBoard = board.map((r) => [...r]);
      const boardRow = newBoard[row];
      if (boardRow) {
        boardRow[col] = null;
      }
      return newBoard;
    }
    case "setBoard":
      return stringArrayToBoardState(action.board);
    case "resetAll":
      // 石を全て消して空の盤面にする
      return stringArrayToBoardState(Array(15).fill("-".repeat(15)));
    case "resetMarkLine":
    case "mark":
    case "line":
      // マーク・ラインは盤面に影響しない
      return board;
    default:
      assertNever(action);
  }
}

/**
 * 指定ダイアログまでのアクションを適用した盤面を計算
 * @param initialBoard セクションの初期盤面
 * @param dialogues ダイアログ配列
 * @param upToDialogueIndex この index のダイアログ終了時点の盤面を返す（-1 で初期盤面）
 * @returns 計算後の盤面（string[]）
 */
export function computeBoardAtDialogue(
  initialBoard: string[],
  dialogues: DemoDialogue[],
  upToDialogueIndex: number,
): string[] {
  let board = stringArrayToBoardState(initialBoard);

  for (let i = 0; i <= upToDialogueIndex; i++) {
    const dialogue = dialogues[i];
    if (!dialogue) {
      break;
    }

    for (const action of dialogue.boardActions) {
      board = applyBoardAction(action, board);
    }
  }

  return boardStateToStringArray(board);
}
