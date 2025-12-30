/**
 * 連珠のルール判定ロジック
 */

import type {
  BoardState,
  ForbiddenMoveResult,
  PatternRecognition,
  Position,
  StoneColor,
} from "@/types/game";

// 8方向のベクトル（上、右上、右、右下、下、左下、左、左上）
const DIRECTIONS = [
  { dc: 0, dr: -1 }, // 上
  { dc: 1, dr: -1 }, // 右上
  { dc: 1, dr: 0 }, // 右
  { dc: 1, dr: 1 }, // 右下
  { dc: 0, dr: 1 }, // 下
  { dc: -1, dr: 1 }, // 左下
  { dc: -1, dr: 0 }, // 左
  { dc: -1, dr: -1 }, // 左上
];

// 4方向のペア（縦、横、斜め右、斜め左）
const DIRECTION_PAIRS = [
  [0, 4], // 縦
  [2, 6], // 横
  [1, 5], // 斜め右
  [3, 7], // 斜め左
];

/**
 * 指定位置が盤面内かチェック
 * @returns 位置が盤面内であればtrue
 */
export function isValidPosition(row: number, col: number): boolean {
  return row >= 0 && row < 15 && col >= 0 && col < 15;
}

/**
 * 指定方向に連続する石の数をカウント
 * @returns 連続する石の数
 */
function countStones(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: StoneColor,
): number {
  let count = 0;
  let r = row + dr;
  let c = col + dc;

  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  return count;
}

/**
 * 指定位置に石を置いた場合の連続数を取得（両方向）
 * @returns 両方向の連続数合計
 */
function getLineLength(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: StoneColor,
): number {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  const count1 = countStones(board, row, col, dir1.dr, dir1.dc, color);
  const count2 = countStones(board, row, col, dir2.dr, dir2.dc, color);

  return count1 + count2 + 1; // +1は自分自身
}

/**
 * 五連をチェック
 * @returns 五連が成立する場合true
 */
export function checkFive(
  board: BoardState,
  row: number,
  col: number,
  color: StoneColor,
): boolean {
  for (let i = 0; i < 4; i++) {
    const pair = DIRECTION_PAIRS[i];
    if (!pair) {
      continue;
    }
    const [dir1Index] = pair;
    const length = getLineLength(board, row, col, dir1Index, color);
    if (length === 5) {
      return true;
    }
  }
  return false;
}

/**
 * 長連（6個以上の連）をチェック
 */
function checkOverline(board: BoardState, row: number, col: number): boolean {
  for (let i = 0; i < 4; i++) {
    const [dir1Index] = DIRECTION_PAIRS[i];
    const length = getLineLength(board, row, col, dir1Index, "black");
    if (length >= 6) {
      return true;
    }
  }
  return false;
}

/**
 * 指定方向の活三・四をチェック
 * @returns 活三・活四・四の判定結果
 */
function checkOpenPattern(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: StoneColor,
): { open3: boolean; open4: boolean; four: boolean } {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  // 仮想的に石を置く
  const testBoard = board.map((r: StoneColor[]) => [...r]);
  testBoard[row][col] = color;

  // 両方向の連続数と端の状態をチェック
  let count1 = 0;
  let r1 = row + dir1.dr;
  let c1 = col + dir1.dc;
  while (isValidPosition(r1, c1) && testBoard[r1][c1] === color) {
    count1++;
    r1 += dir1.dr;
    c1 += dir1.dc;
  }
  const end1Open = isValidPosition(r1, c1) && testBoard[r1][c1] === null;

  let count2 = 0;
  let r2 = row + dir2.dr;
  let c2 = col + dir2.dc;
  while (isValidPosition(r2, c2) && testBoard[r2][c2] === color) {
    count2++;
    r2 += dir2.dr;
    c2 += dir2.dc;
  }
  const end2Open = isValidPosition(r2, c2) && testBoard[r2][c2] === null;

  const total = count1 + count2 + 1;

  // 四のチェック
  const four = total === 4 && (end1Open || end2Open);

  // 活四のチェック（両端が開いている4連）
  const open4 = total === 4 && end1Open && end2Open;

  // 活三のチェック（両端が開いている3連で、次に4になれる）
  const open3 = total === 3 && end1Open && end2Open;

  return { four, open3, open4 };
}

/**
 * 三三をチェック（2つ以上の活三ができるか）
 * @returns 三三の禁じ手に該当する場合true
 */
function checkDoubleThree(
  board: BoardState,
  row: number,
  col: number,
): boolean {
  let open3Count = 0;

  for (let i = 0; i < 4; i++) {
    const [dir1Index] = DIRECTION_PAIRS[i];
    const pattern = checkOpenPattern(board, row, col, dir1Index, "black");
    if (pattern.open3) {
      open3Count++;
    }
  }

  return open3Count >= 2;
}

/**
 * 四四をチェック（2つ以上の四ができるか）
 * @returns 四四の禁じ手に該当する場合true
 */
function checkDoubleFour(board: BoardState, row: number, col: number): boolean {
  let fourCount = 0;

  for (let i = 0; i < 4; i++) {
    const [dir1Index] = DIRECTION_PAIRS[i];
    const pattern = checkOpenPattern(board, row, col, dir1Index, "black");
    if (pattern.four) {
      fourCount++;
    }
  }

  return fourCount >= 2;
}

/**
 * 禁じ手判定（黒石のみ）
 * @returns 禁じ手判定の結果
 */
export function checkForbiddenMove(
  board: BoardState,
  row: number,
  col: number,
): ForbiddenMoveResult {
  // 空いている場所でない場合はチェック不要
  if (board[row]?.[col] !== null) {
    return { isForbidden: false, type: null };
  }

  // 五連ができる手は禁じ手ではない
  if (checkFive(board, row, col, "black")) {
    return { isForbidden: false, type: null };
  }

  // 長連チェック
  if (checkOverline(board, row, col)) {
    return {
      isForbidden: true,
      positions: [{ col, row }],
      type: "overline",
    };
  }

  // 四四チェック
  if (checkDoubleFour(board, row, col)) {
    return {
      isForbidden: true,
      positions: [{ col, row }],
      type: "double-four",
    };
  }

  // 三三チェック
  if (checkDoubleThree(board, row, col)) {
    return {
      isForbidden: true,
      positions: [{ col, row }],
      type: "double-three",
    };
  }

  return { isForbidden: false, type: null };
}

/**
 * 勝利判定
 * @returns 勝利条件を満たす場合true
 */
export function checkWin(
  board: BoardState,
  lastMove: Position,
  color: StoneColor,
): boolean {
  return checkFive(board, lastMove.row, lastMove.col, color);
}

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
    const [dir1Index] = DIRECTION_PAIRS[i];
    const pattern = checkOpenPattern(board, row, col, dir1Index, color);
    const length = getLineLength(board, row, col, dir1Index, color);

    if (length === 5) {
      patterns.push({
        direction: directionNames[i],
        positions: [{ col, row }],
        type: "five",
      });
    } else if (length >= 6) {
      patterns.push({
        direction: directionNames[i],
        positions: [{ col, row }],
        type: "overline",
      });
    } else if (pattern.open4) {
      patterns.push({
        direction: directionNames[i],
        positions: [{ col, row }],
        type: "open-four",
      });
    } else if (pattern.open3) {
      patterns.push({
        direction: directionNames[i],
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

/**
 * 空の盤面を生成
 * @returns 空の盤面状態
 */
export function createEmptyBoard(): BoardState {
  return new Array(15).fill(null).map(() => new Array(15).fill(null));
}

/**
 * 盤面をコピー
 * @returns コピーされた盤面状態
 */
export function copyBoard(board: BoardState): BoardState {
  return board.map((row: StoneColor[]) => [...row]);
}
