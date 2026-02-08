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
} from "@/logic/renjuRules";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { checkEnds, countLine, getLineEnds } from "../core/lineAnalysis";
import { isNearExistingStone } from "../moveGenerator";
import {
  findJumpGapPosition,
  getJumpThreeDefensePositions,
} from "../patterns/threatAnalysis";
import { createsFour, createsOpenThree } from "./threatMoves";
import {
  findVCFMove,
  findVCFSequence,
  hasVCF,
  type VCFSearchOptions,
  type VCFTimeLimiter,
} from "./vcf";

/** VCT探索の最大深度 */
const VCT_MAX_DEPTH = 4;

/** VCT探索を有効にする石数の閾値（終盤のみ） */
export const VCT_STONE_THRESHOLD = 20;

/** VCT探索の時間制限（ミリ秒） */
const VCT_TIME_LIMIT = 150;

/**
 * VCT探索オプション（外部からパラメータを設定可能）
 */
export interface VCTSearchOptions {
  /** 最大探索深度（デフォルト: VCT_MAX_DEPTH = 4） */
  maxDepth?: number;
  /** 時間制限（ミリ秒、デフォルト: VCT_TIME_LIMIT = 150） */
  timeLimit?: number;
  /** 内部VCF呼び出しに渡すオプション */
  vcfOptions?: VCFSearchOptions;
}

/**
 * VCT手順の探索結果
 */
export interface VCTSequenceResult {
  /** 最初の手 */
  firstMove: Position;
  /** 手順 [攻撃1, 防御1, 攻撃2, ..., 攻撃N] */
  sequence: Position[];
}

/**
 * VCT（三・四連続勝ち）が成立するかチェック
 *
 * @param board 盤面
 * @param color 手番
 * @param depth 現在の探索深度
 * @param timeLimiter 時間制限コンテキスト（ルート呼び出し時は省略可）
 * @param options 探索オプション（深度・時間制限のカスタマイズ）
 * @returns VCTが成立する場合true
 */
export function hasVCT(
  board: BoardState,
  color: "black" | "white",
  depth = 0,
  timeLimiter?: VCFTimeLimiter,
  options?: VCTSearchOptions,
): boolean {
  const maxDepth = options?.maxDepth ?? VCT_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCT_TIME_LIMIT;

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

  // VCFがあればVCT成立（VCF ⊂ VCT）
  // 時間制限を共有（VCTの残り時間をVCFにも適用）
  if (hasVCF(board, color, 0, limiter, options?.vcfOptions)) {
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
      if (!hasVCT(afterDefense, color, depth + 1, limiter, options)) {
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
      const jumpGap = findJumpGapPosition(board, row, col, dr, dc, color);
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
 * VCTの最初の手を返す
 *
 * @param board 盤面
 * @param color 手番
 * @param options 探索オプション
 * @returns VCTの最初の脅威手、なければnull
 */
export function findVCTMove(
  board: BoardState,
  color: "black" | "white",
  options?: VCTSearchOptions,
): Position | null {
  const maxDepth = options?.maxDepth ?? VCT_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCT_TIME_LIMIT;
  const limiter: VCFTimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // VCFが先に成立する場合はVCFの手を返す
  const vcfMove = findVCFMove(board, color, options?.vcfOptions);
  if (vcfMove) {
    return vcfMove;
  }

  return findVCTMoveRecursive(board, color, 0, maxDepth, limiter, options);
}

/**
 * VCTの最初の手を返す（再帰版）
 */
function findVCTMoveRecursive(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  maxDepth: number,
  limiter: VCFTimeLimiter,
  options?: VCTSearchOptions,
): Position | null {
  if (depth >= maxDepth) {
    return null;
  }

  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return null;
  }

  // VCFチェック
  if (hasVCF(board, color, 0, limiter, options?.vcfOptions)) {
    return findVCFMove(board, color, options?.vcfOptions);
  }

  const threatMoves = findThreatMoves(board, color);

  for (const move of threatMoves) {
    const afterThreat = copyBoard(board);
    const afterThreatRow = afterThreat[move.row];
    if (afterThreatRow) {
      afterThreatRow[move.col] = color;
    }

    if (checkFive(afterThreat, move.row, move.col, color)) {
      return move;
    }

    const defensePositions = getThreatDefensePositions(
      afterThreat,
      move.row,
      move.col,
      color,
    );

    if (defensePositions.length === 0) {
      if (isThreat(afterThreat, move.row, move.col, color)) {
        return move;
      }
      continue;
    }

    let allDefenseLeadsToVCT = true;
    for (const defensePos of defensePositions) {
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

      const afterDefense = copyBoard(afterThreat);
      const opponentColor = color === "black" ? "white" : "black";
      const afterDefenseRow = afterDefense[defensePos.row];
      if (afterDefenseRow) {
        afterDefenseRow[defensePos.col] = opponentColor;
      }

      if (!hasVCT(afterDefense, color, depth + 1, limiter, options)) {
        allDefenseLeadsToVCT = false;
        break;
      }
    }

    if (allDefenseLeadsToVCT && defensePositions.length > 0) {
      return move;
    }
  }

  return null;
}

/**
 * VCT手順を返す
 *
 * @param board 盤面
 * @param color 手番
 * @param options 探索オプション
 * @returns VCT手順（見つからない場合はnull）
 */
export function findVCTSequence(
  board: BoardState,
  color: "black" | "white",
  options?: VCTSearchOptions,
): VCTSequenceResult | null {
  const maxDepth = options?.maxDepth ?? VCT_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCT_TIME_LIMIT;
  const limiter: VCFTimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // VCFが先に成立する場合はVCF手順を返す
  const vcfSeq = findVCFSequence(board, color, options?.vcfOptions);
  if (vcfSeq) {
    return { firstMove: vcfSeq.firstMove, sequence: vcfSeq.sequence };
  }

  const sequence: Position[] = [];
  const found = findVCTSequenceRecursive(
    board,
    color,
    0,
    maxDepth,
    limiter,
    sequence,
    options,
  );

  if (!found || !sequence[0]) {
    return null;
  }
  return { firstMove: sequence[0], sequence };
}

/**
 * VCT手順の再帰探索
 */
function findVCTSequenceRecursive(
  board: BoardState,
  color: "black" | "white",
  depth: number,
  maxDepth: number,
  limiter: VCFTimeLimiter,
  sequence: Position[],
  options?: VCTSearchOptions,
): boolean {
  if (depth >= maxDepth) {
    return false;
  }

  if (performance.now() - limiter.startTime >= limiter.timeLimit) {
    return false;
  }

  // VCF手順に委譲
  const vcfSeq = findVCFSequence(board, color, options?.vcfOptions);
  if (vcfSeq) {
    sequence.push(...vcfSeq.sequence);
    return true;
  }

  const threatMoves = findThreatMoves(board, color);

  for (const move of threatMoves) {
    const afterThreat = copyBoard(board);
    const afterThreatRow = afterThreat[move.row];
    if (afterThreatRow) {
      afterThreatRow[move.col] = color;
    }

    if (checkFive(afterThreat, move.row, move.col, color)) {
      sequence.push(move);
      return true;
    }

    const defensePositions = getThreatDefensePositions(
      afterThreat,
      move.row,
      move.col,
      color,
    );

    if (defensePositions.length === 0) {
      if (isThreat(afterThreat, move.row, move.col, color)) {
        sequence.push(move);
        return true;
      }
      continue;
    }

    // 全防御に対してVCTが継続するかチェック
    let allDefenseLeadsToVCT = true;
    // 最初の防御のPVを記録
    let firstDefenseSequence: Position[] | null = null;

    for (const defensePos of defensePositions) {
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

      const afterDefense = copyBoard(afterThreat);
      const opponentColor = color === "black" ? "white" : "black";
      const afterDefenseRow = afterDefense[defensePos.row];
      if (afterDefenseRow) {
        afterDefenseRow[defensePos.col] = opponentColor;
      }

      if (firstDefenseSequence === null) {
        // 最初の防御: 手順を収集
        const subSequence: Position[] = [];
        const found = findVCTSequenceRecursive(
          afterDefense,
          color,
          depth + 1,
          maxDepth,
          limiter,
          subSequence,
          options,
        );
        if (!found) {
          allDefenseLeadsToVCT = false;
          break;
        }
        firstDefenseSequence = [defensePos, ...subSequence];
      } else if (!hasVCT(afterDefense, color, depth + 1, limiter, options)) {
        // 2番目以降の防御: hasVCTでチェックのみ
        allDefenseLeadsToVCT = false;
        break;
      }
    }

    if (
      allDefenseLeadsToVCT &&
      defensePositions.length > 0 &&
      firstDefenseSequence
    ) {
      sequence.push(move);
      sequence.push(...firstDefenseSequence);
      return true;
    }
  }

  return false;
}

/**
 * 指定した手がVCT開始手として有効かチェック
 *
 * @param board 盤面
 * @param move 検証する手
 * @param color 手番
 * @param options 探索オプション
 * @returns VCT開始手として有効ならtrue
 */
export function isVCTFirstMove(
  board: BoardState,
  move: Position,
  color: "black" | "white",
  options?: VCTSearchOptions,
): boolean {
  const timeLimitMs = options?.timeLimit ?? VCT_TIME_LIMIT;
  const limiter: VCFTimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 手を置く
  const afterMove = copyBoard(board);
  const afterMoveRow = afterMove[move.row];
  if (afterMoveRow) {
    afterMoveRow[move.col] = color;
  }

  // 五連チェック
  if (checkFive(afterMove, move.row, move.col, color)) {
    return true;
  }

  // 脅威かチェック
  if (!isThreat(afterMove, move.row, move.col, color)) {
    return false;
  }

  // 防御位置を列挙
  const defensePositions = getThreatDefensePositions(
    afterMove,
    move.row,
    move.col,
    color,
  );

  // 防御不可 = 勝利
  if (defensePositions.length === 0) {
    return true;
  }

  // 全防御に対してVCTが継続するか
  const opponentColor = color === "black" ? "white" : "black";
  for (const defensePos of defensePositions) {
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        afterMove,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        continue;
      }
    }

    const afterDefense = copyBoard(afterMove);
    const afterDefenseRow = afterDefense[defensePos.row];
    if (afterDefenseRow) {
      afterDefenseRow[defensePos.col] = opponentColor;
    }

    if (!hasVCT(afterDefense, color, 1, limiter, options)) {
      return false;
    }
  }

  return true;
}

// 後方互換性のため core/boardUtils から再export
export { countStones } from "../core/boardUtils";
