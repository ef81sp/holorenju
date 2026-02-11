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
export const VCT_STONE_THRESHOLD = 14;

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
  /** 分岐情報を収集するか（レビュー用） */
  collectBranches?: boolean;
}

/** VCT手順内の分岐情報 */
export interface VCTBranch {
  /** 分岐点のsequence内インデックス（防御手の位置） */
  defenseIndex: number;
  /** 代替防御手 */
  defenseMove: Position;
  /** この防御後の継続手順 */
  continuation: Position[];
}

/**
 * VCT手順の探索結果
 */
export interface VCTSequenceResult {
  /** 最初の手 */
  firstMove: Position;
  /** 手順 [攻撃1, 防御1, 攻撃2, ..., 攻撃N] */
  sequence: Position[];
  /** 禁手追い込みによる勝ちかどうか */
  isForbiddenTrap: boolean;
  /** 分岐情報（collectBranches有効時のみ） */
  branches?: VCTBranch[];
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

  const opponentColor = color === "black" ? "white" : "black";

  for (const move of threatMoves) {
    // 脅威を作る（インプレース）
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

    // 相手の防御位置を列挙
    const defensePositions = getThreatDefensePositions(
      board,
      move.row,
      move.col,
      color,
    );

    // 防御不可（活四など）= 勝利
    if (defensePositions.length === 0) {
      // 脅威が成立しているか再確認（四または活三）
      if (isThreat(board, move.row, move.col, color)) {
        // 元に戻す（Undo）
        if (moveRow) {
          moveRow[move.col] = null;
        }
        return true;
      }
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      continue;
    }

    // 全ての防御に対してVCTが継続できるか
    let allDefenseLeadsToVCT = true;
    for (const defensePos of defensePositions) {
      // 白番の場合、黒の防御位置が禁手ならVCT成立
      if (color === "white") {
        const forbiddenResult = checkForbiddenMove(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      // 相手が防御した後の局面（インプレース）
      const defenseRow = board[defensePos.row];
      if (defenseRow) {
        defenseRow[defensePos.col] = opponentColor;
      }

      // 再帰的にVCTをチェック
      const vctResult = hasVCT(board, color, depth + 1, limiter, options);

      // 元に戻す（Undo）- 防御手
      if (defenseRow) {
        defenseRow[defensePos.col] = null;
      }

      if (!vctResult) {
        allDefenseLeadsToVCT = false;
        break;
      }
    }

    // 元に戻す（Undo）- 攻撃手
    if (moveRow) {
      moveRow[move.col] = null;
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

      // 行配列を取得
      const rowArray = board[row];

      // インプレースで石を置いて五連・四・活三を一括チェック
      if (rowArray) {
        rowArray[col] = color;
      }

      // 五連が作れる場合は最優先（禁手でもOK）
      if (checkFive(board, row, col, color)) {
        if (rowArray) {
          rowArray[col] = null;
        }
        fourMoves.push({ row, col });
        continue;
      }

      // 四が作れるかチェック
      const isFour = createsFour(board, row, col, color);

      if (isFour) {
        // 元に戻す（Undo）
        if (rowArray) {
          rowArray[col] = null;
        }

        // 禁手チェックは四を作る手だけに限定
        if (
          color === "black" &&
          checkForbiddenMove(board, row, col).isForbidden
        ) {
          continue;
        }

        fourMoves.push({ row, col });
        continue;
      }

      // 活三が作れるかチェック
      const isOpenThree = createsOpenThree(board, row, col, color);

      // 元に戻す（Undo）
      if (rowArray) {
        rowArray[col] = null;
      }

      if (!isOpenThree) {
        continue;
      }

      // 禁手チェックは活三を作る手だけに限定
      if (
        color === "black" &&
        checkForbiddenMove(board, row, col).isForbidden
      ) {
        continue;
      }

      openThreeMoves.push({ row, col });
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
/** @internal テスト用にエクスポート */
export function getThreatDefensePositions(
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

  // VCFチェック（hasVCF→findVCFMoveの二重探索を統合）
  const vcfMove = findVCFMove(board, color, options?.vcfOptions);
  if (vcfMove) {
    return vcfMove;
  }

  const threatMoves = findThreatMoves(board, color);
  const opponentColor = color === "black" ? "white" : "black";

  for (const move of threatMoves) {
    // 脅威を作る（インプレース）
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    if (checkFive(board, move.row, move.col, color)) {
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      return move;
    }

    const defensePositions = getThreatDefensePositions(
      board,
      move.row,
      move.col,
      color,
    );

    if (defensePositions.length === 0) {
      if (isThreat(board, move.row, move.col, color)) {
        // 元に戻す（Undo）
        if (moveRow) {
          moveRow[move.col] = null;
        }
        return move;
      }
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      continue;
    }

    let allDefenseLeadsToVCT = true;
    for (const defensePos of defensePositions) {
      if (color === "white") {
        const forbiddenResult = checkForbiddenMove(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      // 相手が防御した後の局面（インプレース）
      const defenseRow = board[defensePos.row];
      if (defenseRow) {
        defenseRow[defensePos.col] = opponentColor;
      }

      const vctResult = hasVCT(board, color, depth + 1, limiter, options);

      // 元に戻す（Undo）- 防御手
      if (defenseRow) {
        defenseRow[defensePos.col] = null;
      }

      if (!vctResult) {
        allDefenseLeadsToVCT = false;
        break;
      }
    }

    // 元に戻す（Undo）- 攻撃手
    if (moveRow) {
      moveRow[move.col] = null;
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
    return {
      firstMove: vcfSeq.firstMove,
      sequence: vcfSeq.sequence,
      isForbiddenTrap: vcfSeq.isForbiddenTrap,
    };
  }

  const sequence: Position[] = [];
  const context: VCTRecursiveContext = {
    isForbiddenTrap: false,
    collectBranches: options?.collectBranches ?? false,
    branches: [],
  };
  const found = findVCTSequenceRecursive(
    board,
    color,
    0,
    maxDepth,
    limiter,
    sequence,
    options,
    context,
  );

  if (!found || !sequence[0]) {
    return null;
  }
  const result: VCTSequenceResult = {
    firstMove: sequence[0],
    sequence,
    isForbiddenTrap: context.isForbiddenTrap,
  };
  if (context.collectBranches && context.branches.length > 0) {
    result.branches = context.branches;
  }
  return result;
}

/** 再帰探索のコンテキスト */
interface VCTRecursiveContext {
  isForbiddenTrap: boolean;
  collectBranches: boolean;
  branches: VCTBranch[];
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
  options: VCTSearchOptions | undefined,
  context: VCTRecursiveContext,
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
    if (vcfSeq.isForbiddenTrap) {
      context.isForbiddenTrap = true;
    }
    return true;
  }

  const threatMoves = findThreatMoves(board, color);
  const opponentColor = color === "black" ? "white" : "black";

  for (const move of threatMoves) {
    // 脅威を作る（インプレース）
    const moveRow = board[move.row];
    if (moveRow) {
      moveRow[move.col] = color;
    }

    if (checkFive(board, move.row, move.col, color)) {
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      sequence.push(move);
      return true;
    }

    const defensePositions = getThreatDefensePositions(
      board,
      move.row,
      move.col,
      color,
    );

    if (defensePositions.length === 0) {
      if (isThreat(board, move.row, move.col, color)) {
        // 元に戻す（Undo）
        if (moveRow) {
          moveRow[move.col] = null;
        }
        sequence.push(move);
        return true;
      }
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      continue;
    }

    // 全防御に対してVCTが継続するかチェック
    let allDefenseLeadsToVCT = true;
    // 防御ごとの手順を収集（collectBranches時は全防御で収集）
    const defenseSequences: {
      defense: Position;
      seq: Position[];
      childBranches: VCTBranch[];
    }[] = [];
    let firstDefenseSequence: Position[] | null = null;

    for (const defensePos of defensePositions) {
      if (color === "white") {
        const forbiddenResult = checkForbiddenMove(
          board,
          defensePos.row,
          defensePos.col,
        );
        if (forbiddenResult.isForbidden) {
          continue;
        }
      }

      // 相手が防御した後の局面（インプレース）
      const defenseRow = board[defensePos.row];
      if (defenseRow) {
        defenseRow[defensePos.col] = opponentColor;
      }

      if (context.collectBranches || firstDefenseSequence === null) {
        // 分岐収集時は全防御で手順を収集、通常時は最初の防御のみ
        const subSequence: Position[] = [];
        const subContext: VCTRecursiveContext = {
          isForbiddenTrap: false,
          collectBranches: context.collectBranches,
          branches: [],
        };
        const found = findVCTSequenceRecursive(
          board,
          color,
          depth + 1,
          maxDepth,
          limiter,
          subSequence,
          options,
          subContext,
        );

        // 元に戻す（Undo）- 防御手
        if (defenseRow) {
          defenseRow[defensePos.col] = null;
        }

        if (!found) {
          allDefenseLeadsToVCT = false;
          break;
        }
        if (subContext.isForbiddenTrap) {
          context.isForbiddenTrap = true;
        }

        if (context.collectBranches) {
          defenseSequences.push({
            defense: defensePos,
            seq: subSequence,
            childBranches: subContext.branches,
          });
        }
        if (firstDefenseSequence === null) {
          firstDefenseSequence = [defensePos, ...subSequence];
        }
      } else {
        const vctResult = hasVCT(board, color, depth + 1, limiter, options);

        // 元に戻す（Undo）- 防御手
        if (defenseRow) {
          defenseRow[defensePos.col] = null;
        }

        if (!vctResult) {
          // 2番目以降の防御: hasVCTでチェックのみ
          allDefenseLeadsToVCT = false;
          break;
        }
      }
    }

    // 元に戻す（Undo）- 攻撃手
    if (moveRow) {
      moveRow[move.col] = null;
    }

    if (
      allDefenseLeadsToVCT &&
      defensePositions.length > 0 &&
      firstDefenseSequence
    ) {
      if (context.collectBranches && defenseSequences.length > 0) {
        // 最長の継続を持つ防御をメインPVに選択（= 最強防御）
        let longestIdx = 0;
        let longestLen = defenseSequences[0]?.seq.length ?? 0;
        for (let i = 1; i < defenseSequences.length; i++) {
          const len = defenseSequences[i]?.seq.length ?? 0;
          if (len > longestLen) {
            longestLen = len;
            longestIdx = i;
          }
        }
        const longest = defenseSequences[longestIdx]!;
        const defenseIndexInSequence = sequence.length + 1; // +1 for the attack move

        sequence.push(move);
        sequence.push(longest.defense, ...longest.seq);

        // メインPVの子分岐を親に統合（インデックスをオフセット）
        // subSeqは防御手の次から始まるため +1
        const subSeqOffset = defenseIndexInSequence + 1;
        for (const childBranch of longest.childBranches) {
          context.branches.push({
            defenseIndex: subSeqOffset + childBranch.defenseIndex,
            defenseMove: childBranch.defenseMove,
            continuation: childBranch.continuation,
          });
        }

        // 残りの防御を分岐として記録
        for (let i = 0; i < defenseSequences.length; i++) {
          if (i === longestIdx) {
            continue;
          }
          const ds = defenseSequences[i]!;
          context.branches.push({
            defenseIndex: defenseIndexInSequence,
            defenseMove: ds.defense,
            continuation: ds.seq,
          });
        }
      } else {
        sequence.push(move);
        sequence.push(...firstDefenseSequence);
      }
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

  // 手を置く（インプレース）
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

  // 脅威かチェック
  if (!isThreat(board, move.row, move.col, color)) {
    // 元に戻す（Undo）
    if (moveRow) {
      moveRow[move.col] = null;
    }
    return false;
  }

  // 防御位置を列挙
  const defensePositions = getThreatDefensePositions(
    board,
    move.row,
    move.col,
    color,
  );

  // 防御不可 = 勝利
  if (defensePositions.length === 0) {
    // 元に戻す（Undo）
    if (moveRow) {
      moveRow[move.col] = null;
    }
    return true;
  }

  // 全防御に対してVCTが継続するか
  const opponentColor = color === "black" ? "white" : "black";
  let allDefenseLeadsToVCT = true;
  for (const defensePos of defensePositions) {
    if (color === "white") {
      const forbiddenResult = checkForbiddenMove(
        board,
        defensePos.row,
        defensePos.col,
      );
      if (forbiddenResult.isForbidden) {
        continue;
      }
    }

    // 相手が防御した後の局面（インプレース）
    const defenseRow = board[defensePos.row];
    if (defenseRow) {
      defenseRow[defensePos.col] = opponentColor;
    }

    const vctResult = hasVCT(board, color, 1, limiter, options);

    // 元に戻す（Undo）- 防御手
    if (defenseRow) {
      defenseRow[defensePos.col] = null;
    }

    if (!vctResult) {
      allDefenseLeadsToVCT = false;
      break;
    }
  }

  // 元に戻す（Undo）- 攻撃手
  if (moveRow) {
    moveRow[move.col] = null;
  }

  return allDefenseLeadsToVCT;
}

// 後方互換性のため core/boardUtils から再export
export { countStones } from "../core/boardUtils";
