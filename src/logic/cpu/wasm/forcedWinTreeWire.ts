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
 * 攻め始まり交互の手列（[攻め, 受け, 攻め, ...]、末尾は攻めの勝ち手）から
 * 分岐のない線形の詰み木を構築する。VCF / 単一初手 VCT など Zig が木を出さない
 * 経路で `sequence` から木を合成するために使う。
 */
export function linearTreeFromSequence(
  sequence: Position[],
): ForcedWinNode | null {
  if (sequence.length === 0) {
    return null;
  }
  return linearNode(sequence, 0);
}

function linearNode(sequence: Position[], i: number): ForcedWinNode {
  const attacker = sequence[i] ?? { row: 0, col: 0 };
  const defender = sequence[i + 1];
  if (!defender) {
    return { attackerMove: attacker, defenses: [] };
  }
  const defense: ForcedWinDefense = {
    defenderMove: defender,
    next: linearNode(sequence, i + 2),
  };
  return { attackerMove: attacker, defenses: [defense] };
}
