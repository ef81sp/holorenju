/**
 * ビットマスク版ライン分析プリミティブ
 *
 * Phase 3a でも再利用する基本関数群。
 * analyzeLinePattern はこれらの合成関数として実装する（SRP/DRY）。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { EndState } from "../evaluation/patternScores";

import { LINE_LENGTHS } from "./lineMapping";

/**
 * ビットマスク上で bitPos から指定方向に連続する同色ビットを数える（起点は含まない）
 */
function countConsecutive(
  mask: number,
  bitPos: number,
  delta: number,
  lineLength: number,
): number {
  let count = 0;
  let b = bitPos + delta;
  while (b >= 0 && b < lineLength && mask & (1 << b)) {
    count++;
    b += delta;
  }
  return count;
}

/**
 * ビットマスク上の指定位置の端状態を判定
 */
function endStateAt(
  oppMask: number,
  pos: number,
  lineLength: number,
): EndState {
  if (pos < 0 || pos >= lineLength) {
    return "edge";
  }
  if (oppMask & (1 << pos)) {
    return "opponent";
  }
  return "empty";
}

/**
 * ビットマスク版 countLine
 *
 * bitPos から両方向に連続する同色石の数を返す（起点含む）。
 */
export function countLineBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): number {
  const mask = color === "black" ? blacks[lineId]! : whites[lineId]!;
  const len = LINE_LENGTHS[lineId]!;
  return (
    countConsecutive(mask, bitPos, 1, len) +
    countConsecutive(mask, bitPos, -1, len) +
    1
  );
}

/**
 * ビットマスク版 checkEnds
 *
 * bitPos を含む連の両端の状態を返す。
 * end1 = ビット正方向（bitPos増加方向）の端
 * end2 = ビット負方向（bitPos減少方向）の端
 */
export function checkEndsBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
): { end1: EndState; end2: EndState } {
  const ownMask = color === "black" ? blacks[lineId]! : whites[lineId]!;
  const oppMask = color === "black" ? whites[lineId]! : blacks[lineId]!;
  const len = LINE_LENGTHS[lineId]!;

  const posCount = countConsecutive(ownMask, bitPos, 1, len);
  const negCount = countConsecutive(ownMask, bitPos, -1, len);

  return {
    end1: endStateAt(oppMask, bitPos + posCount + 1, len),
    end2: endStateAt(oppMask, bitPos - negCount - 1, len),
  };
}
