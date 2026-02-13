/**
 * 盤面バリデーション
 *
 * JSON編集時の盤面妥当性検証
 */

import { BOARD_SIZE } from "./parserUtils";

const VALID_BOARD_CHARS = /^[-xo]*$/; // -(未指定), x(黒), o(白)

/**
 * 盤面の妥当性を検証（JSON編集時の検証用）
 * エラーメッセージの配列を返す（複数エラーを一度に報告できる）
 */
export function validateBoardState(board: unknown[]): string[] {
  const errors: string[] = [];

  if (!Array.isArray(board)) {
    return ["Board must be an array"];
  }

  if (board.length !== BOARD_SIZE) {
    errors.push(
      `Board must have exactly ${BOARD_SIZE} rows, got ${board.length}`,
    );
  }

  board.forEach((row, rowIndex) => {
    if (typeof row !== "string") {
      errors.push(`Board[${rowIndex}] must be a string, got ${typeof row}`);
      return;
    }

    if (row.length !== BOARD_SIZE) {
      errors.push(
        `Board[${rowIndex}] must have exactly ${BOARD_SIZE} characters, got ${row.length}`,
      );
    }

    if (!VALID_BOARD_CHARS.test(row)) {
      errors.push(
        `Board[${rowIndex}] contains invalid characters. Use only '-' (unspecified), 'x' (black), 'o' (white)`,
      );
    }
  });

  return errors;
}
