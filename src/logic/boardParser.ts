import type { BoardState, StoneColor } from "@/types/game";

/**
 * 配列形式の盤面テキストをBoardStateに変換します
 * - : 空白（null）
 * x : 黒石（black）
 * o : 白石（white）
 * @param boardLines 配列形式の盤面（15行×15列、各要素は15文字）
 * @returns 盤面状態
 */
export function parseInitialBoard(boardLines: string[]): BoardState {
  if (boardLines.length !== 15) {
    throw new Error(
      `盤面は15行である必要があります。受け取った行数: ${boardLines.length}`,
    );
  }

  const board: BoardState = [];

  for (let i = 0; i < 15; i++) {
    const line = boardLines[i];

    if (line.length !== 15) {
      throw new Error(
        `行${i}は15文字である必要があります。受け取った文字数: ${line.length}`,
      );
    }

    const row: StoneColor[] = [];
    for (let j = 0; j < 15; j++) {
      const char = line[j];
      let stone: StoneColor = null;

      if (char === "-") {
        stone = null;
      } else if (char === "x") {
        stone = "black";
      } else if (char === "o") {
        stone = "white";
      } else {
        throw new Error(
          `無効な文字が含まれています。行${i}列${j}: ${char}（有効: -, x, o）`,
        );
      }

      row.push(stone);
    }

    board.push(row);
  }

  return board;
}
