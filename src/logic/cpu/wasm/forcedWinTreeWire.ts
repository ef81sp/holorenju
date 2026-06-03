/**
 * 詰み木ワイヤ形式のデコード（#22）
 *
 * Zig `writeForcedWinTree`（main.zig）が出力するフラットなアリーナ
 * （nodes / defenses 配列 + u16 index 参照）を、再帰的な `ForcedWinNode`
 * へ復元する純粋関数群。WASM メモリに依存しないため単体テスト可能。
 *
 * ワイヤ形式（little-endian）:
 *   node_count   (u16)
 *   defense_count(u16)
 *   node_count   × { row:u8, col:u8, defense_start:u16, defense_count:u16 }  (6B)
 *   defense_count× { row:u8, col:u8, child_node:u16 }                        (4B)
 *   node[0] = root。child_node === TREE_TERMINAL は終端（継続なし）。
 */

import type { Position } from "@/types/game";
import type { ForcedWinDefense, ForcedWinNode } from "@/types/review";

import type { VCTBranch } from "../search/types";

/** Zig 側 TREE_TERMINAL と一致（継続なしを表す番兵 index） */
export const TREE_TERMINAL = 0xffff;

/** 木復元・走査の安全上限（malformed buffer に対するガード） */
const MAX_TREE_DEPTH = 256;

/** デコード途中のフラットなノード表現 */
export interface WireNode {
  attacker: Position;
  defenseStart: number;
  defenseCount: number;
}

/** デコード途中のフラットな防御表現 */
export interface WireDefense {
  defender: Position;
  childNode: number;
}

/**
 * フラット配列から再帰的詰み木を復元する。root が無ければ null。
 *
 * child_node === TREE_TERMINAL の防御は継続ノードを持たない（truncation 等の
 * 退化ケース）ため除外する。正常な木では終端は「defenses が空のノード」で
 * 表現されるため、この除外は到達不能枝のみに作用する。
 */
export function buildForcedWinTreeFromArrays(
  nodes: WireNode[],
  defenses: WireDefense[],
): ForcedWinNode | null {
  if (nodes.length === 0) {
    return null;
  }
  return buildNode(0, nodes, defenses, 0);
}

function buildNode(
  idx: number,
  nodes: WireNode[],
  defenses: WireDefense[],
  depth: number,
): ForcedWinNode {
  const node = nodes[idx];
  if (!node || depth >= MAX_TREE_DEPTH) {
    return { attackerMove: { row: 0, col: 0 }, defenses: [] };
  }

  const out: ForcedWinDefense[] = [];
  for (let i = 0; i < node.defenseCount; i++) {
    const d = defenses[node.defenseStart + i];
    if (!d || d.childNode === TREE_TERMINAL) {
      continue;
    }
    out.push({
      defenderMove: d.defender,
      next: buildNode(d.childNode, nodes, defenses, depth + 1),
    });
  }
  return { attackerMove: node.attacker, defenses: out };
}

/**
 * 詰み木の既定経路（defenses[0] 連鎖 = 主筋）を走査し、各ノードの代替防御
 * （defenses[1..]）をフラットな分岐リストへ変換する（旧 forcedWinBranches 互換）。
 *
 * Phase A の一時シム: progressionModel を変更せずに済むよう、木から旧来の
 * フラット分岐表現を再生成する。Phase B で木を直接消費するようになれば撤去。
 */
export function spineWalkToBranches(root: ForcedWinNode): VCTBranch[] {
  const branches: VCTBranch[] = [];
  let node: ForcedWinNode | undefined = root;
  let pvIdx = 0; // node.attackerMove の sequence 内インデックス
  let guard = 0;
  while (node && guard < MAX_TREE_DEPTH) {
    guard++;
    if (node.defenses.length === 0) {
      break;
    }
    const defenseIndex = pvIdx + 1; // 防御手の sequence 内インデックス
    for (let i = 1; i < node.defenses.length; i++) {
      const d = node.defenses[i];
      if (!d) {
        continue;
      }
      branches.push({
        defenseIndex,
        defenseMove: d.defenderMove,
        continuation: flattenSpine(d.next),
      });
    }
    node = node.defenses[0]?.next;
    pvIdx += 2;
  }
  return branches;
}

/**
 * ノードから既定経路（defenses[0] 連鎖）を攻め始まり交互の手列へ平坦化する。
 * 返り値 = [攻め, 受け, 攻め, ...]（先頭は攻め手）。
 */
function flattenSpine(node: ForcedWinNode): Position[] {
  const out: Position[] = [];
  let cur: ForcedWinNode | undefined = node;
  let guard = 0;
  while (cur && guard < MAX_TREE_DEPTH) {
    guard++;
    out.push(cur.attackerMove);
    if (cur.defenses.length === 0) {
      break;
    }
    const [d0]: (ForcedWinDefense | undefined)[] = cur.defenses;
    if (!d0) {
      break;
    }
    out.push(d0.defenderMove);
    cur = d0.next;
  }
  return out;
}
