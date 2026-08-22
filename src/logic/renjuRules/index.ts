/**
 * 連珠のルール判定ロジック
 *
 * barrel re-export。
 * #43 PR-6: 図形/禁手判定の TS 二重実装（patterns.ts/forbiddenMoves.ts/patternRecognition.ts）は
 * 物理削除し Zig/WASM 単一ソース（patternsAdapter/forbiddenAdapter）へ一本化。
 * ここでは core（五連・長連・盤面操作など Zig 化対象外のルール基盤）のみを公開する。
 */

// core: 定数、位置判定、盤面操作、ライン解析、五連・長連検出
export {
  checkDraw,
  checkFive,
  checkOverline,
  checkWin,
  copyBoard,
  countStones,
  createEmptyBoard,
  DIRECTION_PAIRS,
  DIRECTIONS,
  DRAW_MOVE_LIMIT,
  getLineLength,
  isFiveLength,
  isValidPosition,
} from "./core";
export type { PlayerColor } from "./core";
