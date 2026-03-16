/**
 * LineTable ベースの高速四候補検出
 *
 * 72本のラインをビットマスクで走査し、「石を置くと四になる位置」を列挙する。
 * findFourMoves の盤面全体走査 O(225×25) に対し、O(72×ライン長) で済む。
 *
 * 検出パターン:
 * - 棒四: ●●●_ or _●●● の空き端 (run=3, 端open)
 * - 五連完成: ●●●●_ or _●●●● の空き端 (run>=4)
 * - 跳び四: ●●_● or ●_●● のギャップ位置 (2つのrunの間のギャップ)
 */

/* eslint-disable no-bitwise -- ビットマスク操作に必要 */

import type { Position } from "@/types/game";

import type { LineTable } from "./lineTable";

import { LINE_BIT_TO_CELL, LINE_LENGTHS } from "./lineMapping";

function addCandidate(
  seen: Uint8Array,
  result: Position[],
  lineId: number,
  bitPos: number,
): void {
  const cellIndex = LINE_BIT_TO_CELL[lineId * 16 + bitPos] ?? 0xffff;
  if (cellIndex === 0xffff || seen[cellIndex]) {
    return;
  }
  seen[cellIndex] = 1;
  result.push({ row: Math.floor(cellIndex / 15), col: cellIndex % 15 });
}

/**
 * LineTable から四を作れる位置を高速に列挙する
 *
 * ライン内の自石のrun（連続部分）を検出し、各runの延長点とギャップ点を列挙。
 *
 * @param lt LineTable
 * @param color 手番
 * @returns 四を作れる位置の配列（重複なし）
 */
export function findFourMovesFast(
  lt: LineTable,
  color: "black" | "white",
): Position[] {
  const seen = new Uint8Array(225);
  const result: Position[] = [];

  const ownArr = color === "black" ? lt.blacks : lt.whites;
  const oppArr = color === "black" ? lt.whites : lt.blacks;

  for (let lineId = 0; lineId < 72; lineId++) {
    const ownMask = ownArr[lineId] ?? 0;
    if (ownMask === 0) {
      continue;
    }
    const oppMask = oppArr[lineId] ?? 0;
    const len = LINE_LENGTHS[lineId] ?? 0;

    // ライン内のrunを検出: 連続する自石の開始位置と長さ
    let b = 0;
    while (b < len) {
      if (!(ownMask & (1 << b))) {
        b++;
        continue;
      }
      // run開始
      const start = b;
      while (b < len && ownMask & (1 << b)) {
        b++;
      }
      const runLen = b - start;
      // run = [start, start+runLen-1]

      if (runLen >= 3) {
        // 棒四/五連: 端の空きマスが候補
        // 正方向端
        const posEnd = start + runLen;
        if (
          posEnd < len &&
          !(oppMask & (1 << posEnd)) &&
          !(ownMask & (1 << posEnd))
        ) {
          addCandidate(seen, result, lineId, posEnd);
        }
        // 負方向端
        const negEnd = start - 1;
        if (
          negEnd >= 0 &&
          !(oppMask & (1 << negEnd)) &&
          !(ownMask & (1 << negEnd))
        ) {
          addCandidate(seen, result, lineId, negEnd);
        }

        // 跳び四（距離2）: ●_●●● — negEnd の更に手前が空きなら候補
        if (
          negEnd >= 0 &&
          !(oppMask & (1 << negEnd)) &&
          !(ownMask & (1 << negEnd))
        ) {
          const negEnd2 = negEnd - 1;
          if (
            negEnd2 >= 0 &&
            !(oppMask & (1 << negEnd2)) &&
            !(ownMask & (1 << negEnd2))
          ) {
            addCandidate(seen, result, lineId, negEnd2);
          }
        }
        // 跳び四（距離2）: ●●●_● — posEnd の更に先が空きなら候補
        if (
          posEnd < len &&
          !(oppMask & (1 << posEnd)) &&
          !(ownMask & (1 << posEnd))
        ) {
          const posEnd2 = posEnd + 1;
          if (
            posEnd2 < len &&
            !(oppMask & (1 << posEnd2)) &&
            !(ownMask & (1 << posEnd2))
          ) {
            addCandidate(seen, result, lineId, posEnd2);
          }
        }
      }

      if (runLen >= 2) {
        // 跳び四: run(2+) の端にギャップ1つ、その先に自石1+
        // 正方向: ●●_● — ギャップ位置が候補
        const posGap = start + runLen;
        if (
          posGap < len &&
          !(oppMask & (1 << posGap)) &&
          !(ownMask & (1 << posGap))
        ) {
          const beyond = posGap + 1;
          if (beyond < len && ownMask & (1 << beyond)) {
            addCandidate(seen, result, lineId, posGap);
          }
        }
        // 負方向: ●_●● — ギャップ位置が候補
        const negGap = start - 1;
        if (
          negGap >= 0 &&
          !(oppMask & (1 << negGap)) &&
          !(ownMask & (1 << negGap))
        ) {
          const beyond = negGap - 1;
          if (beyond >= 0 && ownMask & (1 << beyond)) {
            addCandidate(seen, result, lineId, negGap);
          }
        }
      }

      if (runLen === 1) {
        // 跳び四: ●_●_● — この単石の両側にギャップ+自石2+がある場合
        // ここでは単石の端のギャップ先に run(2+) がある場合のみ
        // 正方向: (1石) gap (2+石) → ギャップ位置が候補
        const posGap = start + 1;
        if (
          posGap < len &&
          !(oppMask & (1 << posGap)) &&
          !(ownMask & (1 << posGap))
        ) {
          const beyondStart = posGap + 1;
          if (beyondStart < len && ownMask & (1 << beyondStart)) {
            let beyondLen = 0;
            let bx = beyondStart;
            while (bx < len && ownMask & (1 << bx)) {
              beyondLen++;
              bx++;
            }
            if (beyondLen >= 2) {
              addCandidate(seen, result, lineId, posGap);
            }
          }
        }
        // 負方向: (2+石) gap (1石) → ギャップ位置が候補
        const negGap = start - 1;
        if (
          negGap >= 0 &&
          !(oppMask & (1 << negGap)) &&
          !(ownMask & (1 << negGap))
        ) {
          const beyondStart = negGap - 1;
          if (beyondStart >= 0 && ownMask & (1 << beyondStart)) {
            let beyondLen = 0;
            let bx = beyondStart;
            while (bx >= 0 && ownMask & (1 << bx)) {
              beyondLen++;
              bx--;
            }
            if (beyondLen >= 2) {
              addCandidate(seen, result, lineId, negGap);
            }
          }
        }
      }
    }
  }

  return result;
}
