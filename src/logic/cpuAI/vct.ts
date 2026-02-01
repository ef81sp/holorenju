/**
 * VCT（Victory by Continuous Threats）探索
 *
 * 三・四を連続して打つことで勝利する手順を探索する。
 * VCF（四連続）はVCTの部分集合なので、VCFがあればVCTも成立。
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import {
  checkFive,
  checkForbiddenMove,
  checkJumpFour,
  checkJumpThree,
  copyBoard,
  isValidPosition,
} from "@/logic/renjuRules";

import { isNearExistingStone } from "./moveGenerator";
import { hasVCF } from "./vcf";

/** VCT探索の最大深度 */
const VCT_MAX_DEPTH = 4;

/** VCT探索を有効にする石数の閾値（終盤のみ） */
export const VCT_STONE_THRESHOLD = 20;

/**
 * 4方向のベクトル
 */
const DIRECTIONS: [number, number][] = [
  [0, 1], // 横（右）
  [1, 0], // 縦（下）
  [1, 1], // 右下斜め
  [1, -1], // 右上斜め
];

/**
 * 4方向のペアインデックス（renjuRules.tsのDIRECTIONSに対応）
 */
const DIRECTION_INDICES = [2, 0, 3, 1] as const;

/**
 * VCT（三・四連続勝ち）が成立するかチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param depth 現在の探索深度
 * @returns VCTが成立する場合true
 */
export function hasVCT(
  board: BoardState,
  color: "black" | "white",
  depth = 0,
): boolean {
  if (depth >= VCT_MAX_DEPTH) {
    return false;
  }

  // VCFがあればVCT成立（VCF ⊂ VCT）
  if (hasVCF(board, color)) {
    return true;
  }

  // 脅威（四・活三）を作れる位置を列挙
  const threatMoves = findThreatMoves(board, color);

  for (const move of threatMoves) {
    // 脅威を作る
    const afterThreat = copyBoard(board);
    const afterThreatRow = afterThreat[move.row];
    if (afterThreatRow) {
      afterThreatRow[move.col] = color;
    }

    // 五連チェック
    if (checkFive(afterThreat, move.row, move.col, color)) {
      return true;
    }

    // 相手の防御位置を列挙
    const defensePositions = getThreatDefensePositions(
      afterThreat,
      move.row,
      move.col,
      color,
    );

    // 防御不可（活四など）= 勝利
    if (defensePositions.length === 0) {
      // 脅威が成立しているか再確認（四または活三）
      if (isThreat(afterThreat, move.row, move.col, color)) {
        return true;
      }
      continue;
    }

    // 全ての防御に対してVCTが継続できるか
    let allDefenseLeadsToVCT = true;
    for (const defensePos of defensePositions) {
      // 白番の場合、黒の防御位置が禁手ならVCT成立
      if (color === "white") {
        const forbiddenResult = checkForbiddenMove(
          afterThreat,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      // 相手が防御した後の局面
      const afterDefense = copyBoard(afterThreat);
      const opponentColor = color === "black" ? "white" : "black";
      const afterDefenseRow = afterDefense[defensePos.row];
      if (afterDefenseRow) {
        afterDefenseRow[defensePos.col] = opponentColor;
      }

      // 再帰的にVCTをチェック
      if (!hasVCT(afterDefense, color, depth + 1)) {
        allDefenseLeadsToVCT = false;
        break;
      }
    }

    if (allDefenseLeadsToVCT && defensePositions.length > 0) {
      return true;
    }
  }

  return false;
}

/**
 * 脅威（四・活三）を作れる位置を列挙
 * 四を優先的に列挙（枝刈り効率のため）
 */
function findThreatMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const fourMoves: Position[] = [];
  const openThreeMoves: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 黒の禁手チェック
      if (color === "black") {
        // 五連が作れる場合は禁手でも候補に含める
        if (checkFive(board, row, col, "black")) {
          fourMoves.push({ row, col });
          continue;
        }

        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // 仮想的に石を置く
      const testBoard = copyBoard(board);
      const testRow = testBoard[row];
      if (testRow) {
        testRow[col] = color;
      }

      // 四が作れるかチェック
      if (createsFour(testBoard, row, col, color)) {
        fourMoves.push({ row, col });
        continue;
      }

      // 活三が作れるかチェック
      if (createsOpenThree(testBoard, row, col, color)) {
        openThreeMoves.push({ row, col });
      }
    }
  }

  // 四を優先して返す
  return [...fourMoves, ...openThreeMoves];
}

/**
 * 指定位置に石を置くと四ができるかチェック
 */
function createsFour(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;

    // 連続四をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 4) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open || end2Open) {
        return true;
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
}

/**
 * 指定位置に石を置くと活三ができるかチェック
 */
function createsOpenThree(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;

    // 連続三をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open && end2Open) {
        return true;
      }
    }

    // 跳び三をチェック
    if (count !== 3 && checkJumpThree(board, row, col, dirIndex, color)) {
      return true;
    }
  }

  return false;
}

/**
 * 指定方向に連続する石の数をカウント
 */
function countLine(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): number {
  let count = 1; // 起点自身

  // 正方向
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r += dr;
    c += dc;
  }

  // 負方向
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    count++;
    r -= dr;
    c -= dc;
  }

  return count;
}

/**
 * 連の両端の状態をチェック
 */
function checkEnds(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): { end1Open: boolean; end2Open: boolean } {
  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  const end1Open = isValidPosition(r, c) && board[r]?.[c] === null;

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  const end2Open = isValidPosition(r, c) && board[r]?.[c] === null;

  return { end1Open, end2Open };
}

/**
 * 脅威が成立しているかチェック（四または活三）
 */
function isThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  return (
    createsFour(board, row, col, color) ||
    createsOpenThree(board, row, col, color)
  );
}

/**
 * 脅威に対する防御位置を取得
 *
 * - 活四: 防御不可（空配列）
 * - 止め四: 1点
 * - 活三: 両端の2点
 */
function getThreatDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const defensePositions: Position[] = [];

  for (let i = 0; i < DIRECTION_INDICES.length; i++) {
    const dirIndex = DIRECTION_INDICES[i];
    if (dirIndex === undefined) {
      continue;
    }

    const direction = DIRECTIONS[i];
    if (!direction) {
      continue;
    }
    const [dr, dc] = direction;

    // 連続四をチェック
    const count = countLine(board, row, col, dr, dc, color);
    if (count === 4) {
      const ends = getLineEnds(board, row, col, dr, dc, color);

      // 活四（両端開き）= 防御不可
      if (ends.length === 2) {
        return [];
      }

      // 止め四 = 1点で防御
      if (ends.length === 1 && ends[0]) {
        defensePositions.push(ends[0]);
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      const jumpGap = findJumpGap(board, row, col, dr, dc, color);
      if (jumpGap) {
        defensePositions.push(jumpGap);
      }
    }

    // 活三をチェック
    if (count === 3) {
      const { end1Open, end2Open } = checkEnds(board, row, col, dr, dc, color);
      if (end1Open && end2Open) {
        const ends = getLineEnds(board, row, col, dr, dc, color);
        defensePositions.push(...ends);
      }
    }

    // 跳び三をチェック
    if (count !== 3 && checkJumpThree(board, row, col, dirIndex, color)) {
      const ends = getJumpThreeDefensePositions(board, row, col, dr, dc, color);
      defensePositions.push(...ends);
    }
  }

  // 重複を除去
  const unique = new Map<string, Position>();
  for (const pos of defensePositions) {
    const key = `${pos.row},${pos.col}`;
    if (!unique.has(key)) {
      unique.set(key, pos);
    }
  }

  return Array.from(unique.values());
}

/**
 * 連の両端の位置を取得
 */
function getLineEnds(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    positions.push({ row: r, col: c });
  }

  return positions;
}

/**
 * 跳び四の空きを探す
 */
function findJumpGap(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position | null {
  // ラインをスキャンして跳び四パターンの空きを探す
  const linePositions: { pos: Position; stone: "black" | "white" | null }[] =
    [];

  // 負方向に5マス
  for (let i = 5; i >= 1; i--) {
    const pr = row - dr * i;
    const pc = col - dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 置いた位置
  linePositions.push({
    pos: { row, col },
    stone: color,
  });

  // 正方向に5マス
  for (let i = 1; i <= 5; i++) {
    const pr = row + dr * i;
    const pc = col + dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 跳び四パターンを探す
  for (let start = 0; start <= linePositions.length - 5; start++) {
    const segment = linePositions.slice(start, start + 5);
    if (segment.length !== 5) {
      continue;
    }

    const stones = segment.map((s) => s.stone);
    const positions = segment.map((s) => s.pos);

    // パターン1: ●●●・●
    if (
      stones[0] === color &&
      stones[1] === color &&
      stones[2] === color &&
      stones[3] === null &&
      stones[4] === color
    ) {
      return positions[3] ?? null;
    }

    // パターン2: ●●・●●
    if (
      stones[0] === color &&
      stones[1] === color &&
      stones[2] === null &&
      stones[3] === color &&
      stones[4] === color
    ) {
      return positions[2] ?? null;
    }

    // パターン3: ●・●●●
    if (
      stones[0] === color &&
      stones[1] === null &&
      stones[2] === color &&
      stones[3] === color &&
      stones[4] === color
    ) {
      return positions[1] ?? null;
    }
  }

  return null;
}

/**
 * 跳び三の防御位置を取得
 */
function getJumpThreeDefensePositions(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position[] {
  const positions: Position[] = [];

  // ラインをスキャンして跳び三パターンの空きを探す
  const linePositions: { pos: Position; stone: "black" | "white" | null }[] =
    [];

  // 負方向に4マス
  for (let i = 4; i >= 1; i--) {
    const pr = row - dr * i;
    const pc = col - dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 置いた位置
  linePositions.push({
    pos: { row, col },
    stone: color,
  });

  // 正方向に4マス
  for (let i = 1; i <= 4; i++) {
    const pr = row + dr * i;
    const pc = col + dc * i;
    if (isValidPosition(pr, pc)) {
      linePositions.push({
        pos: { row: pr, col: pc },
        stone: board[pr]?.[pc] ?? null,
      });
    }
  }

  // 跳び三パターン ・●●・●・ または ・●・●●・ を探す
  for (let start = 0; start <= linePositions.length - 6; start++) {
    const segment = linePositions.slice(start, start + 6);
    if (segment.length !== 6) {
      continue;
    }

    const stones = segment.map((s) => s.stone);
    const posArr = segment.map((s) => s.pos);

    // パターン: ・●●・●・
    if (
      stones[0] === null &&
      stones[1] === color &&
      stones[2] === color &&
      stones[3] === null &&
      stones[4] === color &&
      stones[5] === null
    ) {
      // 両端と中間の空きが防御点
      if (posArr[0]) {
        positions.push(posArr[0]);
      }
      if (posArr[3]) {
        positions.push(posArr[3]);
      }
      if (posArr[5]) {
        positions.push(posArr[5]);
      }
    }

    // パターン: ・●・●●・
    if (
      stones[0] === null &&
      stones[1] === color &&
      stones[2] === null &&
      stones[3] === color &&
      stones[4] === color &&
      stones[5] === null
    ) {
      if (posArr[0]) {
        positions.push(posArr[0]);
      }
      if (posArr[2]) {
        positions.push(posArr[2]);
      }
      if (posArr[5]) {
        positions.push(posArr[5]);
      }
    }
  }

  return positions;
}

/**
 * 盤面の石数をカウント
 */
export function countStones(board: BoardState): number {
  let count = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        count++;
      }
    }
  }
  return count;
}
