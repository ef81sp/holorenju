/**
 * 禁手判定: 三三禁、四四禁、長連禁の検出
 */

import type { BoardState, ForbiddenMoveResult, Position } from "@/types/game";

import { incrementForbiddenCheckCalls } from "@/logic/cpu/profiling/counters";
import { updateHash } from "@/logic/cpu/zobrist";

import { checkFive, checkOverline, DIRECTION_PAIRS } from "./core";
import {
  checkJumpFour,
  checkJumpThree,
  checkOpenPattern,
  checkStraightFour,
  getConsecutiveThreeStraightFourPoints,
  getJumpThreeStraightFourPoints,
} from "./patterns";

/**
 * 禁手判定の再帰的コンテキスト
 * - inProgress: 現在判定中の点のSet（循環参照検出用）
 * - cache: 計算済みの禁手判定結果のキャッシュ（ローカル）
 * - globalGet/globalSet: グローバルキャッシュへのアクセス関数（依存性注入）
 * - boardHash: 現在の盤面のZobristハッシュ（グローバルキャッシュ用）
 */
interface ForbiddenCheckContext {
  inProgress: Set<string>;
  cache: Map<string, ForbiddenMoveResult>;
  globalGet?: (
    hash: bigint,
    row: number,
    col: number,
  ) => ForbiddenMoveResult | undefined;
  globalSet?: (
    hash: bigint,
    row: number,
    col: number,
    result: ForbiddenMoveResult,
  ) => void;
  boardHash?: bigint;
}

/** 位置をキー文字列に変換 */
function positionToKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** 三の情報 */
interface ThreeInfo {
  directionIndex: number;
  type: "consecutive" | "jump";
  straightFourPoints: Position[];
}

/** 四の情報 */
interface FourInfo {
  directionIndex: number;
  type: "consecutive" | "jump";
}

/**
 * 三が「本物の三」かどうかを検証
 * 達四点（三を達四にできる点）のいずれかが禁点でなければ、三として有効
 * すべての達四点が禁点なら「ウソの三」として無効
 *
 * 重要: 達四点の禁手判定は「元の位置（三三を作る位置）に石がある状態」で行う。
 * これにより、元の石との組み合わせで発生する禁手も正しく検出できる。
 *
 * @param board 盤面
 * @param straightFourPoints 達四点の配列
 * @param context 再帰的判定コンテキスト
 * @param originalRow 元の三三判定位置の行
 * @param originalCol 元の三三判定位置の列
 * @returns 三が有効ならtrue
 */
function isValidThree(
  board: BoardState,
  straightFourPoints: Position[],
  context: ForbiddenCheckContext,
  originalRow: number,
  originalCol: number,
  directionIndex: number,
): boolean {
  // 達四点がなければ無効
  if (straightFourPoints.length === 0) {
    return false;
  }

  // 元の位置に黒石を仮に置く（達四点チェックのため）
  const rowArray = board[originalRow];
  const originalValue = rowArray?.[originalCol] ?? null;
  if (rowArray) {
    rowArray[originalCol] = "black";
  }

  // boardHashを差分更新（黒石を追加）
  const savedHash = context.boardHash;
  if (context.boardHash !== undefined) {
    context.boardHash = updateHash(
      context.boardHash,
      originalRow,
      originalCol,
      "black",
    );
  }

  // いずれかの達四点が禁点でなければ有効
  let hasValidPoint = false;
  for (const pos of straightFourPoints) {
    const result = checkForbiddenMoveRecursive(
      board,
      pos.row,
      pos.col,
      context,
    );
    if (
      !result.isForbidden &&
      checkStraightFour(board, pos.row, pos.col, directionIndex)
    ) {
      hasValidPoint = true;
      break;
    }
  }

  // 元に戻す（Undo）
  if (rowArray) {
    rowArray[originalCol] = originalValue;
  }
  context.boardHash = savedHash;

  return hasValidPoint;
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

    const pattern = checkOpenPattern(board, row, col, dir1Index, "black");

    // この方向が四（連続四または飛び四）なら、三ではない
    if (pattern.four || checkJumpFour(board, row, col, dir1Index, "black")) {
      continue;
    }

    // 連続三をチェック
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
    if (
      isValidThree(
        board,
        three.straightFourPoints,
        context,
        row,
        col,
        three.directionIndex,
      )
    ) {
      validThreeCount++;
    }
  }

  return validThreeCount >= 2;
}

/**
 * 再帰的な禁手判定（循環参照検出付き）
 *
 * グローバルキャッシュ → ローカルキャッシュの順でチェックし、
 * 計算結果は両方のキャッシュに保存する。
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

  // ローカルキャッシュ確認（再帰呼び出し中の同一位置を高速に検出）
  const localCached = context.cache.get(key);
  if (localCached) {
    return localCached;
  }

  // グローバルキャッシュ確認（盤面ハッシュが必要）
  if (context.globalGet && context.boardHash !== undefined) {
    const globalCached = context.globalGet(context.boardHash, row, col);
    if (globalCached !== undefined) {
      // ローカルキャッシュにも保存
      context.cache.set(key, globalCached);
      return globalCached;
    }
  }

  // 判定中としてマーク
  context.inProgress.add(key);

  // 禁手判定を実行
  const result = checkForbiddenMoveInternal(board, row, col, context);

  // 判定完了
  context.inProgress.delete(key);

  // ローカルキャッシュに保存
  context.cache.set(key, result);

  // グローバルキャッシュにも保存
  if (context.globalSet && context.boardHash !== undefined) {
    context.globalSet(context.boardHash, row, col, result);
  }

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
 * グローバルキャッシュを活用した禁手判定のオプション
 */
export interface ForbiddenCheckOptions {
  /** グローバルキャッシュからの取得関数 */
  globalGet: (
    hash: bigint,
    row: number,
    col: number,
  ) => ForbiddenMoveResult | undefined;
  /** グローバルキャッシュへの保存関数 */
  globalSet: (
    hash: bigint,
    row: number,
    col: number,
    result: ForbiddenMoveResult,
  ) => void;
  /** 現在の盤面のZobristハッシュ */
  boardHash: bigint;
}

/**
 * 禁じ手判定（グローバルキャッシュ活用版）
 *
 * グローバルキャッシュ（Zobristハッシュベース）を活用することで、
 * 再帰的な禁手判定でも同一盤面・同一位置の判定結果を再利用できる。
 *
 * @returns 禁じ手判定の結果
 */
export function checkForbiddenMoveWithContext(
  board: BoardState,
  row: number,
  col: number,
  options: ForbiddenCheckOptions,
): ForbiddenMoveResult {
  // プロファイリング: 禁手判定回数をカウント
  incrementForbiddenCheckCalls();

  // グローバルキャッシュへのアクセス関数を含むコンテキストを作成
  const context: ForbiddenCheckContext = {
    inProgress: new Set(),
    cache: new Map(),
    globalGet: options.globalGet,
    globalSet: options.globalSet,
    boardHash: options.boardHash,
  };

  return checkForbiddenMoveRecursive(board, row, col, context);
}
