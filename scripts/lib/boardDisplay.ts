/**
 * ASCII盤面表示ユーティリティ
 */

import type { BoardState, Position } from "../../src/types/game.ts";
import type { MoveAnalysis } from "../types/analysis.ts";

import { createEmptyBoard } from "../../src/logic/renjuRules/index.ts";

/** セル文字を取得 */
function getCellChar(
  stone: "black" | "white" | null | undefined,
  isHighlight: boolean,
): string {
  switch (stone) {
    case "black":
      return isHighlight ? "X" : "x";
    case "white":
      return isHighlight ? "O" : "o";
    default:
      return isHighlight ? "*" : ".";
  }
}

/** 盤面表示オプション */
export interface DisplayOptions {
  /** 現在の手をハイライト */
  highlightMove?: Position;
  /** 座標を表示 */
  showCoordinates?: boolean;
  /** 手番号を表示（最後のN手） */
  showMoveNumbers?: number;
}

/**
 * 盤面をASCII表示用の文字列に変換
 */
export function boardToAscii(
  board: BoardState,
  options: DisplayOptions = {},
): string {
  const {
    highlightMove,
    showCoordinates = true,
    showMoveNumbers: _showMoveNumbers,
  } = options;
  const lines: string[] = [];

  // ヘッダー行（列座標）
  if (showCoordinates) {
    const header = `   ${"ABCDEFGHIJKLMNO".split("").join(" ")}`;
    lines.push(header);
  }

  // 盤面
  for (let row = 0; row < 15; row++) {
    const rowNum = 15 - row; // 棋譜表記では下から上
    const rowLabel = showCoordinates
      ? `${String(rowNum).padStart(2, " ")} `
      : "";

    const cells: string[] = [];
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      const isHighlight =
        highlightMove && highlightMove.row === row && highlightMove.col === col;

      const cell = getCellChar(stone, isHighlight);

      cells.push(cell);
    }

    const line = rowLabel + cells.join(" ");
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 棋譜から盤面を再現してASCII表示
 */
export function gameRecordToAscii(
  moves: MoveAnalysis[],
  upToMove: number,
  options: DisplayOptions = {},
): string {
  const board = createEmptyBoard();

  // 指定手数まで盤面を再現
  for (let i = 0; i < upToMove && i < moves.length; i++) {
    const move = moves[i];
    if (!move) {
      continue;
    }

    const row = board[move.position.row];
    if (row) {
      row[move.position.col] = move.color;
    }
  }

  // 現在の手をハイライト
  const currentMove = moves[upToMove - 1];
  const displayOptions = {
    ...options,
    highlightMove: currentMove?.position,
  };

  return boardToAscii(board, displayOptions);
}

/**
 * 盤面をエディタ互換フォーマットに変換（クリップボード用）
 *
 * フォーマット:
 * - 15行、各行15文字
 * - `-`: 空
 * - `x`: 黒石
 * - `o`: 白石
 */
export function boardToEditorFormat(board: BoardState): string {
  const lines: string[] = [];

  for (let row = 0; row < 15; row++) {
    let line = "";
    for (let col = 0; col < 15; col++) {
      const stone = board[row]?.[col];
      if (stone === "black") {
        line += "x";
      } else if (stone === "white") {
        line += "o";
      } else {
        line += "-";
      }
    }
    lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 棋譜から盤面を再現してエディタ互換フォーマットに変換
 */
export function gameRecordToEditorFormat(
  moves: MoveAnalysis[],
  upToMove: number,
): string {
  const board = createEmptyBoard();

  // 指定手数まで盤面を再現
  for (let i = 0; i < upToMove && i < moves.length; i++) {
    const move = moves[i];
    if (!move) {
      continue;
    }

    const row = board[move.position.row];
    if (row) {
      row[move.position.col] = move.color;
    }
  }

  return boardToEditorFormat(board);
}

/**
 * 対局情報のヘッダーを生成
 */
/** 勝者文字列を取得 */
function getWinnerStr(winner: "A" | "B" | "draw"): string {
  switch (winner) {
    case "A":
      return "A wins";
    case "B":
      return "B wins";
    case "draw":
    default:
      return "draw";
  }
}

export function formatGameHeader(
  gameIndex: number,
  matchup: string,
  winner: "A" | "B" | "draw",
  totalMoves: number,
  reason: string,
  gameTags: string[],
): string {
  const winnerStr = getWinnerStr(winner);

  const lines = [
    `=== Game #${gameIndex}: ${matchup} (${winnerStr}, ${totalMoves}手, ${reason}) ===`,
  ];

  if (gameTags.length > 0) {
    lines.push(`Tags: [${gameTags.join(", ")}]`);
  }

  return lines.join("\n");
}

/**
 * 手の情報を生成
 */
export function formatMoveInfo(move: MoveAnalysis, totalMoves: number): string {
  const colorStr = move.color === "black" ? "Black" : "White";
  const tagsStr = move.tags.length > 0 ? `  [${move.tags.join(", ")}]` : "";

  return `Move ${move.moveNumber}/${totalMoves}: ${colorStr} ${move.notation}${tagsStr}`;
}
