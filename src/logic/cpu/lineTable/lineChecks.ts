/**
 * ビットマスク版 五連・長連判定
 *
 * renjuRules の checkFive/checkOverline と同一の判定を
 * LineTable のビットマスクで高速に行う。
 *
 * 前提: 判定対象の石は既に placeStone 済みであること。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import { countLineBit } from "./lineCounting";
import { CELL_LINES_FLAT } from "./lineMapping";

/**
 * ビットマスク版 checkFive
 *
 * 指定位置を含む連が「ちょうど5」の方向があれば true。
 * renjuRules の checkFive と同一の判定（黒白とも exactly 5）。
 */
export function checkFiveBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  for (let dirIndex = 0; dirIndex < 4; dirIndex++) {
    const packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex] ?? 0xffff;
    if (packed === 0xffff) {
      continue;
    }
    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    const count = countLineBit(blacks, whites, lineId, bitPos, color);
    if (count === 5) {
      return true;
    }
  }
  return false;
}

/**
 * ビットマスク版 checkOverline
 *
 * 指定位置を含む黒の連が6以上の方向があれば true。
 */
export function checkOverlineBit(
  blacks: Uint16Array,
  _whites: Uint16Array,
  row: number,
  col: number,
): boolean {
  for (let dirIndex = 0; dirIndex < 4; dirIndex++) {
    const packed = CELL_LINES_FLAT[(row * 15 + col) * 4 + dirIndex] ?? 0xffff;
    if (packed === 0xffff) {
      continue;
    }
    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    const count = countLineBit(blacks, _whites, lineId, bitPos, "black");
    if (count >= 6) {
      return true;
    }
  }
  return false;
}
