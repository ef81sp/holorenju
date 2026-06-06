import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";

import {
  buildForcedWinTreeFromArrays,
  linearTreeFromSequence,
  TREE_TERMINAL,
  type WireDefense,
  type WireNode,
} from "./forcedWinTreeWire";

const pos = (row: number, col: number): Position => ({ row, col });

describe("buildForcedWinTreeFromArrays", () => {
  it("空配列なら null", () => {
    expect(buildForcedWinTreeFromArrays([], [])).toBeNull();
  });

  it("線形チェイン [a0,d0,a1] を木へ復元する", () => {
    // node0: a0, defense → child node1
    // node1: a1, 終端
    const nodes: WireNode[] = [
      { attacker: pos(0, 0), defenseStart: 0, defenseCount: 1 },
      { attacker: pos(2, 2), defenseStart: 1, defenseCount: 0 },
    ];
    const defenses: WireDefense[] = [{ defender: pos(1, 1), childNode: 1 }];
    const tree = buildForcedWinTreeFromArrays(nodes, defenses);
    expect(tree).not.toBeNull();
    expect(tree?.attackerMove).toEqual(pos(0, 0));
    expect(tree?.defenses).toHaveLength(1);
    expect(tree?.defenses[0]?.defenderMove).toEqual(pos(1, 1));
    expect(tree?.defenses[0]?.next.attackerMove).toEqual(pos(2, 2));
    expect(tree?.defenses[0]?.next.defenses).toHaveLength(0);
  });

  it("複数防御ノード（分岐）を復元する", () => {
    // root: a0, defenses → [d0→node1(a1 終端), d1→node2(a2 終端)]
    const nodes: WireNode[] = [
      { attacker: pos(0, 0), defenseStart: 0, defenseCount: 2 },
      { attacker: pos(5, 5), defenseStart: 2, defenseCount: 0 },
      { attacker: pos(6, 6), defenseStart: 2, defenseCount: 0 },
    ];
    const defenses: WireDefense[] = [
      { defender: pos(1, 1), childNode: 1 },
      { defender: pos(2, 2), childNode: 2 },
    ];
    const tree = buildForcedWinTreeFromArrays(nodes, defenses);
    expect(tree?.defenses).toHaveLength(2);
    expect(tree?.defenses[0]?.next.attackerMove).toEqual(pos(5, 5));
    expect(tree?.defenses[1]?.next.attackerMove).toEqual(pos(6, 6));
  });

  it("child_node === TREE_TERMINAL の防御は除外する", () => {
    const nodes: WireNode[] = [
      { attacker: pos(0, 0), defenseStart: 0, defenseCount: 1 },
    ];
    const defenses: WireDefense[] = [
      { defender: pos(1, 1), childNode: TREE_TERMINAL },
    ];
    const tree = buildForcedWinTreeFromArrays(nodes, defenses);
    expect(tree?.defenses).toHaveLength(0);
  });
});

describe("linearTreeFromSequence", () => {
  it("空配列なら null", () => {
    expect(linearTreeFromSequence([])).toBeNull();
  });

  it("攻め始まり交互の手列を線形木へ変換する", () => {
    // [a0, d0, a1] → a0 -(d0)-> a1(終端)
    const tree = linearTreeFromSequence([pos(0, 0), pos(1, 1), pos(2, 2)]);
    expect(tree?.attackerMove).toEqual(pos(0, 0));
    expect(tree?.defenses).toHaveLength(1);
    expect(tree?.defenses[0]?.defenderMove).toEqual(pos(1, 1));
    const next = tree?.defenses[0]?.next;
    expect(next?.attackerMove).toEqual(pos(2, 2));
    expect(next?.defenses).toHaveLength(0);
  });

  it("単一手なら終端ノード（防御なし）", () => {
    const tree = linearTreeFromSequence([pos(5, 5)]);
    expect(tree?.attackerMove).toEqual(pos(5, 5));
    expect(tree?.defenses).toHaveLength(0);
  });
});
