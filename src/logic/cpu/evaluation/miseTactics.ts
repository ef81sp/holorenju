/**
 * ミセ手戦術
 *
 * ミセ手（四三を狙う手）の検出と評価
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkForbiddenMove, isValidPosition } from "@/logic/renjuRules";

import { DIRECTIONS } from "../core/constants";
import {
  buildLineTable,
  placeStone,
  removeStone,
  type LineTable,
} from "../lineTable/lineTable";
import { analyzeDirection } from "./directionAnalysis";
import { PATTERN_SCORES } from "./patternScores";
import { createsFourThree, createsFourThreeBit } from "./winningPatterns";

/**
 * ミセターゲット（四三点）を軽量検出
 *
 * ライン延長点のみをスキャンする高速版。±2近傍の全探索を省略し、
 * 各方向で2石以上の連続がある場合のみ端点を createsFourThree で検証する。
 * Mise-VCF探索で重要なのはライン上の四三点であり、ライン外の四三点は不要。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四三点の配列
 */
export function findMiseTargetsLite(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const targets: Position[] = [];
  const seen = new Set<string>();

  for (const direction of DIRECTIONS) {
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    if (pattern.count < 2) {
      continue;
    } // 2石未満→四三不可能

    // 正方向端・負方向端をwalk
    for (const sign of [1, -1]) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (isValidPosition(r, c) && board[r]?.[c] === color) {
        r += sign * dr;
        c += sign * dc;
      }
      if (!isValidPosition(r, c) || board[r]?.[c] !== null) {
        continue;
      }

      const key = `${r},${c}`;
      if (seen.has(key)) {
        continue;
      }

      // 黒の禁手チェック
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, r, c);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      if (createsFourThree(board, r, c, color)) {
        targets.push({ row: r, col: c });
        seen.add(key);
      }
    }
  }
  return targets;
}

/**
 * ミセターゲットが存在しうるか安価にチェック（プリフィルタ）
 *
 * analyzeDirection のみ使用し、2石以上の連続かつ片端が空きなら true。
 * createsFourThree を呼ばないため非常に安価（~40 ops/候補手）。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns ミセターゲットが存在しうるなら true
 */
export function hasPotentialMiseTarget(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (const direction of DIRECTIONS) {
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    // 2石以上の連続があり、少なくとも片端が空き
    if (
      pattern.count >= 2 &&
      (pattern.end1 === "empty" || pattern.end2 === "empty")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * ミセターゲット（四三点）を検出
 *
 * 置いた石から各方向のライン延長点と±2近傍をスキャンし、
 * 四三が作れる位置を列挙する。ライン延長点ベースにより、
 * ±2を超える距離の四三点も検出可能。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns 四三点の配列
 */
export function findMiseTargets(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const targets: Position[] = [];
  const seen = new Set<string>();

  const tryAdd = (r: number, c: number): void => {
    const key = `${r},${c}`;
    if (seen.has(key)) {
      return;
    }
    if (!isValidPosition(r, c) || board[r]?.[c] !== null) {
      return;
    }

    // 黒の禁手チェック
    if (color === "black") {
      const forbidden = checkForbiddenMove(board, r, c);
      if (forbidden.isForbidden) {
        return;
      }
    }

    if (createsFourThree(board, r, c, color)) {
      targets.push({ row: r, col: c });
      seen.add(key);
    }
  };

  // 1. 各方向のライン延長点（距離制限なし）
  for (const direction of DIRECTIONS) {
    const [dr, dc] = direction;
    const pattern = analyzeDirection(board, row, col, dr, dc, color);

    // 2石以上の連続がなければスキップ
    if (pattern.count < 2) {
      continue;
    }

    // 正方向の端
    let r = row + dr;
    let c = col + dc;
    while (isValidPosition(r, c) && board[r]?.[c] === color) {
      r += dr;
      c += dc;
    }
    if (isValidPosition(r, c) && board[r]?.[c] === null) {
      tryAdd(r, c);
      // 飛び四ターゲット: ギャップの1つ先もチェック
      const nr = r + dr;
      const nc = c + dc;
      if (isValidPosition(nr, nc) && board[nr]?.[nc] === null) {
        tryAdd(nr, nc);
      }
    }

    // 負方向の端
    r = row - dr;
    c = col - dc;
    while (isValidPosition(r, c) && board[r]?.[c] === color) {
      r -= dr;
      c -= dc;
    }
    if (isValidPosition(r, c) && board[r]?.[c] === null) {
      tryAdd(r, c);
      // 飛び四ターゲット: ギャップの1つ先もチェック
      const nr = r - dr;
      const nc = c - dc;
      if (isValidPosition(nr, nc) && board[nr]?.[nc] === null) {
        tryAdd(nr, nc);
      }
    }
  }

  // 2. ±2近傍スキャン（ライン外の四三点も検出）
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }
      tryAdd(row + dr, col + dc);
    }
  }

  return targets;
}

/**
 * ミセ手判定
 * 次の手で四三が作れる位置かどうかをチェック
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @returns ミセ手ならtrue
 */
export function isMiseMove(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  return findMiseTargets(board, row, col, color).length > 0;
}

/**
 * 両ミセ判定（近似的な検出）
 *
 * ターゲット位置への防御のみをシミュレートする。
 * ターゲット外の防御（三を壊す割り込み等）は検証しない。
 * 偽陽性は構造的に稀であり、探索木が補完する。
 *
 * lineTable が渡された場合はそのまま使用（探索中の一元管理 lineTable を流用）。
 * 渡されない場合は buildLineTable でローカル構築（テストやスタンドアロン呼び出し用）。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @param precomputedTargets findMiseTargets の結果（省略時は内部で計算）
 * @param lineTable 探索中の一元管理 lineTable（省略時は buildLineTable で構築）
 * @returns 両ミセ（どのターゲットを防いでも別のターゲットで四三が残る）なら true
 */
export function isDoubleMise(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  precomputedTargets?: Position[],
  lineTable?: LineTable,
): boolean {
  const targets = precomputedTargets ?? findMiseTargets(board, row, col, color);
  if (targets.length < 2) {
    return false;
  }

  const lt = lineTable ?? buildLineTable(board);
  const opponent = color === "black" ? "white" : "black";

  // 各ターゲット T_i を防御した場合、残りのターゲットのいずれかで四三が成立するか検証
  for (let i = 0; i < targets.length; i++) {
    const ti = targets[i];
    if (!ti) {
      continue;
    }

    // T_i に相手の石を仮配置
    const tiRow = board[ti.row];
    if (tiRow) {
      tiRow[ti.col] = opponent;
    }
    placeStone(lt, ti.row, ti.col, opponent);

    // 残りのターゲットのいずれかが四三を作れるか
    let survived = false;
    for (let j = 0; j < targets.length; j++) {
      if (i === j) {
        continue;
      }
      const tj = targets[j];
      if (!tj) {
        continue;
      }
      if (createsFourThreeBit(board, lt, tj.row, tj.col, color)) {
        survived = true;
        break;
      }
    }

    // 仮配置を復元
    if (tiRow) {
      tiRow[ti.col] = null;
    }
    removeStone(lt, ti.row, ti.col, opponent);

    // いずれかの防御で全ターゲットが潰れる → 両ミセではない
    if (!survived) {
      return false;
    }
  }

  return true;
}

/**
 * ミセボーナスを計算
 *
 * 両ミセなら DOUBLE_MISE_BONUS、通常ミセなら MISE_BONUS、ミセなしなら 0。
 * evaluatePositionCore と evaluatePositionWithBreakdown の両方から呼び出す。
 *
 * @param board 盤面（石を置いた状態）
 * @param row 石を置いた行
 * @param col 石を置いた列
 * @param color 石の色
 * @param lineTable 探索中の一元管理 lineTable（省略可）
 * @returns ミセボーナスのスコア
 */
export function computeMiseBonus(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
  lineTable?: LineTable,
): number {
  const targets = findMiseTargets(board, row, col, color);
  if (
    targets.length >= 2 &&
    isDoubleMise(board, row, col, color, targets, lineTable)
  ) {
    return PATTERN_SCORES.DOUBLE_MISE_BONUS;
  }
  return targets.length > 0 ? PATTERN_SCORES.MISE_BONUS : 0;
}

/**
 * 盤面上の全空きセルから両ミセ手を列挙
 *
 * lineTable を1回構築し、各セルで placeStone/removeStone で同期。
 * hasPotentialMiseTarget でプリフィルタし、通過したセルのみ
 * computeMiseBonus で完全検証する。
 *
 * @param board 盤面
 * @param color 石の色
 * @param lineTable 統合 lineTable があれば流用
 * @returns 両ミセ手の位置配列
 */
export function findDoubleMiseMoves(
  board: BoardState,
  color: "black" | "white",
  lineTable?: LineTable,
): Position[] {
  const lt = lineTable ?? buildLineTable(board);
  const moves: Position[] = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
      const row = board[r];
      if (!row) {
        continue;
      }

      // 仮置き + lineTable 同期
      row[c] = color;
      placeStone(lt, r, c, color);

      // プリフィルタ: 安価に両ミセ候補か判定
      if (hasPotentialMiseTarget(board, r, c, color)) {
        const bonus = computeMiseBonus(board, r, c, color, lt);
        if (bonus >= PATTERN_SCORES.DOUBLE_MISE_BONUS) {
          moves.push({ row: r, col: c });
        }
      }

      // 復元
      removeStone(lt, r, c, color);
      row[c] = null;
    }
  }
  return moves;
}
