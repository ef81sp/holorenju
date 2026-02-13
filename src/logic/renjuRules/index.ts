/**
 * 連珠のルール判定ロジック
 *
 * barrel re-export: 全51の利用側は `@/logic/renjuRules` のまま変更不要
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
  isValidPosition,
} from "./core";

// patterns: 活三・活四・飛び三・飛び四・達四の検出
export {
  checkJumpFour,
  checkJumpThree,
  checkOpenPattern,
  checkStraightFour,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
} from "./patterns";

// forbiddenMoves: 禁手判定
export {
  checkForbiddenMove,
  checkForbiddenMoveWithContext,
  type ForbiddenCheckOptions,
} from "./forbiddenMoves";

// patternRecognition: パターン名称の認識
export { recognizePattern } from "./patternRecognition";
