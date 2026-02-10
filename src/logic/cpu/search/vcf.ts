/**
 * VCF（Victory by Continuous Fours）探索
 *
 * 四を連続して打つことで勝利する手順を探索する。
 * 白番の場合、黒の防御点が禁手なら即勝利。
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import {
  checkFive,
  checkForbiddenMove,
  checkJumpFour,
  isValidPosition,
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { countLine } from "../core/lineAnalysis";
import { isNearExistingStone } from "../moveGenerator";
import { findJumpGapPosition } from "../patterns/threatAnalysis";
import { createsFour } from "./threatMoves";

// 後方互換性のためライン解析関数を再export
export { checkEnds, countLine } from "../core/lineAnalysis";

/** VCF探索の最大深度 */
const VCF_MAX_DEPTH = 8;

/** VCF探索の時間制限（ミリ秒） */
const VCF_TIME_LIMIT = 150;

/**
 * VCF探索用の時間制限コンテキスト
 */
export interface VCFTimeLimiter {
  startTime: number;
  timeLimit: number;
}

/**
 * VCF探索オプション（外部からパラメータを設定可能）
 */
export interface VCFSearchOptions {
  /** 最大探索深度（デフォルト: VCF_MAX_DEPTH = 8） */
  maxDepth?: number;
  /** 時間制限（ミリ秒、デフォルト: VCF_TIME_LIMIT = 150） */
  timeLimit?: number;
}

/**
 * VCF手順の探索結果
 */
export interface VCFSequenceResult {
  /** 最初の手 */
  firstMove: Position;
  /** 手順 [攻撃1, 防御1, 攻撃2, 防御2, ..., 攻撃N] */
  sequence: Position[];
  /** 禁手追い込みによる勝ちかどうか */
  isForbiddenTrap: boolean;
}

/**
 * VCF手順探索の内部コンテキスト
 */
interface VCFSearchContext {
  isForbiddenTrap: boolean;
}

/**
 * VCFが成立するかチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param depth 現在の探索深度
 * @param timeLimiter 時間制限コンテキスト（ルート呼び出し時は省略可）
 * @param options 探索オプション（深度・時間制限のカスタマイズ）
 * @returns VCFが成立する場合true
 */
export function hasVCF(
  board: BoardState,
  color: "black" | "white",
  depth = 0,
  timeLimiter?: VCFTimeLimiter,
  options?: VCFSearchOptions,
): boolean {
  const maxDepth = options?.maxDepth ?? VCF_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCF_TIME_LIMIT;

  // 時間制限の初期化（ルート呼び出し時）
  const limiter = timeLimiter ?? {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 時間制限チェック
  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return false;
  }

  if (depth >= maxDepth) {
    return false;
  }

  // 四を作れる位置を列挙
  const fourMoves = findFourMoves(board, color);

  const opponentColor = color === "black" ? "white" : "black";

  for (const move of fourMoves) {
    // 四を作る（インプレース）
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    // 五連チェック
    if (checkFive(board, move.row, move.col, color)) {
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      return true;
    }

    // 相手の応手（四を止める）
    const defensePos = getFourDefensePosition(board, move, color);

    if (!defensePos) {
      // 止められない = 勝利
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      return true;
    }

    // 白番の場合、黒の防御位置が禁手ならVCF成立
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        board,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        // 元に戻す（Undo）
        if (moveRow) {
          moveRow[move.col] = null;
        }
        return true;
      }
    }

    // 相手が止めた後の局面で再帰（インプレース）
    const defenseRow = board[defensePos.row];
    if (defenseRow) {
      defenseRow[defensePos.col] = opponentColor;
    }

    // 防御で五連完成 → 攻撃者の敗北、VCF不成立
    // 防御でカウンターフォー → VCF中断（相手の四に対応必要）
    const defenseWins = checkFive(
      board,
      defensePos.row,
      defensePos.col,
      opponentColor,
    );
    const defenseCounterFour =
      !defenseWins &&
      createsFour(board, defensePos.row, defensePos.col, opponentColor);

    let result = false;
    if (!defenseWins && !defenseCounterFour) {
      result = hasVCF(board, color, depth + 1, limiter, options);
    }

    // 元に戻す（Undo）- 逆順
    if (defenseRow) {
      defenseRow[defensePos.col] = null;
    }
    if (moveRow) {
      moveRow[move.col] = null;
    }

    if (result) {
      return true;
    }
  }

  return false;
}

/**
 * VCFの最初の手を返す
 *
 * @param board 盤面
 * @param color 手番
 * @param options 探索オプション
 * @returns VCFの最初の四追い手、なければnull
 */
export function findVCFMove(
  board: BoardState,
  color: "black" | "white",
  options?: VCFSearchOptions,
): Position | null {
  const maxDepth = options?.maxDepth ?? VCF_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCF_TIME_LIMIT;
  const limiter: VCFTimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 反復深化: 浅い深度から探索し、最短VCFを優先
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (performance.now() - limiter.startTime >= limiter.timeLimit) {
      return null;
    }
    const result = findVCFMoveRecursive(board, color, 0, limiter, {
      ...options,
      maxDepth: depth,
    });
    if (result) {
      return result;
    }
  }
  return null;
}

/**
 * VCFの最初の手を返す（再帰版）
 *
 * 1パスで五連→活四→再帰の順に処理。
 * 即勝ち（五連・活四・禁手防御不能）を先にチェックし、
 * 見つからなかった手のみ再帰探索に回す。
 */
function findVCFMoveRecursive(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  limiter: VCFTimeLimiter,
  options?: VCFSearchOptions,
): Position | null {
  const maxDepth = options?.maxDepth ?? VCF_MAX_DEPTH;

  if (depth >= maxDepth) {
    return null;
  }

  // 時間制限チェック
  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return null;
  }

  const fourMoves = findFourMoves(board, color);
  const opponentColor = color === "black" ? "white" : "black";
  const recursiveMoves: { move: Position; defensePos: Position }[] = [];

  for (const move of fourMoves) {
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    // 五連 → 即勝ち
    if (checkFive(board, move.row, move.col, color)) {
      if (moveRow) {
        moveRow[move.col] = null;
      }
      return move;
    }

    const defensePos = getFourDefensePosition(board, move, color);
    if (moveRow) {
      moveRow[move.col] = null;
    }

    // 活四（防御不能） → 即勝ち
    if (!defensePos) {
      return move;
    }

    // 白番: 黒の防御位置が禁手 → 即勝ち
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        board,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        return move;
      }
    }

    // 再帰探索用に蓄積
    recursiveMoves.push({ move, defensePos });
  }

  // 再帰探索（即勝ちが見つからなかった手のみ）
  for (const { move, defensePos } of recursiveMoves) {
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    const defenseRow = board[defensePos.row];
    if (defenseRow) {
      defenseRow[defensePos.col] = opponentColor;
    }

    // 防御で五連完成 or カウンターフォー → スキップ
    const defenseWins = checkFive(
      board,
      defensePos.row,
      defensePos.col,
      opponentColor,
    );
    const defenseCounterFour =
      !defenseWins &&
      createsFour(board, defensePos.row, defensePos.col, opponentColor);

    let vcfMove: Position | null = null;
    if (!defenseWins && !defenseCounterFour) {
      vcfMove = findVCFMoveRecursive(board, color, depth + 1, limiter, options);
    }

    // Undo - 逆順
    if (defenseRow) {
      defenseRow[defensePos.col] = null;
    }
    if (moveRow) {
      moveRow[move.col] = null;
    }

    if (vcfMove !== null) {
      return depth === 0 ? move : vcfMove;
    }
  }

  return null;
}

/**
 * 即勝ち手を探す（五連を完成できる位置）
 *
 * 自分の四（棒四・活四・跳び四）が盤上にある場合、
 * 五を打てる位置を返す。見つからなければnull。
 */
export function findWinningMove(
  board: BoardState,
  color: "black" | "white",
): Position | null {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      const rowArray = board[row];
      if (rowArray) {
        rowArray[col] = color;
      }

      const isFive = checkFive(board, row, col, color);

      if (rowArray) {
        rowArray[col] = null;
      }

      if (isFive) {
        return { row, col };
      }
    }
  }

  return null;
}

/**
 * 四を作れる位置を列挙
 * @internal テスト用にexport
 */
export function findFourMoves(
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const moves: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 行配列を取得（このセル操作で共通利用）
      const rowArray = board[row];

      // 石を置いて五連・四を一括チェック（place/undoを1回に統合）
      if (rowArray) {
        rowArray[col] = color;
      }

      const isFive = checkFive(board, row, col, color);
      if (isFive) {
        if (rowArray) {
          rowArray[col] = null;
        }
        moves.push({ row, col });
        continue;
      }

      const isFour = createsFour(board, row, col, color);

      if (rowArray) {
        rowArray[col] = null;
      }

      if (!isFour) {
        continue;
      }

      // 禁手チェックは四を作る手だけに限定
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      moves.push({ row, col });
    }
  }

  return moves;
}

/**
 * 四に対する防御位置を取得
 * 四は1点でしか止められないので、その位置を返す
 *
 * @param board 盤面（四が作られた状態）
 * @param lastMove 最後に置かれた手
 * @param color 四を作った手番
 * @returns 防御位置（止められない場合はnull）
 */
export function getFourDefensePosition(
  board: BoardState,
  lastMove: Position,
  color: "black" | "white",
): Position | null {
  const { row, col } = lastMove;

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
      const defensePos = findDefenseForConsecutiveFour(
        board,
        row,
        col,
        dr,
        dc,
        color,
      );
      if (defensePos) {
        return defensePos;
      }
    }

    // 跳び四をチェック
    if (count !== 4 && checkJumpFour(board, row, col, dirIndex, color)) {
      const defensePos = findDefenseForJumpFour(board, row, col, dr, dc, color);
      if (defensePos) {
        return defensePos;
      }
    }
  }

  return null;
}

/**
 * 連続四に対する防御位置を取得
 * @internal テスト用にexport
 */
export function findDefenseForConsecutiveFour(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position | null {
  const defensePositions: Position[] = [];

  // 正方向の端
  let r = row + dr;
  let c = col + dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r += dr;
    c += dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    defensePositions.push({ row: r, col: c });
  }

  // 負方向の端
  r = row - dr;
  c = col - dc;
  while (isValidPosition(r, c) && board[r]?.[c] === color) {
    r -= dr;
    c -= dc;
  }
  if (isValidPosition(r, c) && board[r]?.[c] === null) {
    defensePositions.push({ row: r, col: c });
  }

  // 止め四の場合は1点のみ
  if (defensePositions.length === 1) {
    return defensePositions[0] ?? null;
  }

  // 活四の場合は止められない（nullを返す = 勝利）
  if (defensePositions.length === 2) {
    return null;
  }

  return null;
}

/**
 * 跳び四に対する防御位置を取得
 * 跳び四は中の空きを埋めるしかない
 * @internal テスト用にexport
 */
export function findDefenseForJumpFour(
  board: BoardState,
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: "black" | "white",
): Position | null {
  return findJumpGapPosition(board, row, col, dr, dc, color);
}

/**
 * VCF手順を返す
 *
 * @param board 盤面
 * @param color 手番
 * @param options 探索オプション
 * @returns VCF手順（見つからない場合はnull）
 */
export function findVCFSequence(
  board: BoardState,
  color: "black" | "white",
  options?: VCFSearchOptions,
): VCFSequenceResult | null {
  const maxDepth = options?.maxDepth ?? VCF_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCF_TIME_LIMIT;
  const limiter: VCFTimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 反復深化: 浅い深度から探索し、最短VCF手順を優先
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (performance.now() - limiter.startTime >= limiter.timeLimit) {
      return null;
    }
    const sequence: Position[] = [];
    const context: VCFSearchContext = { isForbiddenTrap: false };
    const result = findVCFSequenceRecursive(
      board,
      color,
      0,
      limiter,
      sequence,
      { ...options, maxDepth: depth },
      context,
    );
    if (result && sequence[0]) {
      return {
        firstMove: sequence[0],
        sequence,
        isForbiddenTrap: context.isForbiddenTrap,
      };
    }
  }
  return null;
}

/**
 * VCF手順の再帰探索
 *
 * 1パスで五連→活四→再帰の順に処理。
 * 即勝ち（五連・活四・禁手防御不能）を先にチェックし、
 * 見つからなかった手のみ再帰探索に回す。
 */
function findVCFSequenceRecursive(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  limiter: VCFTimeLimiter,
  sequence: Position[],
  options: VCFSearchOptions | undefined,
  context: VCFSearchContext,
): boolean {
  const maxDepth = options?.maxDepth ?? VCF_MAX_DEPTH;

  if (depth >= maxDepth) {
    return false;
  }

  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return false;
  }

  const fourMoves = findFourMoves(board, color);
  const opponentColor = color === "black" ? "white" : "black";
  const recursiveMoves: { move: Position; defensePos: Position }[] = [];

  for (const move of fourMoves) {
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    // 五連 → 即勝ち
    if (checkFive(board, move.row, move.col, color)) {
      if (moveRow) {
        moveRow[move.col] = null;
      }
      sequence.push(move);
      return true;
    }

    const defensePos = getFourDefensePosition(board, move, color);
    if (moveRow) {
      moveRow[move.col] = null;
    }

    // 活四（防御不能） → 即勝ち
    if (!defensePos) {
      sequence.push(move);
      return true;
    }

    // 白番: 黒の防御位置が禁手 → 即勝ち（禁手追い込み）
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        board,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        sequence.push(move);
        context.isForbiddenTrap = true;
        return true;
      }
    }

    // 再帰探索用に蓄積
    recursiveMoves.push({ move, defensePos });
  }

  // 再帰探索（即勝ちが見つからなかった手のみ）
  for (const { move, defensePos } of recursiveMoves) {
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    const defenseRow = board[defensePos.row];
    if (defenseRow) {
      defenseRow[defensePos.col] = opponentColor;
    }

    // 防御で五連完成 or カウンターフォー → スキップ
    const defenseWins = checkFive(
      board,
      defensePos.row,
      defensePos.col,
      opponentColor,
    );
    const defenseCounterFour =
      !defenseWins &&
      createsFour(board, defensePos.row, defensePos.col, opponentColor);

    let found = false;
    if (!defenseWins && !defenseCounterFour) {
      const seqLen = sequence.length;
      sequence.push(move);
      sequence.push(defensePos);

      found = findVCFSequenceRecursive(
        board,
        color,
        depth + 1,
        limiter,
        sequence,
        options,
        context,
      );

      if (!found) {
        // 手順を巻き戻し
        sequence.length = seqLen;
      }
    }

    // Undo - 逆順
    if (defenseRow) {
      defenseRow[defensePos.col] = null;
    }
    if (moveRow) {
      moveRow[move.col] = null;
    }

    if (found) {
      return true;
    }
  }

  return false;
}
