/**
 * 被追詰伝播ロジックのテスト
 */

import { describe, expect, test } from "vitest";

import type {
  FullEvalResult,
  LightEvalResult,
  ReviewCandidate,
} from "@/types/review";

import {
  findPreciseTargets,
  propagateForcedLossBackward,
  propagateForcedLossToCandidates,
} from "./forcedLossPropagation";

/** テスト用のフル評価結果を作成するヘルパー */
function fullEval(
  moveIndex: number,
  overrides: Partial<FullEvalResult> = {},
): FullEvalResult {
  return {
    mode: "fullEval",
    moveIndex,
    bestMove: { row: 7, col: 7 },
    bestScore: 100,
    playedScore: 50,
    candidates: [],
    completedDepth: 6,
    ...overrides,
  };
}

/** テスト用の軽量評価結果を作成するヘルパー */
function lightEval(moveIndex: number): LightEvalResult {
  return {
    mode: "lightEval",
    moveIndex,
    bestMove: { row: 7, col: 7 },
  };
}

describe("findPreciseTargets", () => {
  test("敗着なし → 空配列", () => {
    const results = [fullEval(3), fullEval(5), fullEval(7)];
    expect(findPreciseTargets(results, false)).toEqual([]);
  });

  test("敗着1手 → 敗着+前1手の2手", () => {
    // 後手プレイヤー: 奇数index = プレイヤー手
    const results = [
      fullEval(3), // player
      lightEval(4), // cpu
      fullEval(5), // player
      lightEval(6), // cpu
      fullEval(7, { forcedLossType: "vct" }), // player, 敗着
    ];
    const targets = findPreciseTargets(results, false);
    // 敗着(7) + 前のプレイヤー手(5)
    expect(targets).toEqual([7, 5]);
  });

  test("最初のプレイヤー手が敗着 → 1手のみ", () => {
    const results = [
      fullEval(3, { forcedLossType: "vcf" }), // player, 敗着
      lightEval(4),
      fullEval(5),
    ];
    expect(findPreciseTargets(results, false)).toEqual([3]);
  });

  test("CPU手の forcedLoss は無視", () => {
    // 先手プレイヤー: 偶数index = プレイヤー手, 奇数 = CPU手
    const results = [
      lightEval(3), // cpu (light)
      fullEval(4), // player
      fullEval(5, { forcedLossType: "vct" }), // cpu (fullEval but odd=CPU)
      fullEval(6), // player
    ];
    // 先手プレイヤー → CPU の forcedLoss(index 5) は無視
    expect(findPreciseTargets(results, true)).toEqual([]);
  });

  test("複数の forcedLoss → 最初のプレイヤー手を敗着とする", () => {
    const results = [
      fullEval(3, { forcedLossType: "vct" }), // player, earliest
      fullEval(5, { forcedLossType: "vct" }), // player
      fullEval(7, { forcedLossType: "vcf" }), // player
    ];
    // 最初の敗着(3) + 前1手(なし) = [3]
    expect(findPreciseTargets(results, false)).toEqual([3]);
  });

  test("lightEval は精密化対象にならない", () => {
    const results = [
      lightEval(3), // lightEval with no forcedLossType
      fullEval(5, { forcedLossType: "vct" }),
    ];
    // 敗着(5), 前のプレイヤー fullEval なし
    expect(findPreciseTargets(results, false)).toEqual([5]);
  });
});

describe("propagateForcedLossBackward", () => {
  test("全候補が被追詰 → 前のプレイヤー手に伝播", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7", "G7", "G9"];
    const prevPlayer = fullEval(3); // player
    const lossMove = fullEval(5, {
      forcedLossType: "vct",
      forcedLossSequence: [{ row: 1, col: 1 }],
      candidates: [
        {
          position: { row: 0, col: 0 },
          score: 100,
          searchScore: 100,
          opponentForcedWin: "vct",
        },
        {
          position: { row: 1, col: 0 },
          score: 90,
          searchScore: 90,
          opponentForcedWin: "vcf",
        },
      ],
    });
    const results = [prevPlayer, lightEval(4), lossMove];

    propagateForcedLossBackward(results, false, moves);

    expect(prevPlayer.forcedLossType).toBe("vct");
  });

  test("生存候補あり → 伝播しない", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7", "G7", "G9"];
    const prevPlayer = fullEval(3);
    const lossMove = fullEval(5, {
      forcedLossType: "vct",
      candidates: [
        {
          position: { row: 0, col: 0 },
          score: 100,
          searchScore: 100,
          opponentForcedWin: "vct",
        },
        {
          position: { row: 1, col: 0 },
          score: 90,
          searchScore: 90,
          // opponentForcedWin なし = 生存候補
        },
      ],
    });
    const results = [prevPlayer, lightEval(4), lossMove];

    propagateForcedLossBackward(results, false, moves);

    expect(prevPlayer.forcedLossType).toBeUndefined();
  });

  test("候補なし → 伝播しない", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7"];
    const prevPlayer = fullEval(3);
    const lossMove = fullEval(5, {
      forcedLossType: "vct",
      candidates: [],
    });
    const results = [prevPlayer, lightEval(4), lossMove];

    propagateForcedLossBackward(results, false, moves);

    expect(prevPlayer.forcedLossType).toBeUndefined();
  });

  test("前のプレイヤー手が既に forcedLoss → 上書きしない", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7", "G7", "G9"];
    const prevPlayer = fullEval(3, { forcedLossType: "vcf" });
    const lossMove = fullEval(5, {
      forcedLossType: "vct",
      candidates: [
        {
          position: { row: 0, col: 0 },
          score: 100,
          searchScore: 100,
          opponentForcedWin: "vct",
        },
      ],
    });
    const results = [prevPlayer, lightEval(4), lossMove];

    propagateForcedLossBackward(results, false, moves);

    // 既存の vcf を保持
    expect(prevPlayer.forcedLossType).toBe("vcf");
  });
});

describe("propagateForcedLossToCandidates", () => {
  test("打たれた手の候補に opponentForcedWin を設定", () => {
    // I7 = col=8, row=15-7=8 → (8, 8)
    const moves = ["H8", "I9", "F7", "G8", "I7"];
    const candidate: ReviewCandidate = {
      position: { row: 8, col: 8 }, // I7
      score: 100,
      searchScore: 100,
    };
    const result = fullEval(4, {
      forcedLossType: "vct",
      forcedLossSequence: [{ row: 1, col: 1 }],
      candidates: [candidate],
    });
    const results = [result];

    propagateForcedLossToCandidates(results, moves);

    expect(candidate.opponentForcedWin).toBe("vct");
  });

  test("既に opponentForcedWin がある候補は上書きしない", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7"];
    const candidate = {
      position: { row: 8, col: 8 },
      score: 100,
      searchScore: 100,
      opponentForcedWin: "vcf" as const,
    };
    const result = fullEval(4, {
      forcedLossType: "vct",
      candidates: [candidate],
    });

    propagateForcedLossToCandidates([result], moves);

    expect(candidate.opponentForcedWin).toBe("vcf");
  });

  test("lightEval はスキップ", () => {
    const moves = ["H8", "I9", "F7", "G8"];
    const results: (FullEvalResult | LightEvalResult)[] = [lightEval(3)];

    // エラーにならないことを確認
    expect(() => propagateForcedLossToCandidates(results, moves)).not.toThrow();
  });

  test("forcedLossType がない結果はスキップ", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7"];
    const candidate: ReviewCandidate = {
      position: { row: 8, col: 8 },
      score: 100,
      searchScore: 100,
    };
    const result = fullEval(4, { candidates: [candidate] });

    propagateForcedLossToCandidates([result], moves);

    expect(candidate.opponentForcedWin).toBeUndefined();
  });
});
