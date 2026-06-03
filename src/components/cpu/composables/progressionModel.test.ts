/**
 * progressionModel（振り返り進行ツリーの純粋ロジック）のテスト
 *
 * リアクティブ環境を構築せずに PV 構築・分岐正規化・行展開・可視手列を検証する。
 */

import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";
import type {
  EvaluatedMove,
  ForcedWinBranch,
  ReviewCandidate,
} from "@/types/review";

import {
  type ProgressionTab,
  buildForcedLossPV,
  buildInlineBranches,
  buildPV,
  buildRows,
  buildTopTabs,
  buildVisibleItems,
  findBestCandidate,
  findPlayedCandidate,
  forcedLossLabelOf,
} from "./progressionModel";

const pos = (row: number, col: number): Position => ({ row, col });

function candidate(overrides: Partial<ReviewCandidate>): ReviewCandidate {
  return {
    position: pos(7, 7),
    score: 0,
    searchScore: 0,
    ...overrides,
  };
}

function evaluatedMove(overrides: Partial<EvaluatedMove>): EvaluatedMove {
  return {
    moveIndex: 1,
    position: pos(7, 7),
    isPlayerMove: true,
    quality: "good",
    playedScore: 0,
    bestScore: 0,
    scoreDiff: 0,
    bestMove: pos(7, 7),
    candidates: [],
    ...overrides,
  };
}

describe("buildPV", () => {
  it("principalVariation を手番交互の PVDisplayItem[] に変換する", () => {
    const c = candidate({
      principalVariation: [pos(0, 0), pos(1, 1), pos(2, 2)],
    });
    const pv = buildPV(c, 5, true);
    expect(pv.map((i) => i.isSelf)).toEqual([true, false, true]);
    expect(pv.map((i) => i.moveNum)).toEqual([5, 6, 7]);
  });

  it("selfFirst=false で先頭が相手手になる", () => {
    const c = candidate({ principalVariation: [pos(0, 0), pos(1, 1)] });
    expect(buildPV(c, 0, false).map((i) => i.isSelf)).toEqual([false, true]);
  });

  it("principalVariation 未設定・空なら空配列", () => {
    expect(buildPV(candidate({}), 0, true)).toEqual([]);
    expect(buildPV(candidate({ principalVariation: [] }), 0, true)).toEqual([]);
  });

  it("null の穴で打ち切る", () => {
    const c = candidate({
      principalVariation: [pos(0, 0), null as unknown as Position, pos(2, 2)],
    });
    expect(buildPV(c, 0, true)).toHaveLength(1);
  });
});

describe("findBestCandidate / findPlayedCandidate", () => {
  it("bestMove に一致する候補を返す", () => {
    const eval_ = evaluatedMove({
      bestMove: pos(3, 3),
      candidates: [
        candidate({ position: pos(1, 1) }),
        candidate({ position: pos(3, 3) }),
      ],
    });
    expect(findBestCandidate(eval_)?.position).toEqual(pos(3, 3));
  });

  it("一致が無ければ先頭候補にフォールバック", () => {
    const eval_ = evaluatedMove({
      bestMove: pos(9, 9),
      candidates: [candidate({ position: pos(1, 1) })],
    });
    expect(findBestCandidate(eval_)?.position).toEqual(pos(1, 1));
  });

  it("候補が空なら null", () => {
    expect(findBestCandidate(evaluatedMove({ candidates: [] }))).toBeNull();
  });

  it("findPlayedCandidate は position 一致を返す", () => {
    const eval_ = evaluatedMove({
      position: pos(2, 2),
      candidates: [
        candidate({ position: pos(1, 1) }),
        candidate({ position: pos(2, 2) }),
      ],
    });
    expect(findPlayedCandidate(eval_)?.position).toEqual(pos(2, 2));
    const miss = evaluatedMove({
      position: pos(8, 8),
      candidates: [candidate({ position: pos(1, 1) })],
    });
    expect(findPlayedCandidate(miss)).toBeNull();
  });
});

describe("buildForcedLossPV", () => {
  it("先頭にプレイヤー着手を差し込み、以降は相手始まりの交互", () => {
    const eval_ = evaluatedMove({
      moveIndex: 10,
      position: pos(5, 5),
      forcedLossSequence: [pos(0, 0), pos(1, 1), pos(2, 2)],
    });
    const pv = buildForcedLossPV(eval_, 10);
    // [played(self), seq0(opp), seq1(self), seq2(opp)]
    expect(pv.map((i) => i.isSelf)).toEqual([true, false, true, false]);
    expect(pv.map((i) => i.moveNum)).toEqual([10, 11, 12, 13]);
    expect(pv[0]?.position).toEqual(pos(5, 5));
  });

  it("forcedLossSequence が無ければ空配列", () => {
    expect(buildForcedLossPV(evaluatedMove({}), 0)).toEqual([]);
  });
});

describe("forcedLossLabelOf", () => {
  it("forcedLossType から 被ラベルを生成", () => {
    expect(forcedLossLabelOf(evaluatedMove({ forcedLossType: "vct" }))).toBe(
      "被追詰",
    );
    expect(
      forcedLossLabelOf(evaluatedMove({ forcedLossType: "double-four" })),
    ).toBe("被四四");
  });

  it("forcedLossType が無ければ null", () => {
    expect(forcedLossLabelOf(evaluatedMove({}))).toBeNull();
  });
});

describe("buildInlineBranches", () => {
  const branch: ForcedWinBranch = {
    defenseIndex: 2,
    defenseMove: pos(4, 4),
    continuation: [pos(0, 0), pos(1, 1)],
  };

  it("win: pvIdx=defenseIndex、防御手=相手、continuation 先頭=自分", () => {
    const [b] = buildInlineBranches([branch], 10, "win");
    expect(b?.id).toBe("win-0");
    expect(b?.pvIdx).toBe(2);
    expect(b?.defenseMove.isSelf).toBe(false);
    expect(b?.defenseMove.moveNum).toBe(12); // moveIndex(10)+defenseIndex(2)
    expect(b?.continuation.map((i) => i.isSelf)).toEqual([true, false]);
    expect(b?.continuation.map((i) => i.moveNum)).toEqual([13, 14]);
  });

  it("loss: pvIdx=defenseIndex+1、防御手=自分、continuation 先頭=相手", () => {
    const [b] = buildInlineBranches([branch], 10, "loss");
    expect(b?.id).toBe("loss-0");
    expect(b?.pvIdx).toBe(3); // defenseIndex(2)+1
    expect(b?.defenseMove.isSelf).toBe(true);
    expect(b?.defenseMove.moveNum).toBe(13); // moveIndex(10)+defenseIndex(2)+1
    expect(b?.continuation.map((i) => i.isSelf)).toEqual([false, true]);
    expect(b?.continuation.map((i) => i.moveNum)).toEqual([14, 15]);
  });

  it("continuation の null 穴で打ち切る", () => {
    const holed: ForcedWinBranch = {
      defenseIndex: 0,
      defenseMove: pos(4, 4),
      continuation: [pos(0, 0), null as unknown as Position, pos(2, 2)],
    };
    expect(
      buildInlineBranches([holed], 0, "win")[0]?.continuation,
    ).toHaveLength(1);
  });
});

describe("buildTopTabs", () => {
  it("null なら空配列（ガードの集約点）", () => {
    expect(buildTopTabs(null, 0)).toEqual([]);
  });

  it("best / played タブを構築する", () => {
    const eval_ = evaluatedMove({
      moveIndex: 0,
      position: pos(2, 2),
      bestMove: pos(1, 1),
      candidates: [
        candidate({
          position: pos(1, 1),
          principalVariation: [pos(1, 1), pos(9, 9)],
        }),
        candidate({
          position: pos(2, 2),
          principalVariation: [pos(2, 2), pos(8, 8)],
        }),
      ],
    });
    const tabs = buildTopTabs(eval_, 0);
    expect(tabs.map((t) => t.id)).toEqual(["best", "played"]);
    expect(tabs[0]?.basePV[0]?.position).toEqual(pos(1, 1));
  });

  it("forcedLossSequence があれば played を抑制し loss タブを出す", () => {
    const eval_ = evaluatedMove({
      moveIndex: 0,
      position: pos(2, 2),
      bestMove: pos(1, 1),
      candidates: [
        candidate({ position: pos(1, 1), principalVariation: [pos(1, 1)] }),
        candidate({ position: pos(2, 2), principalVariation: [pos(2, 2)] }),
      ],
      forcedLossType: "vct",
      forcedLossSequence: [pos(3, 3), pos(4, 4)],
      forcedLossBranches: [
        { defenseIndex: 0, defenseMove: pos(5, 5), continuation: [pos(6, 6)] },
      ],
    });
    const tabs = buildTopTabs(eval_, 0);
    expect(tabs.map((t) => t.id)).toEqual(["best", "loss"]);
    const loss = tabs.find((t) => t.id === "loss");
    expect(loss?.label).toBe("被追詰");
    expect(loss?.branches[0]?.pvIdx).toBe(1); // defenseIndex(0)+1
  });
});

describe("buildRows", () => {
  function tabWithBranch(): ProgressionTab {
    return buildTopTabs(
      evaluatedMove({
        moveIndex: 0,
        bestMove: pos(0, 0),
        candidates: [
          candidate({
            position: pos(0, 0),
            principalVariation: [pos(0, 0), pos(1, 1), pos(2, 2)],
          }),
        ],
        forcedWinBranches: [
          {
            defenseIndex: 1,
            defenseMove: pos(8, 8),
            continuation: [pos(9, 9)],
          },
        ],
      }),
      0,
    )[0]!;
  }

  it("分岐点に branch 行を挿入し、既定では basePV を辿る", () => {
    const rows = buildRows(tabWithBranch(), {});
    expect(rows.map((r) => r.type)).toEqual(["move", "branch", "move"]);
    const [, branchRow] = rows;
    expect(
      branchRow?.type === "branch" && branchRow.options.map((o) => o.id),
    ).toEqual(["best", "win-0"]);
  });

  it("分岐を選択すると continuation に切り替わる", () => {
    const rows = buildRows(tabWithBranch(), { 1: "win-0" });
    // move(base0), branch(idx1), then win-0 continuation
    expect(rows.map((r) => r.type)).toEqual(["move", "branch", "move"]);
    const [, , last] = rows;
    expect(last?.type === "move" && last.item.position).toEqual(pos(9, 9));
  });
});

describe("buildVisibleItems", () => {
  it("move 行と branch 行の選択オプションを upToRowIdx まで集める", () => {
    const tab = buildTopTabs(
      evaluatedMove({
        moveIndex: 0,
        bestMove: pos(0, 0),
        candidates: [
          candidate({
            position: pos(0, 0),
            principalVariation: [pos(0, 0), pos(1, 1)],
          }),
        ],
        forcedWinBranches: [
          {
            defenseIndex: 1,
            defenseMove: pos(8, 8),
            continuation: [pos(9, 9)],
          },
        ],
      }),
      0,
    )[0]!;
    const rows = buildRows(tab, { 1: "win-0" });
    // branch 行で win-0 を選んだ可視手列
    const items = buildVisibleItems(rows, rows.length, { 1: "win-0" });
    expect(items.map((i) => i.position)).toEqual([
      pos(0, 0),
      pos(8, 8),
      pos(9, 9),
    ]);
  });

  it("upToRowIdx で打ち切る", () => {
    const tab = buildTopTabs(
      evaluatedMove({
        moveIndex: 0,
        bestMove: pos(0, 0),
        candidates: [
          candidate({
            position: pos(0, 0),
            principalVariation: [pos(0, 0), pos(1, 1), pos(2, 2)],
          }),
        ],
      }),
      0,
    )[0]!;
    const rows = buildRows(tab, {});
    expect(buildVisibleItems(rows, 2, {})).toHaveLength(2);
  });
});
