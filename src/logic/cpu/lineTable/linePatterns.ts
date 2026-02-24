/**
 * ビットマスク版方向パターン分析
 *
 * analyzeDirection のビットマスク版。
 * countLineBit + checkEndsBit の合成関数。
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { DirectionPattern, EndState } from "../evaluation/patternScores";

import { LINE_LENGTHS } from "./lineMapping";

/**
 * analyzeDirection のビットマスク版
 *
 * 既存の DirectionPattern 型と同一の出力を返す。
 *
 * @param reversed true の場合 end1/end2 を反転する。
 *   ↗ライン（dirIndex=3）では物理的正方向（dr=1,dc=-1）が
 *   ビット負方向（bitPos減少）に対応するため反転が必要。
 */
export function analyzeLinePattern(
  blacks: Uint16Array,
  whites: Uint16Array,
  lineId: number,
  bitPos: number,
  color: "black" | "white",
  reversed?: boolean,
): DirectionPattern {
  const ownMask = color === "black" ? blacks[lineId]! : whites[lineId]!;
  const oppMask = color === "black" ? whites[lineId]! : blacks[lineId]!;
  const len = LINE_LENGTHS[lineId]!;

  // bitPos から正方向に連続する同色ビット数（起点含まない）
  let posCount = 0;
  for (let b = bitPos + 1; b < len; b++) {
    if (!(ownMask & (1 << b))) {
      break;
    }
    posCount++;
  }

  // bitPos から負方向に連続する同色ビット数（起点含まない）
  let negCount = 0;
  for (let b = bitPos - 1; b >= 0; b--) {
    if (!(ownMask & (1 << b))) {
      break;
    }
    negCount++;
  }

  const posEnd: EndState = getEndState(oppMask, bitPos + posCount + 1, len);
  const negEnd: EndState = getEndState(oppMask, bitPos - negCount - 1, len);

  return {
    count: posCount + negCount + 1,
    end1: reversed ? negEnd : posEnd,
    end2: reversed ? posEnd : negEnd,
  };
}

function getEndState(
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
