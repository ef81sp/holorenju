import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";
import type { ForcedWinNode } from "@/types/review";

import {
  buildForcedWinTreeFromArrays,
  spineWalkToBranches,
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

describe("spineWalkToBranches", () => {
  it("既定経路上の代替防御を defenseIndex 付きで列挙する", () => {
    // root(a0,idx0) defenses: [d0(主筋,idx1)→ next(a1,idx2 終端), d1(代替,idx1)→ alt(aX 終端)]
    const altLeaf: ForcedWinNode = { attackerMove: pos(9, 9), defenses: [] };
    const mainLeaf: ForcedWinNode = { attackerMove: pos(2, 2), defenses: [] };
    const root: ForcedWinNode = {
      attackerMove: pos(0, 0),
      defenses: [
        { defenderMove: pos(1, 1), next: mainLeaf },
        { defenderMove: pos(3, 3), next: altLeaf },
      ],
    };
    const branches = spineWalkToBranches(root);
    expect(branches).toHaveLength(1);
    expect(branches[0]?.defenseIndex).toBe(1); // 防御手は sequence index 1
    expect(branches[0]?.defenseMove).toEqual(pos(3, 3));
    expect(branches[0]?.continuation).toEqual([pos(9, 9)]); // alt 攻め手
  });

  it("2段目の主筋上の代替防御も拾う（defenseIndex=3）", () => {
    // 主筋: a0(0) d0(1) a1(2) d1(3) a2(4 終端)
    // a1 ノードに代替防御 d1' あり
    const a2: ForcedWinNode = { attackerMove: pos(4, 4), defenses: [] };
    const altLeaf: ForcedWinNode = { attackerMove: pos(8, 8), defenses: [] };
    const a1: ForcedWinNode = {
      attackerMove: pos(2, 2),
      defenses: [
        { defenderMove: pos(3, 3), next: a2 },
        { defenderMove: pos(7, 7), next: altLeaf },
      ],
    };
    const root: ForcedWinNode = {
      attackerMove: pos(0, 0),
      defenses: [{ defenderMove: pos(1, 1), next: a1 }],
    };
    const branches = spineWalkToBranches(root);
    expect(branches).toHaveLength(1);
    expect(branches[0]?.defenseIndex).toBe(3);
    expect(branches[0]?.defenseMove).toEqual(pos(7, 7));
    expect(branches[0]?.continuation).toEqual([pos(8, 8)]);
  });

  it("continuation は攻め始まり交互で平坦化される", () => {
    // 代替防御後に a,d,a と続く
    const leaf: ForcedWinNode = { attackerMove: pos(20, 20), defenses: [] };
    const mid: ForcedWinNode = {
      attackerMove: pos(10, 10),
      defenses: [{ defenderMove: pos(11, 11), next: leaf }],
    };
    const root: ForcedWinNode = {
      attackerMove: pos(0, 0),
      defenses: [
        {
          defenderMove: pos(1, 1),
          next: { attackerMove: pos(2, 2), defenses: [] },
        },
        { defenderMove: pos(3, 3), next: mid },
      ],
    };
    const branches = spineWalkToBranches(root);
    expect(branches[0]?.continuation).toEqual([
      pos(10, 10),
      pos(11, 11),
      pos(20, 20),
    ]);
  });
});
