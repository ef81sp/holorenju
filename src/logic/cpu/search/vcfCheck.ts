/**
 * VCF存在判定（hasVCF）
 *
 * evaluation/followUpThreats.ts から使用される軽量VCFチェック。
 * 完全なVCF手順探索（findVCFSequence等）はWASMに移行済み。
 */

import type { BoardState } from "@/types/game";

import { checkFive } from "@/logic/renjuRules";

import type { VCFSearchOptions } from "./types";

// #43 PR-3: 禁手判定を Zig アダプタへ委譲（forbiddenMoves.ts 依存を断つ）。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
import { createsFour } from "./threatMoves";
import { findFourMoves, getFourDefensePosition } from "./threatPatterns";
import {
  type TimeLimiter,
  incrementNodes,
  isTimeExceeded,
} from "./timeLimiter";

/** VCF探索の最大深度 */
const VCF_MAX_DEPTH = 8;

/** VCF探索の時間制限（ミリ秒） */
const VCF_TIME_LIMIT = 150;

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
  timeLimiter?: TimeLimiter,
  options?: VCFSearchOptions,
): boolean {
  const maxDepth = options?.maxDepth ?? VCF_MAX_DEPTH;
  const timeLimitMs = options?.timeLimit ?? VCF_TIME_LIMIT;

  // 時間制限の初期化（ルート呼び出し時）
  const limiter = timeLimiter ?? {
    startTime: performance.now(),
    timeLimit: timeLimitMs,
    nodes: 0,
    maxNodes: options?.maxNodes,
  };

  // 時間制限チェック
  if (isTimeExceeded(limiter)) {
    return false;
  }

  if (depth >= maxDepth) {
    return false;
  }

  // 四を作れる位置を列挙
  const fourMoves = findFourMoves(board, color);

  const opponentColor = color === "black" ? "white" : "black";

  for (const move of fourMoves) {
    incrementNodes(limiter);
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
    const defense = getFourDefensePosition(board, move, color);

    // #124: 勝ちは「活四（unstoppable）」のみ。
    // 「そもそも四ではない（not_four）」を勝ち扱いにしていたのが偽 VCF の原因だった。
    if (defense.kind === "unstoppable") {
      // 止められない = 勝利
      // 元に戻す（Undo）
      if (moveRow) {
        moveRow[move.col] = null;
      }
      return true;
    }

    if (defense.kind === "not_four") {
      // 四ですらない → この手は追えない
      if (moveRow) {
        moveRow[move.col] = null;
      }
      continue;
    }

    const defensePos = defense.position;

    // 白番の場合、黒の防御位置が禁手ならVCF成立
    if (color === "white") {
      if (isForbiddenForBlack(board, defensePos.row, defensePos.col)) {
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
