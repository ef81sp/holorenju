/**
 * VCT（Victory by Continuous Threats）探索
 *
 * 三・四を連続して打つことで勝利する手順を探索する。
 * VCF（四連続）はVCTの部分集合なので、VCFがあればVCTも成立。
 */

import type { BoardState, Position } from "@/types/game";

import { checkFive, checkForbiddenMove } from "@/logic/renjuRules";

import { type TimeLimiter, isTimeExceeded } from "./context";
import { createsFour } from "./threatMoves";
import {
  checkDefenseCounterThreat,
  getFourDefensePosition,
} from "./threatPatterns";
import {
  findVCFMove,
  findVCFSequence,
  hasVCF,
  type VCFSearchOptions,
} from "./vcf";
import {
  findThreatMoves,
  getThreatDefensePositions,
  hasOpenThree,
  isThreat,
} from "./vctHelpers";

/** VCT探索の最大深度 */
const VCT_MAX_DEPTH = 4;

/** VCT探索を有効にする石数の閾値（終盤のみ） */
export const VCT_STONE_THRESHOLD = 14;

/** VCT探索の時間制限（ミリ秒） */
const VCT_TIME_LIMIT = 150;

/** ct=three 時の hasVCF フォールバック用深さ制限 */
const CT_THREE_VCF_MAX_DEPTH = 8;

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
  timeLimiter?: TimeLimiter,
  options?: VCTSearchOptions,
): boolean {
  const maxDepth = options?.maxDepth ?? VCT_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCT_TIME_LIMIT;
  const opponentColor = color === "black" ? "white" : "black";

  // 時間制限の初期化（ルート呼び出し時）
  const limiter = timeLimiter ?? {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 時間制限チェック
  if (isTimeExceeded(limiter)) {
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

  // 相手に活三があればVCT（三脅威）は不成立（VCFのみ有効）
  // VCFは上で既にチェック済みなので、ここではfalseを返す
  if (depth === 0 && hasOpenThree(board, opponentColor)) {
    return false;
  }

  // 脅威（四・活三）を作れる位置を列挙
  const threatMoves = findThreatMoves(board, color);

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

      // 防御手で五連完成 → VCT不成立
      const defenseWins = checkFive(
        board,
        defensePos.row,
        defensePos.col,
        opponentColor,
      );
      let vctResult = false;
      if (!defenseWins) {
        vctResult = hasVCT(board, color, depth + 1, limiter, options);
      }

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
 * カウンター脅威に応じたVCT継続判定
 *
 * isVCTFirstMoveで使用。探索関数（hasVCT/findVCTMove/findVCTSequence）では
 * per-nodeチェックが性能上不可能なため、findVCTSequenceのみ事後検証で対応。
 *
 * ct=win: 防御手で五連 → VCT不成立
 * ct=four: 攻撃側は四のブロック位置に限定。ブロック後にVCTが継続するか再帰的に検証
 * ct=three: 防御側の活三で三脅威は無効。hasVCFフォールバック（深度制限付き）
 * ct=none: 通常の再帰
 */
function evaluateCounterThreat(
  ct: "win" | "four" | "three" | "none",
  board: BoardState,
  color: "black" | "white",
  defensePos: Position,
  depth: number,
  limiter: TimeLimiter,
  options?: VCTSearchOptions,
): boolean {
  if (ct === "win") {
    return false;
  }

  if (ct === "four") {
    // 防御側がカウンターフォーを作った
    // → 攻撃側は四のブロック位置に限定される
    // → ブロック後にVCTが継続するか再帰的に検証
    const opponentColor = color === "black" ? "white" : "black";
    const blockPos = getFourDefensePosition(board, defensePos, opponentColor);
    if (!blockPos) {
      return false; // 活四でブロック不可 → VCT不成立
    }
    const blockRow = board[blockPos.row];
    if (blockRow) {
      blockRow[blockPos.col] = color;
    }
    const result = hasVCT(board, color, depth + 1, limiter, options);
    if (blockRow) {
      blockRow[blockPos.col] = null;
    }
    return result;
  }

  if (ct === "three") {
    // 防御側が活三を作った → 攻撃側の三脅威は無効（防御側が無視可能）
    // 四脅威（VCF）のみで勝てるかチェック
    // 深さ制限で探索コストを制御（環境非依存・決定的）
    if (isTimeExceeded(limiter)) {
      return false;
    }
    return hasVCF(board, color, 0, limiter, {
      ...options?.vcfOptions,
      maxDepth: Math.min(
        options?.vcfOptions?.maxDepth ?? CT_THREE_VCF_MAX_DEPTH,
        CT_THREE_VCF_MAX_DEPTH,
      ),
    });
  }

  // ct === "none": 通常の再帰
  return hasVCT(board, color, depth + 1, limiter, options);
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
  const limiter: TimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 相手に活三があればVCT不成立（四追いでしか勝てない）
  const opponentColor = color === "black" ? "white" : "black";
  if (hasOpenThree(board, opponentColor)) {
    // VCFのみ試す（四追いなら活三があっても有効）
    return findVCFMove(board, color, options?.vcfOptions);
  }

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
  limiter: TimeLimiter,
  options?: VCTSearchOptions,
): Position | null {
  if (depth >= maxDepth) {
    return null;
  }

  if (isTimeExceeded(limiter)) {
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

      // 防御で五連完成 → VCT不成立
      const defenseWins = checkFive(
        board,
        defensePos.row,
        defensePos.col,
        opponentColor,
      );
      let vctResult = false;
      if (!defenseWins) {
        vctResult = hasVCT(board, color, depth + 1, limiter, options);
      }

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
  const limiter: TimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 相手に活三があればVCT不成立（四追いでしか勝てない）
  const opponentColor = color === "black" ? "white" : "black";
  if (hasOpenThree(board, opponentColor)) {
    // VCFのみ試す（四追いなら活三があっても有効）
    const vcfOnly = findVCFSequence(board, color, options?.vcfOptions);
    if (vcfOnly) {
      return {
        firstMove: vcfOnly.firstMove,
        sequence: vcfOnly.sequence,
        isForbiddenTrap: vcfOnly.isForbiddenTrap,
      };
    }
    return null;
  }

  // VCFが先に成立する場合はVCF手順を返す
  const vcfSeq = findVCFSequence(board, color, options?.vcfOptions);
  if (vcfSeq) {
    return {
      firstMove: vcfSeq.firstMove,
      sequence: vcfSeq.sequence,
      isForbiddenTrap: vcfSeq.isForbiddenTrap,
    };
  }

  // 反復深化: 浅い深度から探索し、最短VCT手順を優先
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (isTimeExceeded(limiter)) {
      return null;
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
      depth,
      limiter,
      sequence,
      options,
      context,
    );

    if (!found || !sequence[0]) {
      continue;
    }

    // Post-search validation: 防御手がカウンターフォー/カウンターウィンを作る経路を棄却
    if (!validateVCTSequence(board, color, sequence)) {
      continue;
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
  return null;
}

/**
 * VCT手順の事後検証
 *
 * 見つかった手順を盤面上でリプレイし、各防御手が五連（カウンターウィン）
 * または四（カウンターフォー）を作らないことを検証する。
 *
 * 探索関数内でのper-nodeチェックは探索木全体のノードに対して実行され
 * 性能上不可能（6倍以上の速度低下）なため、O(sequence_length)の事後検証で対応。
 */
function validateVCTSequence(
  board: BoardState,
  color: "black" | "white",
  sequence: Position[],
): boolean {
  const opponentColor = color === "black" ? "white" : "black";
  const placed: Position[] = [];

  let valid = true;
  for (let i = 0; i < sequence.length; i++) {
    const pos = sequence[i]!;
    const isDefense = i % 2 === 1;
    const stoneColor = isDefense ? opponentColor : color;

    const row = board[pos.row];
    if (row) {
      row[pos.col] = stoneColor;
    }
    placed.push(pos);

    if (isDefense) {
      // 防御手が五連を作る → 攻撃側敗北
      if (checkFive(board, pos.row, pos.col, opponentColor)) {
        valid = false;
        break;
      }
      // 防御手が四を作る → 攻撃側はブロック必須、VCT手順が崩壊
      if (createsFour(board, pos.row, pos.col, opponentColor)) {
        valid = false;
        break;
      }
    }
  }

  // 盤面を元に戻す
  for (let j = placed.length - 1; j >= 0; j--) {
    const p = placed[j]!;
    const r = board[p.row];
    if (r) {
      r[p.col] = null;
    }
  }

  return valid;
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
  limiter: TimeLimiter,
  sequence: Position[],
  options: VCTSearchOptions | undefined,
  context: VCTRecursiveContext,
): boolean {
  if (depth >= maxDepth) {
    return false;
  }

  if (isTimeExceeded(limiter)) {
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

  const opponentColor = color === "black" ? "white" : "black";

  // 相手に活三があればVCT（三脅威）は不成立（VCFのみ有効）
  // VCFは上で既にチェック済みなので、ここではfalseを返す
  if (depth === 0 && hasOpenThree(board, opponentColor)) {
    return false;
  }

  const threatMoves = findThreatMoves(board, color);

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
      isForbiddenTrap: boolean;
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

      // 防御手で五連完成 → VCT不成立
      if (checkFive(board, defensePos.row, defensePos.col, opponentColor)) {
        if (defenseRow) {
          defenseRow[defensePos.col] = null;
        }
        allDefenseLeadsToVCT = false;
        break;
      }

      // シーケンス収集のため通常再帰（ct=four/threeの特別処理なし）
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

        if (context.collectBranches) {
          // collectBranches時: isForbiddenTrapはメインPV選択後に設定
          defenseSequences.push({
            defense: defensePos,
            seq: subSequence,
            childBranches: subContext.branches,
            isForbiddenTrap: subContext.isForbiddenTrap,
          });
        } else if (subContext.isForbiddenTrap) {
          // 非collectBranches時: 最初の防御のみ探索するので即伝播
          context.isForbiddenTrap = true;
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

        // メインPVのisForbiddenTrapのみ伝播（サイド分岐は無視）
        if (longest.isForbiddenTrap) {
          context.isForbiddenTrap = true;
        }

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
  const limiter: TimeLimiter = {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
  };

  // 相手に活三があればVCT開始手として無効（四追いでしか勝てない）
  const opponentColor = color === "black" ? "white" : "black";
  if (hasOpenThree(board, opponentColor)) {
    return false;
  }

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

    // 防御手のカウンター脅威チェック（五連・四）
    const ct = checkDefenseCounterThreat(
      board,
      defensePos.row,
      defensePos.col,
      opponentColor,
    );
    const vctResult = evaluateCounterThreat(
      ct,
      board,
      color,
      defensePos,
      1, // isVCTFirstMoveはdepth=0から開始、防御後はdepth=1
      limiter,
      options,
    );

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
