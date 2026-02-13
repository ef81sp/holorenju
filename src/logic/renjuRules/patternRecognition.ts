/**
 * パターン認識: 活三・活四・五連などのパターンを認識して返す
 */

import type { BoardState, PatternRecognition, StoneColor } from "@/types/game";

import { DIRECTION_PAIRS, getLineLength } from "./core";
import { checkOpenPattern } from "./patterns";

/**
 * パターン認識（活三・活四など）
 * @returns 認識されたパターンの配列
 */
export function recognizePattern(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): PatternRecognition[] {
  const patterns: PatternRecognition[] = [];

  const directionNames = [
    "vertical",
    "horizontal",
    "diagonal-right",
    "diagonal-left",
  ] as const;

  for (let i = 0; i < 4; i++) {
    const pair = DIRECTION_PAIRS[i];
    const dir1Index = pair?.[0];
    const dirName = directionNames[i];
    if (dir1Index === undefined || !dirName) {
      continue;
    }
    const pattern = checkOpenPattern(board, row, col, dir1Index, color);
    const length = getLineLength(board, row, col, dir1Index, color);

    if (length === 5) {
      patterns.push({
        direction: dirName,
        positions: [{ col, row }],
        type: "five",
      });
    } else if (length >= 6) {
      patterns.push({
        direction: dirName,
        positions: [{ col, row }],
        type: "overline",
      });
    } else if (pattern.open4) {
      patterns.push({
        direction: dirName,
        positions: [{ col, row }],
        type: "open-four",
      });
    } else if (pattern.open3) {
      patterns.push({
        direction: dirName,
        positions: [{ col, row }],
        type: "open-three",
      });
    }
  }

  // 四三のチェック
  const has4 = patterns.some(
    (p) => p.type === "open-four" || p.type === "four-three",
  );
  const has3 = patterns.some((p) => p.type === "open-three");

  if (has4 && has3) {
    patterns.push({
      direction: "horizontal",
      positions: [{ col, row }],
      type: "four-three", // ダミー
    });
  }

  return patterns;
}
