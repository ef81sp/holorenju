/**
 * 72ライン一括走査エンジン
 *
 * evaluateBoard の stonePatterns + scanFourThreeThreat の両方が必要とする
 * データを1回のライン走査で事前計算する。
 *
 * 非リエントラント制約: モジュールスコープの事前確保配列を使用。
 * evaluateBoard の探索ループ内で再帰呼び出しされる場合はデータが上書きされる。
 * 現行の evaluateBoard は末端評価で再帰しないため問題ないが、将来変更時に注意。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import {
  getPatternScore,
  getPatternType,
} from "../evaluation/directionAnalysis";
import {
  registerRebuildPackedTables,
  type EndState,
} from "../evaluation/patternScores";
import { countConsecutive, endStateAt } from "./lineCounting";
import {
  getDirIndexFromLineId,
  LINE_BIT_TO_CELL,
  LINE_LENGTHS,
} from "./lineMapping";

// ─── パッキング形式 ───
// DirectionPattern を 8bit にパック:
// bit 7-4: count (1-15, 0=未使用)
// bit 3-2: end1 (0=edge, 1=opponent, 2=empty)
// bit 1-0: end2 (同上)
//
// ↗方向 (dirIndex=3) は reversed: end1←negEnd, end2←posEnd

// ─── テーブル構築ユーティリティ（初期化で使用するため先頭に配置） ───

const END_CODE_EDGE = 0;
const END_CODE_OPPONENT = 1;
const END_CODE_EMPTY = 2;

const END_STATE_FROM_CODE: EndState[] = ["edge", "opponent", "empty"];

const TYPE_CODE_MAP: Record<string, number> = {
  five: 1,
  openFour: 2,
  four: 3,
  openThree: 4,
  three: 5,
  openTwo: 6,
  two: 7,
};

function unpackPattern(packed: number): {
  count: number;
  end1: EndState;
  end2: EndState;
} {
  return {
    count: packed >> 4,
    end1: END_STATE_FROM_CODE[(packed >> 2) & 3] ?? "edge",
    end2: END_STATE_FROM_CODE[packed & 3] ?? "edge",
  };
}

function buildPackedToScore(): Int16Array {
  const table = new Int16Array(256);
  for (let packed = 0; packed < 256; packed++) {
    const { count, end1, end2 } = unpackPattern(packed);
    if (count === 0) {
      table[packed] = 0;
      continue;
    }
    table[packed] = getPatternScore({ count, end1, end2 });
  }
  return table;
}

function buildPackedToType(): Uint8Array {
  const table = new Uint8Array(256);
  for (let packed = 0; packed < 256; packed++) {
    const { count, end1, end2 } = unpackPattern(packed);
    if (count === 0) {
      table[packed] = 0;
      continue;
    }
    const type = getPatternType({ count, end1, end2 });
    table[packed] = type ? (TYPE_CODE_MAP[type] ?? 0) : 0;
  }
  return table;
}

// ─── ルックアップテーブル ───

/**
 * packed byte → score (getPatternScore と等価)。256 entries × 2 bytes = 512 bytes
 *
 * FIVE(100000) は Int16Array の範囲外で clamp されるが、
 * 五連は minimax の勝敗判定で処理されるため、PACKED_TO_SCORE 経由での参照は
 * count <= 4 のパターンのみ（全て Int16 範囲内: max OPEN_FOUR=10000）。
 */
export let PACKED_TO_SCORE: Int16Array = buildPackedToScore();

/**
 * packed byte → type code (getPatternType と等価)
 * 0=null, 1=five, 2=openFour, 3=four, 4=openThree, 5=three, 6=openTwo, 7=two
 * 256 entries × 1 byte = 256 bytes
 */
export let PACKED_TO_TYPE: Uint8Array = buildPackedToType();

/** type code 定数 */
export const TYPE_FOUR = 3;
export const TYPE_OPEN_THREE = 4;

/**
 * PATTERN_SCORES 変更時にルックアップテーブルを再構築。
 * applyPatternScoreOverrides から呼び出される。
 */
export function rebuildPackedTables(): void {
  PACKED_TO_SCORE = buildPackedToScore();
  PACKED_TO_TYPE = buildPackedToType();
}

// ─── 事前計算バッファ（非リエントラント） ───

/** _xxxPatterns[cellIndex * 4 + dirIndex] = packed DirectionPattern */
const _blackPatterns = new Uint8Array(900); // 225 × 4
const _whitePatterns = new Uint8Array(900);
/** _xxxFlags[cellIndex] = bit 0-3: 四候補方向, bit 4-7: 活三候補方向 */
const _blackFlags = new Uint8Array(225);
const _whiteFlags = new Uint8Array(225);

/**
 * 72ライン一括走査
 *
 * 1回の走査で黒・白両方のデータを計算:
 * - 占有セル → packed DirectionPattern (_xxxPatterns)
 * - 空セル → 四/三候補フラグ (_xxxFlags)
 *
 * .fill(0) で前回データを完全クリア（非リエントラント制約下で安全性を担保）。
 *
 * evaluateBoard の冒頭で1回呼び出す。
 */
export function precomputeLineFeatures(
  blacks: Uint16Array,
  whites: Uint16Array,
): void {
  _blackPatterns.fill(0);
  _whitePatterns.fill(0);
  _blackFlags.fill(0);
  _whiteFlags.fill(0);

  for (let lineId = 0; lineId < 72; lineId++) {
    const bMask = blacks[lineId] ?? 0;
    const wMask = whites[lineId] ?? 0;
    const len = LINE_LENGTHS[lineId] ?? 0;
    const dirIndex = getDirIndexFromLineId(lineId);
    const isReversed = dirIndex === 3;

    // ─── 占有セルのパターン計算 ───
    if (bMask) {
      processOccupied(
        bMask,
        wMask,
        len,
        lineId,
        dirIndex,
        isReversed,
        _blackPatterns,
      );
    }
    if (wMask) {
      processOccupied(
        wMask,
        bMask,
        len,
        lineId,
        dirIndex,
        isReversed,
        _whitePatterns,
      );
    }

    // ─── 空セルの四/三候補フラグ計算 ───
    // popcount >= 2 のラインのみ（四: 3石+仮置き, 活三: 2石+仮置き）
    if (bMask && bMask & (bMask - 1)) {
      processEmpty(bMask, wMask, len, lineId, dirIndex, _blackFlags);
    }
    if (wMask && wMask & (wMask - 1)) {
      processEmpty(wMask, bMask, len, lineId, dirIndex, _whiteFlags);
    }
  }
}

export {
  _blackPatterns as precomputedBlackPatterns,
  _whitePatterns as precomputedWhitePatterns,
  _blackFlags as precomputedBlackFlags,
  _whiteFlags as precomputedWhiteFlags,
};

// ─── 内部関数 ───

function endStateToCode(e: EndState): number {
  if (e === "empty") {
    return END_CODE_EMPTY;
  }
  if (e === "opponent") {
    return END_CODE_OPPONENT;
  }
  return END_CODE_EDGE;
}

function processOccupied(
  ownMask: number,
  oppMask: number,
  len: number,
  lineId: number,
  dirIndex: number,
  isReversed: boolean,
  out: Uint8Array,
): void {
  let bits = ownMask;
  while (bits) {
    const bitPos = 31 - Math.clz32(bits & -bits);
    bits &= bits - 1;

    const posCount = countConsecutive(ownMask, bitPos, 1, len);
    const negCount = countConsecutive(ownMask, bitPos, -1, len);
    const count = posCount + negCount + 1;

    const posEnd = endStateAt(oppMask, bitPos + posCount + 1, len);
    const negEnd = endStateAt(oppMask, bitPos - negCount - 1, len);

    // ↗方向は end1/end2 を反転
    const e1 = isReversed ? negEnd : posEnd;
    const e2 = isReversed ? posEnd : negEnd;

    const e1Code = endStateToCode(e1);
    const e2Code = endStateToCode(e2);

    const cellIndex = LINE_BIT_TO_CELL[lineId * 16 + bitPos] ?? 0;
    out[cellIndex * 4 + dirIndex] = (count << 4) | (e1Code << 2) | e2Code;
  }
}

function processEmpty(
  ownMask: number,
  oppMask: number,
  len: number,
  lineId: number,
  dirIndex: number,
  out: Uint8Array,
): void {
  const validMask = (1 << len) - 1;
  const emptyMask = ~(ownMask | oppMask) & validMask;
  const fourBit = 1 << dirIndex;
  const threeBit = 1 << (dirIndex + 4);

  let bits = emptyMask;
  while (bits) {
    const bitPos = 31 - Math.clz32(bits & -bits);
    bits &= bits - 1;

    const posCount = countConsecutive(ownMask, bitPos, 1, len);
    const negCount = countConsecutive(ownMask, bitPos, -1, len);
    const total = posCount + negCount;
    if (total < 2) {
      continue;
    }

    const posEnd = endStateAt(oppMask, bitPos + posCount + 1, len);
    const negEnd = endStateAt(oppMask, bitPos - negCount - 1, len);

    const cellIndex = LINE_BIT_TO_CELL[lineId * 16 + bitPos] ?? 0;

    // 四候補: total >= 3, 片端 open
    if (total >= 3 && (posEnd === "empty" || negEnd === "empty")) {
      out[cellIndex] = (out[cellIndex] ?? 0) | fourBit;
    }
    // 活三候補: total >= 2, 両端 open
    // else if により同方向のビットが fourDirs/threeDirs に同時に立つことはない
    else if (posEnd === "empty" && negEnd === "empty") {
      out[cellIndex] = (out[cellIndex] ?? 0) | threeBit;
    }
  }
}

// ─── テスト用ユーティリティエクスポート ───

export { END_STATE_FROM_CODE, unpackPattern };

// ─── コールバック登録 ───
// applyPatternScoreOverrides 時に PACKED_TO_SCORE/TYPE を再構築するためのコールバック。
// 循環参照を避けるため、patternScores.ts 側にコールバック方式で登録。
registerRebuildPackedTables(rebuildPackedTables);
