/**
 * VCT探索のヘルパー関数
 *
 * VCT探索で使用する脅威検出・防御位置取得の非再帰ヘルパー群。
 *
 * 禁止: vct からのインポート
 */

import type { BoardState, Position } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { checkFive } from "@/logic/renjuRules";

import type { DirectionPattern } from "../evaluation/patternScores";
import type { LineTable } from "../lineTable/lineTable";

import { DIRECTION_INDICES, DIRECTIONS } from "../core/constants";
import { checkEnds, countLine, getLineEnds } from "../core/lineAnalysis";
import { analyzeDirection } from "../evaluation/directionAnalysis";
import {
  isValidConsecutiveThree,
  isValidJumpThree,
} from "../evaluation/jumpPatterns";
import { getOpenThreeDefensePositions } from "../evaluation/threatDetection";
import { createsFourThree } from "../evaluation/winningPatterns";
import { LINE_BIT_TO_CELL, LINE_LENGTHS } from "../lineTable/lineMapping";
import { isNearExistingStone } from "../moveGenerator";
import {
  findJumpGapPosition,
  getJumpThreeDefensePositions,
} from "../patterns/threatAnalysis";
// #43 PR-3: 葉プリミティブ（図形/禁手判定）を Zig アダプタへ委譲。TS オーケストレーション
// （本ファイルの VCT 検証ロジック）は温存し、patterns.ts/forbiddenMoves.ts への依存を断つ。
import { isForbiddenForBlack } from "../wasm/forbiddenAdapter";
import { checkJumpFour, checkJumpThree } from "../wasm/patternsAdapter";
import { classifyThreat } from "./threatMoves";

/**
 * 連続活三（跳び四の一部でない）かを判定するヘルパー
 *
 * hasOpenThree と getCreatedOpenThreeDefenses で共通使用。
 * detectOpponentThreats は isJumpFour フラグ方式で二重呼び出しを回避しているため適用しない。
 */
function isConsecutiveOpenThree(
  board: BoardState,
  row: number,
  col: number,
  dirIndex: number,
  color: "black" | "white",
  pattern: DirectionPattern,
): boolean {
  return (
    pattern.count === 3 &&
    pattern.end1 === "empty" &&
    pattern.end2 === "empty" &&
    !checkJumpFour(board, row, col, dirIndex, color)
  );
}

/**
 * 指定色がミセ手（1手で四三を作れる手）を持っているかチェック
 *
 * ミセ手は活三より強い反撃脅威（四三は止められない）であり、
 * 活三と同様にVCTの三脅威を無効化する。
 *
 * @param board 盤面
 * @param color チェック対象の色
 * @returns ミセ手があればtrue
 */
export function hasFourThreeAvailable(
  board: BoardState,
  color: "black" | "white",
): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, row, col)) {
        continue;
      }
      if (color === "black" && isForbiddenForBlack(board, row, col)) {
        continue;
      }
      if (createsFourThree(board, row, col, color)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 指定色が活三（連続三で両端空き）を持っているかチェック
 *
 * 活三を持つ相手がいる場合、相手は三を無視して四を打てるため、
 * VCT（三を含む脅威連続）は成立しない。VCF（四追い）のみが有効。
 *
 * lineTable が渡された場合、ビットマスク走査で高速化。
 *
 * @param board 盤面
 * @param color チェック対象の色
 * @param lineTable LineTable（高速版使用時）
 * @returns 活三があればtrue
 */
export function hasOpenThree(
  board: BoardState,
  color: "black" | "white",
  lineTable?: LineTable,
): boolean {
  if (lineTable) {
    return hasOpenThreeFast(lineTable, color);
  }
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (board[row]?.[col] !== color) {
        continue;
      }
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
        const pattern = analyzeDirection(board, row, col, dr, dc, color);
        // 連続活三（跳び四の一部である連続三は活三ではない）
        if (isConsecutiveOpenThree(board, row, col, dirIndex, color, pattern)) {
          return true;
        }
        // 跳び三（○○_○ や ○_○○）
        if (
          pattern.count !== 3 &&
          checkJumpThree(board, row, col, dirIndex, color)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

/**
 * LineTable ビットマスクで活三を検出する高速版
 *
 * 72ラインを走査し、連続活三（_○○○_）と跳び三（_○○_○_, _○_○○_）を検出。
 * 連続活三は跳び四（○○○_○, ○_○○○）の一部を除外する。
 *
 * 225セル × 4方向の走査を 72ライン × ウィンドウスキャンに置換。
 */
function hasOpenThreeFast(lt: LineTable, color: "black" | "white"): boolean {
  const ownArr = color === "black" ? lt.blacks : lt.whites;
  const oppArr = color === "black" ? lt.whites : lt.blacks;

  for (let lineId = 0; lineId < 72; lineId++) {
    const own = ownArr[lineId] ?? 0;
    if (!own) {
      continue;
    }
    if (!(own & (own - 1))) {
      continue;
    } // popcount < 2 → スキップ

    const opp = oppArr[lineId] ?? 0;
    const len = LINE_LENGTHS[lineId] ?? 0;

    // 連続活三: _○○○_ (5セルウィンドウ)
    for (let s = 0; s <= len - 5; s++) {
      const wm = 0x1f << s;
      if (opp & wm) {
        continue;
      }
      // own が start+1, start+2, start+3 にちょうど3石
      const expected = 0x0e << s; // 01110
      if ((own & wm) !== expected) {
        continue;
      }
      // 跳び四除外: start-1 or start+5 に自石があれば ○_○○○ or ○○○_○
      if (s >= 1 && own & (1 << (s - 1))) {
        continue;
      }
      if (s + 5 < len && own & (1 << (s + 5))) {
        continue;
      }
      return true;
    }

    // 跳び三: _○○_○_ / _○_○○_ (6セルウィンドウ)
    for (let s = 0; s <= len - 6; s++) {
      const wm6 = 0x3f << s;
      if (opp & wm6) {
        continue;
      }
      // _○○_○_: bits at s+1, s+2, s+4
      const p1 = (1 << (s + 1)) | (1 << (s + 2)) | (1 << (s + 4));
      if ((own & wm6) === p1) {
        return true;
      }
      // _○_○○_: bits at s+1, s+3, s+4
      const p2 = (1 << (s + 1)) | (1 << (s + 3)) | (1 << (s + 4));
      if ((own & wm6) === p2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 脅威（四・活三）を作れる位置を列挙
 * 四を優先的に列挙（枝刈り効率のため）
 *
 * lineTable が渡された場合、5セルウィンドウスキャンで候補をフィルタして高速化。
 */
export function findThreatMoves(
  board: BoardState,
  color: "black" | "white",
  lineTable?: LineTable,
): Position[] {
  if (lineTable) {
    return findThreatMovesFast(board, color, lineTable);
  }
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

      // 四と活三を1パスで判定
      const threat = classifyThreat(board, row, col, color);

      // 元に戻す（Undo）
      if (rowArray) {
        rowArray[col] = null;
      }

      if (!threat.createsFour && !threat.createsOpenThree) {
        continue;
      }

      // 禁手チェックは脅威を作る手だけに限定
      if (color === "black" && isForbiddenForBlack(board, row, col)) {
        continue;
      }

      if (threat.createsFour) {
        fourMoves.push({ row, col });
      } else {
        openThreeMoves.push({ row, col });
      }
    }
  }

  // 四を優先して返す
  return [...fourMoves, ...openThreeMoves];
}

/** 候補セルフラグバッファ（非リエントラント、モジュールスコープで再利用） */
const _candidates = new Uint8Array(225);

/**
 * LineTable の5セルウィンドウスキャンで候補セルを特定し、classifyThreat を適用する高速版
 *
 * 72ラインの5セルウィンドウを走査し、相手石がなく自石2個以上のウィンドウ内の
 * 空セルを候補としてフラグ。連続パターン（○○○_）と跳びパターン（○_○○）の両方を検出。
 * 候補セルのみに classifyThreat を適用することで走査数を ~40 → ~10-20 に削減。
 *
 * 非リエントラント安全性: 返却時にローカル Position[] を構築済みのため、
 * VCT再帰で再呼び出しされてもバッファ競合なし。
 */
function findThreatMovesFast(
  board: BoardState,
  color: "black" | "white",
  lt: LineTable,
): Position[] {
  const ownArr = color === "black" ? lt.blacks : lt.whites;
  const oppArr = color === "black" ? lt.whites : lt.blacks;

  // 5セルウィンドウスキャンで候補セルをフラグ
  _candidates.fill(0);
  for (let lineId = 0; lineId < 72; lineId++) {
    const own = ownArr[lineId] ?? 0;
    if (!own) {
      continue;
    }
    // 2石未満のラインはスキップ（四: 3石+仮置き, 活三: 2石+仮置き）
    if (!(own & (own - 1))) {
      continue;
    }

    const opp = oppArr[lineId] ?? 0;
    const len = LINE_LENGTHS[lineId] ?? 0;

    for (let start = 0; start <= len - 5; start++) {
      const windowMask = 0x1f << start;
      // 相手石があるウィンドウはスキップ
      if (opp & windowMask) {
        continue;
      }
      // 自石2個未満のウィンドウはスキップ
      const windowOwn = own & windowMask;
      if (!(windowOwn & (windowOwn - 1))) {
        continue;
      }

      // ウィンドウ内の空セルを候補に追加
      const emptyInWindow = ~(own | opp) & windowMask;
      let eBits = emptyInWindow;
      while (eBits) {
        const bp = 31 - Math.clz32(eBits & -eBits);
        eBits &= eBits - 1;
        const ci = LINE_BIT_TO_CELL[lineId * 16 + bp];
        if (ci !== undefined && ci !== 0xffff) {
          _candidates[ci] = 1;
        }
      }
    }
  }

  // 候補セルのみに classifyThreat を適用
  const fourMoves: Position[] = [];
  const openThreeMoves: Position[] = [];
  for (let i = 0; i < 225; i++) {
    if (!_candidates[i]) {
      continue;
    }
    const row = Math.floor(i / 15);
    const col = i % 15;
    if (board[row]?.[col] !== null) {
      continue;
    }

    const rowArray = board[row];
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

    const threat = classifyThreat(board, row, col, color);
    if (rowArray) {
      rowArray[col] = null;
    }

    if (!threat.createsFour && !threat.createsOpenThree) {
      continue;
    }

    // 禁手チェックは脅威を作る手だけに限定
    if (color === "black" && isForbiddenForBlack(board, row, col)) {
      continue;
    }

    if (threat.createsFour) {
      fourMoves.push({ row, col });
    } else {
      openThreeMoves.push({ row, col });
    }
  }
  fourMoves.push(...openThreeMoves);
  return fourMoves;
}

/* eslint-enable no-bitwise */

/**
 * 脅威が成立しているかチェック（四または活三）
 */
export function isThreat(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  const result = classifyThreat(board, row, col, color);
  return result.createsFour || result.createsOpenThree;
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
 * 指定位置に石を置いた際に作られた活三/飛び三の防御位置を返す
 *
 * Mise-VCFのノリ手検証で使用。ミセ手は必ず三に含まれるため、
 * 4方向チェックで十分（全盤面スキャン不要）。
 */
export function getCreatedOpenThreeDefenses(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): Position[] {
  const defenses: Position[] = [];
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
    const pattern = analyzeDirection(board, row, col, dr, dc, color);
    // 連続活三（跳び四の一部は除外、黒の場合はウソの三を除外）
    if (
      isConsecutiveOpenThree(board, row, col, dirIndex, color, pattern) &&
      (color !== "black" || isValidConsecutiveThree(board, row, col, dirIndex))
    ) {
      defenses.push(
        ...getOpenThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
    // 飛び三（黒の場合はウソの三を除外）
    if (
      pattern.count !== 3 &&
      checkJumpThree(board, row, col, dirIndex, color) &&
      (color !== "black" || isValidJumpThree(board, row, col, dirIndex))
    ) {
      defenses.push(
        ...getJumpThreeDefensePositions(board, row, col, dr, dc, color),
      );
    }
  }
  // 重複除去 + 空きマスのみ
  const unique = new Map<string, Position>();
  for (const pos of defenses) {
    if (board[pos.row]?.[pos.col] !== null) {
      continue;
    }
    const key = `${pos.row},${pos.col}`;
    if (!unique.has(key)) {
      unique.set(key, pos);
    }
  }
  return Array.from(unique.values());
}
