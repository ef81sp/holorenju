/**
 * Mise-VCF探索
 *
 * ミセ手（四三を狙う手）→ 相手の強制応手（四三点を防御）→ VCF勝ちの
 * 手順を探索する。通常のVCF探索では検出できない勝ち筋を発見する。
 *
 * 例: G7(ミセ) → J7(白防御) → H4(VCF開始) → ... → 勝ち
 */

import type { BoardState, Position } from "@/types/game";

import { checkForbiddenMove } from "@/logic/renjuRules";

import {
  findMiseTargetsLite,
  hasPotentialMiseTarget,
} from "../evaluation/tactics";
import { isNearExistingStone } from "../moveGenerator";
import { findVCFSequence, type VCFSearchOptions } from "./vcf";

/**
 * Mise-VCF探索オプション
 */
export interface MiseVCFSearchOptions {
  /** VCF探索オプション */
  vcfOptions?: VCFSearchOptions;
  /** 全体の時間制限（ミリ秒、デフォルト: 500） */
  timeLimit?: number;
}

/**
 * Mise-VCF探索結果
 */
export interface MiseVCFResult {
  /** 最初の手（ミセ手） */
  firstMove: Position;
  /** 全手順 [mise, defense, vcf1, vcf_defense1, ...] */
  sequence: Position[];
  /** 禁手追い込みによる勝ちかどうか */
  isForbiddenTrap: boolean;
  /** ミセ手 */
  miseMove: Position;
  /** 四三防御点 */
  defenseMove: Position;
}

/** デフォルトの時間制限（ミリ秒） */
const DEFAULT_TIME_LIMIT = 500;

/** デフォルトのVCF探索オプション */
const DEFAULT_VCF_OPTIONS: VCFSearchOptions = {
  maxDepth: 12,
  timeLimit: 300,
};

/**
 * Mise-VCF勝ち手を探索
 *
 * @param board 盤面
 * @param color 手番
 * @param options 探索オプション
 * @returns Mise-VCF勝ち手の位置、見つからなければnull
 */
export function findMiseVCFMove(
  board: BoardState,
  color: "black" | "white",
  options?: MiseVCFSearchOptions,
): Position | null {
  const result = findMiseVCFSequence(board, color, options);
  return result?.firstMove ?? null;
}

/**
 * Mise-VCF手順を探索
 *
 * アルゴリズム:
 * 1. 既存石の近傍の候補手を列挙
 * 2. 各候補手Mについて:
 *    a. Mを配置（in-place）
 *    b. findMiseTargetsでミセターゲットTを検出
 *    c. 各TにOpponent石を配置（防御）
 *    d. findVCFSequenceでVCF探索
 *    e. VCF成立 → MがMise-VCF勝ち手
 *    f. 全てundo
 *
 * @param board 盤面
 * @param color 手番
 * @param options 探索オプション
 * @returns Mise-VCF手順、見つからなければnull
 */
export function findMiseVCFSequence(
  board: BoardState,
  color: "black" | "white",
  options?: MiseVCFSearchOptions,
): MiseVCFResult | null {
  const timeLimit = options?.timeLimit ?? DEFAULT_TIME_LIMIT;
  const vcfOptions = options?.vcfOptions ?? DEFAULT_VCF_OPTIONS;
  const startTime = performance.now();
  const opponentColor = color === "black" ? "white" : "black";

  // 候補手を列挙（既存石の近傍の空きマス）
  for (let row = 0; row < 15; row++) {
    for (let col = 0; col < 15; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }

      // 黒番の禁手チェック: 三々禁・四四禁・長連禁の位置はスキップ
      if (color === "black") {
        const forbidden = checkForbiddenMove(board, row, col);
        if (forbidden.isForbidden) {
          continue;
        }
      }

      // 時間制限チェック
      if (performance.now() - startTime >= timeLimit) {
        return null;
      }

      // 候補手Mを配置（in-place）
      const moveRow = board[row];
      if (!moveRow) {
        continue;
      }
      moveRow[col] = color;

      // プリフィルタ: ミセターゲットが存在しうるか安価にチェック
      if (!hasPotentialMiseTarget(board, row, col, color)) {
        moveRow[col] = null;
        continue;
      }

      // ミセターゲットを検出（ライン延長点のみの軽量版）
      const miseTargets = findMiseTargetsLite(board, row, col, color);

      // 各ミセターゲットについてVCF探索
      for (const target of miseTargets) {
        // 時間制限チェック
        if (performance.now() - startTime >= timeLimit) {
          moveRow[col] = null;
          return null;
        }

        // 相手の強制応手（四三点を防御）
        const targetRow = board[target.row];
        if (!targetRow) {
          continue;
        }
        targetRow[target.col] = opponentColor;

        // VCF探索
        const vcfResult = findVCFSequence(board, color, vcfOptions);

        if (vcfResult) {
          // VCF成立！手順を構築してundo
          const miseMove: Position = { row, col };
          const defenseMove: Position = { row: target.row, col: target.col };

          const sequence: Position[] = [
            miseMove,
            defenseMove,
            ...vcfResult.sequence,
          ];

          // undo
          targetRow[target.col] = null;
          moveRow[col] = null;

          return {
            firstMove: miseMove,
            sequence,
            isForbiddenTrap: vcfResult.isForbiddenTrap,
            miseMove,
            defenseMove,
          };
        }

        // undo defense
        targetRow[target.col] = null;
      }

      // undo mise move
      moveRow[col] = null;
    }
  }

  return null;
}
