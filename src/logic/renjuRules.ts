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

import {
  incrementBoardCopies,
  incrementForbiddenCheckCalls,
} from "@/logic/cpu/profiling/counters";

// =============================================================================
// 引き分けルール
// =============================================================================

/** 引き分けとなる手数上限（ゲームルールとして定義） */
export const DRAW_MOVE_LIMIT = 70;

/**
 * 引き分け判定
 *
 * 総手数が上限に達したら引き分けとする
 *
 * @param moveCount 現在の総手数
 * @returns 引き分けならtrue
 */
export function checkDraw(moveCount: number): boolean {
  return moveCount >= DRAW_MOVE_LIMIT;
}

/**
 * 禁手判定の再帰的コンテキスト
 * - inProgress: 現在判定中の点のSet（循環参照検出用）
 * - cache: 計算済みの禁手判定結果のキャッシュ
 */
interface ForbiddenCheckContext {
  inProgress: Set<string>;
  cache: Map<string, ForbiddenMoveResult>;
}

/** 位置をキー文字列に変換 */
function positionToKey(row: number, col: number): string {
  return `${row},${col}`;
}

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

  if (!dir1 || !dir2) {
    return 0;
  }

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
    if (dir1Index === undefined) {
      continue;
    }
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
    const pair = DIRECTION_PAIRS[i];
    const dir1Index = pair?.[0];
    if (dir1Index === undefined) {
      continue;
    }
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

  if (!dir1 || !dir2) {
    return { open3: false, open4: false, four: false };
  }

  // 仮想的に石を置く
  const testBoard = board.map((r: StoneColor[]) => [...r]);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 両方向の連続数と端の状態をチェック
  let count1 = 0;
  let r1 = row + dir1.dr;
  let c1 = col + dir1.dc;
  while (isValidPosition(r1, c1) && testBoard[r1]?.[c1] === color) {
    count1++;
    r1 += dir1.dr;
    c1 += dir1.dc;
  }
  const end1Open = isValidPosition(r1, c1) && testBoard[r1]?.[c1] === null;

  let count2 = 0;
  let r2 = row + dir2.dr;
  let c2 = col + dir2.dc;
  while (isValidPosition(r2, c2) && testBoard[r2]?.[c2] === color) {
    count2++;
    r2 += dir2.dr;
    c2 += dir2.dc;
  }
  const end2Open = isValidPosition(r2, c2) && testBoard[r2]?.[c2] === null;

  const total = count1 + count2 + 1;

  // 四のチェック
  const four = total === 4 && (end1Open || end2Open);

  // 活四のチェック（両端が開いている4連）
  const open4 = total === 4 && end1Open && end2Open;

  // 活三のチェック（両端が開いている3連で、次に4になれる）
  const open3 = total === 3 && end1Open && end2Open;

  return { four, open3, open4 };
}

/** 三の情報 */
interface ThreeInfo {
  directionIndex: number;
  type: "consecutive" | "jump";
  straightFourPoints: Position[];
}

/**
 * 連続三の達四点（両端の空きマス）を取得
 * 連続三: ・●●●・ → 達四点は左右両端の空きマス
 *
 * @param board 盤面
 * @param row 石を置く行
 * @param col 石を置く列
 * @param dirIndex 方向インデックス
 * @returns 達四点の配列
 */
export function getConsecutiveThreeStraightFourPoints(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white" = "black",
): Position[] {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  if (!dir1 || !dir2) {
    return [];
  }

  // 仮想的に石を置く
  const testBoard = board.map((r: StoneColor[]) => [...r]);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 両方向の連続数と端の位置をチェック
  let count1 = 0;
  let r1 = row + dir1.dr;
  let c1 = col + dir1.dc;
  while (isValidPosition(r1, c1) && testBoard[r1]?.[c1] === color) {
    count1++;
    r1 += dir1.dr;
    c1 += dir1.dc;
  }

  let count2 = 0;
  let r2 = row + dir2.dr;
  let c2 = col + dir2.dc;
  while (isValidPosition(r2, c2) && testBoard[r2]?.[c2] === color) {
    count2++;
    r2 += dir2.dr;
    c2 += dir2.dc;
  }

  const total = count1 + count2 + 1;
  if (total !== 3) {
    return [];
  }

  const points: Position[] = [];

  // 端1が空いていれば達四点
  if (isValidPosition(r1, c1) && testBoard[r1]?.[c1] === null) {
    points.push({ row: r1, col: c1 });
  }

  // 端2が空いていれば達四点
  if (isValidPosition(r2, c2) && testBoard[r2]?.[c2] === null) {
    points.push({ row: r2, col: c2 });
  }

  return points;
}

/**
 * 飛び三の達四点（飛びの空きマス）を取得
 * 飛び三: ・●●・●・ または ・●・●●・ → 達四点は飛びの空きマス（1点のみ）
 *
 * @param board 盤面
 * @param row 石を置く行
 * @param col 石を置く列
 * @param dirIndex 方向インデックス
 * @returns 達四点の配列（0または1点）
 */
export function getJumpThreeStraightFourPoints(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white" = "black",
): Position[] {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  if (!dir1 || !dir2) {
    return [];
  }

  // 仮想的に石を置く
  const testBoard = board.map((r: StoneColor[]) => [...r]);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // ラインを取得（置いた位置を中心に両方向に5マスずつ）
  const lineStones: (StoneColor | "out")[] = [];
  const linePositions: (Position | null)[] = [];

  // dir2方向（負の方向）に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row + dir2.dr * i;
    const pc = col + dir2.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(testBoard[pr]?.[pc] ?? null);
      linePositions.push({ row: pr, col: pc });
    } else {
      lineStones.push("out");
      linePositions.push(null);
    }
  }

  // 置いた位置（インデックス5）
  lineStones.push(color);
  linePositions.push({ row, col });

  // dir1方向（正の方向）に5マス
  for (let i = 1; i <= 5; i++) {
    const pr = row + dir1.dr * i;
    const pc = col + dir1.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(testBoard[pr]?.[pc] ?? null);
      linePositions.push({ row: pr, col: pc });
    } else {
      lineStones.push("out");
      linePositions.push(null);
    }
  }

  const placedIndex = 5;

  // 飛び三パターン1: ・●●・●・ (空白, 2石, 空白, 1石, 空白)
  // 達四点は [startIdx+2] の位置（飛びの空き）
  for (const offset of [-1, 0]) {
    const startIdx = placedIndex + offset;
    if (
      lineStones[startIdx - 1] === null &&
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === color &&
      lineStones[startIdx + 2] === null &&
      lineStones[startIdx + 3] === color &&
      lineStones[startIdx + 4] === null
    ) {
      if (placedIndex >= startIdx && placedIndex <= startIdx + 3) {
        const pos = linePositions[startIdx + 2];
        if (pos) {
          return [pos];
        }
      }
    }
  }

  // 飛び三パターン2: ・●・●●・ (空白, 1石, 空白, 2石, 空白)
  // 達四点は [startIdx+1] の位置（飛びの空き）
  for (const offset of [-3, -2, 0]) {
    const startIdx = placedIndex + offset;
    if (
      lineStones[startIdx - 1] === null &&
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === null &&
      lineStones[startIdx + 2] === color &&
      lineStones[startIdx + 3] === color &&
      lineStones[startIdx + 4] === null
    ) {
      if (
        placedIndex === startIdx ||
        placedIndex === startIdx + 2 ||
        placedIndex === startIdx + 3
      ) {
        const pos = linePositions[startIdx + 1];
        if (pos) {
          return [pos];
        }
      }
    }
  }

  return [];
}

/**
 * 指定方向の飛び三パターンをチェック
 *
 * 飛び三とは: 1つの空きを含む3石のパターンで、次に達四（両端開の4連）を作れる形
 * - ・●●・●・ 型: 2連 + 空き + 1石（空きに置くと達四）
 * - ・●・●●・ 型: 1石 + 空き + 2連（空きに置くと達四）
 *
 * 置いた後にこの形になれば「飛び三を作った」ことになる
 */
export function checkJumpThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white",
): boolean {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  if (!dir1 || !dir2) {
    return false;
  }

  // 仮想的に石を置く
  const testBoard = board.map((r: StoneColor[]) => [...r]);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // 置いた後、その方向のライン全体をスキャンして飛び三パターンを探す
  // ラインを取得（置いた位置を中心に両方向に5マスずつ、合計11マス）
  const lineStones: (StoneColor | "out")[] = [];

  // dir2方向（負の方向）に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row + dir2.dr * i;
    const pc = col + dir2.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(testBoard[pr]?.[pc] ?? null);
    } else {
      lineStones.push("out");
    }
  }

  // 置いた位置（インデックス5）
  lineStones.push(color);

  // dir1方向（正の方向）に5マス
  for (let i = 1; i <= 5; i++) {
    const pr = row + dir1.dr * i;
    const pc = col + dir1.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(testBoard[pr]?.[pc] ?? null);
    } else {
      lineStones.push("out");
    }
  }

  // ライン内で飛び三パターンを探す
  // パターン: ・●●・●・ または ・●・●●・
  // 置いた位置を含む飛び三を探す

  const placedIndex = 5; // 置いた位置のインデックス

  // 飛び三パターン1: ・●●・●・ (空白, 2石, 空白, 1石, 空白)
  // 置いた位置が2石のどちらかになるパターン
  for (const offset of [-1, 0]) {
    // 置いた位置が2石の先頭(offset=0)または2番目(offset=-1)
    const startIdx = placedIndex + offset;
    // パターン: [startIdx-1]=空, [startIdx]=石, [startIdx+1]=石, [startIdx+2]=空, [startIdx+3]=石, [startIdx+4]=空
    if (
      lineStones[startIdx - 1] === null &&
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === color &&
      lineStones[startIdx + 2] === null &&
      lineStones[startIdx + 3] === color &&
      lineStones[startIdx + 4] === null
    ) {
      // 置いた位置がこのパターンに含まれているか
      if (placedIndex >= startIdx && placedIndex <= startIdx + 3) {
        return true;
      }
    }
  }

  // 飛び三パターン2: ・●・●●・ (空白, 1石, 空白, 2石, 空白)
  // 置いた位置が1石または2石のどれかになるパターン
  for (const offset of [-3, -2, 0]) {
    // 置いた位置が1石(offset=0)、2石の先頭(offset=-3)、2石の2番目(offset=-2)
    const startIdx = placedIndex + offset;
    // パターン: [startIdx-1]=空, [startIdx]=石, [startIdx+1]=空, [startIdx+2]=石, [startIdx+3]=石, [startIdx+4]=空
    if (
      lineStones[startIdx - 1] === null &&
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === null &&
      lineStones[startIdx + 2] === color &&
      lineStones[startIdx + 3] === color &&
      lineStones[startIdx + 4] === null
    ) {
      // 置いた位置がこのパターンに含まれているか
      if (
        placedIndex === startIdx ||
        placedIndex === startIdx + 2 ||
        placedIndex === startIdx + 3
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 三が「本物の三」かどうかを検証
 * 達四点（三を達四にできる点）のいずれかが禁点でなければ、三として有効
 * すべての達四点が禁点なら「ウソの三」として無効
 *
 * @param board 盤面
 * @param straightFourPoints 達四点の配列
 * @param context 再帰的判定コンテキスト
 * @returns 三が有効ならtrue
 */
function isValidThree(
  board: BoardState,
  straightFourPoints: Position[],
  context: ForbiddenCheckContext,
): boolean {
  // 達四点がなければ無効
  if (straightFourPoints.length === 0) {
    return false;
  }

  // いずれかの達四点が禁点でなければ有効
  for (const pos of straightFourPoints) {
    const result = checkForbiddenMoveRecursive(
      board,
      pos.row,
      pos.col,
      context,
    );
    if (!result.isForbidden) {
      return true;
    }
  }

  // すべての達四点が禁点なら無効（ウソの三）
  return false;
}

/**
 * 三三をチェック（2つ以上の活三ができるか）
 * 連続三と飛び三の両方をカウント
 * ウソの三（達四点がすべて禁点）は三としてカウントしない
 *
 * @returns 三三の禁じ手に該当する場合true
 */
function checkDoubleThree(
  board: BoardState,
  row: number,
  col: number,
  context: ForbiddenCheckContext,
): boolean {
  const threes: ThreeInfo[] = [];

  for (let i = 0; i < 4; i++) {
    const pair = DIRECTION_PAIRS[i];
    const dir1Index = pair?.[0];
    if (dir1Index === undefined) {
      continue;
    }

    // 連続三をチェック
    const pattern = checkOpenPattern(board, row, col, dir1Index, "black");
    if (pattern.open3) {
      const straightFourPoints = getConsecutiveThreeStraightFourPoints(
        board,
        row,
        col,
        dir1Index,
      );
      threes.push({
        directionIndex: dir1Index,
        type: "consecutive",
        straightFourPoints,
      });
    }

    // 飛び三をチェック（連続三がない場合のみ）
    if (!pattern.open3 && checkJumpThree(board, row, col, dir1Index, "black")) {
      const straightFourPoints = getJumpThreeStraightFourPoints(
        board,
        row,
        col,
        dir1Index,
      );
      threes.push({
        directionIndex: dir1Index,
        type: "jump",
        straightFourPoints,
      });
    }
  }

  // 三が2つ未満なら三々ではない
  if (threes.length < 2) {
    return false;
  }

  // ウソの三を除外して有効な三をカウント
  let validThreeCount = 0;
  for (const three of threes) {
    if (isValidThree(board, three.straightFourPoints, context)) {
      validThreeCount++;
    }
  }

  return validThreeCount >= 2;
}

/**
 * 再帰的な禁手判定（循環参照検出付き）
 *
 * @param board 盤面
 * @param row 行
 * @param col 列
 * @param context 再帰的判定コンテキスト
 * @returns 禁手判定結果
 */
function checkForbiddenMoveRecursive(
  board: BoardState,
  row: number,
  col: number,
  context: ForbiddenCheckContext,
): ForbiddenMoveResult {
  const key = positionToKey(row, col);

  // 循環参照検出: 現在判定中の点なら「禁点ではない」として扱う（否三々）
  if (context.inProgress.has(key)) {
    return { isForbidden: false, type: null };
  }

  // キャッシュ確認
  const cached = context.cache.get(key);
  if (cached) {
    return cached;
  }

  // 判定中としてマーク
  context.inProgress.add(key);

  // 禁手判定を実行
  const result = checkForbiddenMoveInternal(board, row, col, context);

  // 判定完了
  context.inProgress.delete(key);

  // キャッシュに保存
  context.cache.set(key, result);

  return result;
}

/**
 * 禁手判定の内部実装
 */
function checkForbiddenMoveInternal(
  board: BoardState,
  row: number,
  col: number,
  context: ForbiddenCheckContext,
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

  // 三三チェック（コンテキスト付き）
  if (checkDoubleThree(board, row, col, context)) {
    return {
      isForbidden: true,
      positions: [{ col, row }],
      type: "double-three",
    };
  }

  return { isForbidden: false, type: null };
}

/** 四の情報 */
interface FourInfo {
  directionIndex: number;
  type: "consecutive" | "jump";
}

/**
 * 指定方向の飛び四パターンをチェック
 *
 * 飛び四とは: 1つの空きを含む4石のパターンで、空きを埋めると五連になる形
 * - ●●●・● 型: 3連 + 空き + 1石
 * - ●●・●● 型: 2連 + 空き + 2連
 * - ●・●●● 型: 1石 + 空き + 3連
 *
 * 置いた後にこの形になれば「飛び四を作った」ことになる
 */
export function checkJumpFour(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: StoneColor,
): boolean {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  if (!dir1 || !dir2) {
    return false;
  }

  // 仮想的に石を置く
  const testBoard = board.map((r: StoneColor[]) => [...r]);
  const testRow = testBoard[row];
  if (testRow) {
    testRow[col] = color;
  }

  // ラインを取得（置いた位置を中心に両方向に5マスずつ）
  const lineStones: (StoneColor | "out")[] = [];

  // dir2方向（負の方向）に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row + dir2.dr * i;
    const pc = col + dir2.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(testBoard[pr]?.[pc] ?? null);
    } else {
      lineStones.push("out");
    }
  }

  // 置いた位置（インデックス5）
  lineStones.push(color);

  // dir1方向（正の方向）に5マス
  for (let i = 1; i <= 5; i++) {
    const pr = row + dir1.dr * i;
    const pc = col + dir1.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(testBoard[pr]?.[pc] ?? null);
    } else {
      lineStones.push("out");
    }
  }

  const placedIndex = 5;

  // 飛び四パターン1: ●●●・● (3石, 空白, 1石)
  // 置いた石の位置: 0, 1, 2, または 4（gapは3）
  for (const offset of [-4, -2, -1, 0]) {
    const startIdx = placedIndex + offset;
    // パターン: [startIdx]=色, [startIdx+1]=色, [startIdx+2]=色, [startIdx+3]=空, [startIdx+4]=色
    if (
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === color &&
      lineStones[startIdx + 2] === color &&
      lineStones[startIdx + 3] === null &&
      lineStones[startIdx + 4] === color
    ) {
      if (placedIndex >= startIdx && placedIndex <= startIdx + 4) {
        return true;
      }
    }
  }

  // 飛び四パターン2: ●●・●● (2石, 空白, 2石)
  // 置いた石の位置: 0, 1, 3, または 4（gapは2）
  for (const offset of [-4, -3, -1, 0]) {
    const startIdx = placedIndex + offset;
    // パターン: [startIdx]=色, [startIdx+1]=色, [startIdx+2]=空, [startIdx+3]=色, [startIdx+4]=色
    if (
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === color &&
      lineStones[startIdx + 2] === null &&
      lineStones[startIdx + 3] === color &&
      lineStones[startIdx + 4] === color
    ) {
      if (placedIndex >= startIdx && placedIndex <= startIdx + 4) {
        return true;
      }
    }
  }

  // 飛び四パターン3: ●・●●● (1石, 空白, 3石)
  for (const offset of [0, -2, -3, -4]) {
    const startIdx = placedIndex + offset;
    // パターン: [startIdx]=色, [startIdx+1]=空, [startIdx+2]=色, [startIdx+3]=色, [startIdx+4]=色
    if (
      lineStones[startIdx] === color &&
      lineStones[startIdx + 1] === null &&
      lineStones[startIdx + 2] === color &&
      lineStones[startIdx + 3] === color &&
      lineStones[startIdx + 4] === color
    ) {
      if (placedIndex >= startIdx && placedIndex <= startIdx + 4) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 四四をチェック（2つ以上の四ができるか）
 * 連続四と飛び四の両方をカウント
 * @returns 四四の禁じ手に該当する場合true
 */
function checkDoubleFour(board: BoardState, row: number, col: number): boolean {
  const fours: FourInfo[] = [];

  for (let i = 0; i < 4; i++) {
    const pair = DIRECTION_PAIRS[i];
    const dir1Index = pair?.[0];
    if (dir1Index === undefined) {
      continue;
    }

    // 連続四をチェック
    const pattern = checkOpenPattern(board, row, col, dir1Index, "black");
    if (pattern.four) {
      fours.push({ directionIndex: dir1Index, type: "consecutive" });
    }

    // 飛び四をチェック（連続四がない場合のみ）
    if (!pattern.four && checkJumpFour(board, row, col, dir1Index, "black")) {
      fours.push({ directionIndex: dir1Index, type: "jump" });
    }
  }

  return fours.length >= 2;
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
  // プロファイリング: 禁手判定回数をカウント
  incrementForbiddenCheckCalls();

  // 新しいコンテキストを作成して再帰的判定を開始
  const context: ForbiddenCheckContext = {
    inProgress: new Set(),
    cache: new Map(),
  };

  return checkForbiddenMoveRecursive(board, row, col, context);
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
  // プロファイリング: 盤面コピー回数をカウント
  incrementBoardCopies();
  return board.map((row: StoneColor[]) => [...row]);
}
