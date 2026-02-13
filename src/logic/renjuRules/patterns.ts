/**
 * パターン判定: 活三・活四・飛び三・飛び四・達四の検出
 */

import type { BoardState, Position, StoneColor } from "@/types/game";

// パフォーマンス最適化: ホットパスで高頻度に呼ばれるため、
// モジュール境界を越えないようにインライン定義（core.tsと同一の定義）
const DIRECTIONS = [
  { dc: 0, dr: -1 },
  { dc: 1, dr: -1 },
  { dc: 1, dr: 0 },
  { dc: 1, dr: 1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: -1, dr: -1 },
];

function isValidPosition(row: number, col: number): boolean {
  return row >= 0 && row < 15 && col >= 0 && col < 15;
}

/**
 * 指定方向の活三・四をチェック
 * @returns 活三・活四・四の判定結果
 */
export function checkOpenPattern(
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

  // 仮想的に石を置く（Undo方式: 盤面コピーなし）
  const boardRow = board[row];
  const originalValue = boardRow?.[col];
  if (boardRow) {
    boardRow[col] = color;
  }

  // 両方向の連続数と端の状態をチェック
  let count1 = 0;
  let r1 = row + dir1.dr;
  let c1 = col + dir1.dc;
  while (isValidPosition(r1, c1) && board[r1]?.[c1] === color) {
    count1++;
    r1 += dir1.dr;
    c1 += dir1.dc;
  }
  const end1Open = isValidPosition(r1, c1) && board[r1]?.[c1] === null;

  let count2 = 0;
  let r2 = row + dir2.dr;
  let c2 = col + dir2.dc;
  while (isValidPosition(r2, c2) && board[r2]?.[c2] === color) {
    count2++;
    r2 += dir2.dr;
    c2 += dir2.dc;
  }
  const end2Open = isValidPosition(r2, c2) && board[r2]?.[c2] === null;

  // 石を元に戻す
  if (boardRow) {
    boardRow[col] = originalValue ?? null;
  }

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

  // 仮想的に石を置く（Undo方式: 盤面コピーなし）
  const boardRow = board[row];
  const originalValue = boardRow?.[col];
  if (boardRow) {
    boardRow[col] = color;
  }

  // 両方向の連続数と端の位置をチェック
  let count1 = 0;
  let r1 = row + dir1.dr;
  let c1 = col + dir1.dc;
  while (isValidPosition(r1, c1) && board[r1]?.[c1] === color) {
    count1++;
    r1 += dir1.dr;
    c1 += dir1.dc;
  }

  let count2 = 0;
  let r2 = row + dir2.dr;
  let c2 = col + dir2.dc;
  while (isValidPosition(r2, c2) && board[r2]?.[c2] === color) {
    count2++;
    r2 += dir2.dr;
    c2 += dir2.dc;
  }

  const total = count1 + count2 + 1;

  // 石を元に戻す
  if (boardRow) {
    boardRow[col] = originalValue ?? null;
  }

  if (total !== 3) {
    return [];
  }

  const points: Position[] = [];

  // 端1が空いていれば達四点
  if (isValidPosition(r1, c1) && board[r1]?.[c1] === null) {
    points.push({ row: r1, col: c1 });
  }

  // 端2が空いていれば達四点
  if (isValidPosition(r2, c2) && board[r2]?.[c2] === null) {
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

  // 仮想的に石を置く（Undo方式: 盤面コピーなし）
  const boardRow = board[row];
  const originalValue = boardRow?.[col];
  if (boardRow) {
    boardRow[col] = color;
  }

  // ラインを取得（置いた位置を中心に両方向に5マスずつ）
  const lineStones: (StoneColor | "out")[] = [];
  const linePositions: (Position | null)[] = [];

  // dir2方向（負の方向）に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row + dir2.dr * i;
    const pc = col + dir2.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(board[pr]?.[pc] ?? null);
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
      lineStones.push(board[pr]?.[pc] ?? null);
      linePositions.push({ row: pr, col: pc });
    } else {
      lineStones.push("out");
      linePositions.push(null);
    }
  }

  // 石を元に戻す
  if (boardRow) {
    boardRow[col] = originalValue ?? null;
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
 * 達四点に仮置きして、その方向の四が達四（両端で五を作れる四）かどうかを検証
 *
 * 達四の条件: 4連 + 両端空き + 両端の先に同色石がない（あると長連になる）
 * 止め四: 片端の先に同色石があり、その端に打つと長連（6連以上）になる
 *
 * @param board 盤面（元の石が既に仮置きされた状態で呼ぶ）
 * @param row 達四点の行
 * @param col 達四点の列
 * @param dirIndex 三の方向インデックス
 * @returns 達四になるならtrue、止め四ならfalse。4連でない場合はtrue（既存ロジックに委ねる）
 */
export function checkStraightFour(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
): boolean {
  const dir1 = DIRECTIONS[dirIndex];
  const dir2 = DIRECTIONS[(dirIndex + 4) % 8];

  if (!dir1 || !dir2) {
    return false;
  }

  // 達四点に仮置き
  const boardRow = board[row];
  const originalValue = boardRow?.[col];
  if (boardRow) {
    boardRow[col] = "black";
  }

  // 両方向の連続数をカウント
  let count1 = 0;
  let r1 = row + dir1.dr;
  let c1 = col + dir1.dc;
  while (isValidPosition(r1, c1) && board[r1]?.[c1] === "black") {
    count1++;
    r1 += dir1.dr;
    c1 += dir1.dc;
  }

  let count2 = 0;
  let r2 = row + dir2.dr;
  let c2 = col + dir2.dc;
  while (isValidPosition(r2, c2) && board[r2]?.[c2] === "black") {
    count2++;
    r2 += dir2.dr;
    c2 += dir2.dc;
  }

  const total = count1 + count2 + 1;

  // 仮置きを元に戻す
  if (boardRow) {
    boardRow[col] = originalValue ?? null;
  }

  // 4連でない場合は既存ロジックに委ねる
  if (total !== 4) {
    return true;
  }

  // 両端が空いているかチェック
  const end1Open = isValidPosition(r1, c1) && board[r1]?.[c1] === null;
  const end2Open = isValidPosition(r2, c2) && board[r2]?.[c2] === null;

  if (!end1Open || !end2Open) {
    return false;
  }

  // 両端の先に黒石がないかチェック（あると長連になる）
  const beyond1r = r1 + dir1.dr;
  const beyond1c = c1 + dir1.dc;
  if (
    isValidPosition(beyond1r, beyond1c) &&
    board[beyond1r]?.[beyond1c] === "black"
  ) {
    return false;
  }

  const beyond2r = r2 + dir2.dr;
  const beyond2c = c2 + dir2.dc;
  if (
    isValidPosition(beyond2r, beyond2c) &&
    board[beyond2r]?.[beyond2c] === "black"
  ) {
    return false;
  }

  return true;
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

  // 仮想的に石を置く（Undo方式: 盤面コピーなし）
  const boardRow = board[row];
  const originalValue = boardRow?.[col];
  if (boardRow) {
    boardRow[col] = color;
  }

  // 置いた後、その方向のライン全体をスキャンして飛び三パターンを探す
  // ラインを取得（置いた位置を中心に両方向に5マスずつ、合計11マス）
  const lineStones: (StoneColor | "out")[] = [];

  // dir2方向（負の方向）に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row + dir2.dr * i;
    const pc = col + dir2.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(board[pr]?.[pc] ?? null);
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
      lineStones.push(board[pr]?.[pc] ?? null);
    } else {
      lineStones.push("out");
    }
  }

  // 石を元に戻す
  if (boardRow) {
    boardRow[col] = originalValue ?? null;
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

  // 仮想的に石を置く（Undo方式: 盤面コピーなし）
  const boardRow = board[row];
  const originalValue = boardRow?.[col];
  if (boardRow) {
    boardRow[col] = color;
  }

  // ラインを取得（置いた位置を中心に両方向に5マスずつ）
  const lineStones: (StoneColor | "out")[] = [];

  // dir2方向（負の方向）に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row + dir2.dr * i;
    const pc = col + dir2.dc * i;
    if (isValidPosition(pr, pc)) {
      lineStones.push(board[pr]?.[pc] ?? null);
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
      lineStones.push(board[pr]?.[pc] ?? null);
    } else {
      lineStones.push("out");
    }
  }

  // 石を元に戻す
  if (boardRow) {
    boardRow[col] = originalValue ?? null;
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
