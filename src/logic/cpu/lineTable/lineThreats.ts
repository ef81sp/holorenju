/**
 * ビットマスク版 四三ポテンシャル判定
 *
 * hasFourThreePotential のビットマスク版。
 * 仮置き位置に石を置いた場合に「四の候補方向」と「活三の候補方向」が
 * 異なる方向に存在するかを判定する。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import { countConsecutive, endStateAt } from "./lineCounting";
import { CELL_LINES_FLAT, LINE_LENGTHS } from "./lineMapping";

/**
 * hasFourThreePotential のビットマスク版
 *
 * 仮置き位置（空きセル）に石を置いた場合の四三ポテンシャルを
 * LineTable のビットマスク演算で判定する。
 *
 * 注: analyzeLinePattern の reversed フラグ（↗方向）は不要。
 * 四/活三判定は end1/end2 の順序に依存せず、
 * 「片端open」「両端open」のみを見るため。
 *
 * @param blacks LineTable の黒石ビットマスク
 * @param whites LineTable の白石ビットマスク
 * @param row 仮置き位置の行
 * @param col 仮置き位置の列
 * @param color 仮置きする石の色
 * @returns 四三ポテンシャルがあれば true
 */
export function hasFourThreePotentialBit(
  blacks: Uint16Array,
  whites: Uint16Array,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  let hasFour = false;
  let hasOpenThree = false;

  const base = (row * 15 + col) * 4;

  for (let d = 0; d < 4; d++) {
    const packed = CELL_LINES_FLAT[base + d]!;
    if (packed === 0xffff) {
      continue;
    }

    const lineId = packed >> 8;
    const bitPos = packed & 0xff;
    const ownMask = color === "black" ? blacks[lineId]! : whites[lineId]!;
    const oppMask = color === "black" ? whites[lineId]! : blacks[lineId]!;
    const len = LINE_LENGTHS[lineId]!;

    // 仮置き石は LineTable に未配置なので、bitPos 自体は含まない（countConsecutive の仕様通り）
    const posCount = countConsecutive(ownMask, bitPos, 1, len);
    const negCount = countConsecutive(ownMask, bitPos, -1, len);
    const total = posCount + negCount;

    const posEnd = endStateAt(oppMask, bitPos + posCount + 1, len);
    const negEnd = endStateAt(oppMask, bitPos - negCount - 1, len);

    // 四の候補: 3石 + 仮置き = 4石連続、片端open
    if (total >= 3 && (posEnd === "empty" || negEnd === "empty")) {
      hasFour = true;
    }
    // 活三の候補: 2石 + 仮置き = 3石連続、両端open
    // else if により四方向と必ず異なる方向にマッチ
    else if (total >= 2 && posEnd === "empty" && negEnd === "empty") {
      hasOpenThree = true;
    }

    if (hasFour && hasOpenThree) {
      return true;
    }
  }

  return false;
}
