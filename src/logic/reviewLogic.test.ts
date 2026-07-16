import { describe, expect, it } from "vitest";

import type {
  EvaluatedMove,
  FullEvalResult,
  LightEvalResult,
  VCTCheckResult,
} from "@/types/review";

import {
  OPENING_MOVES,
  adjustCandidatesForForcedLoss,
  allCandidatesLose,
  applyVCTResult,
  buildBacktrackBranches,
  buildBacktrackSequence,
  buildEvaluatedMove,
  buildGameReview,
  classifyMoveQuality,
  findLosingMove,
  getQualityLabel,
  isOpeningMove,
} from "./reviewLogic";

describe("classifyMoveQuality", () => {
  it("スコア差0は最善手", () => {
    expect(classifyMoveQuality(0)).toBe("excellent");
  });

  it("スコア差1は好手（最善手ではない）", () => {
    expect(classifyMoveQuality(1)).toBe("good");
  });

  it("スコア差80は好手", () => {
    expect(classifyMoveQuality(80)).toBe("good");
  });

  it("スコア差81は疑問手", () => {
    expect(classifyMoveQuality(81)).toBe("inaccuracy");
  });

  it("スコア差300は疑問手", () => {
    expect(classifyMoveQuality(300)).toBe("inaccuracy");
  });

  it("スコア差301は悪手", () => {
    expect(classifyMoveQuality(301)).toBe("mistake");
  });

  it("スコア差1000は悪手", () => {
    expect(classifyMoveQuality(1000)).toBe("mistake");
  });

  it("スコア差1001は大悪手", () => {
    expect(classifyMoveQuality(1001)).toBe("blunder");
  });

  it("負のスコア差でも絶対値で判定", () => {
    expect(classifyMoveQuality(-80)).toBe("good");
    expect(classifyMoveQuality(-300)).toBe("inaccuracy");
  });
});

describe("isOpeningMove", () => {
  it("珠型の3手（0,1,2）は開局手", () => {
    expect(isOpeningMove(0)).toBe(true);
    expect(isOpeningMove(1)).toBe(true);
    expect(isOpeningMove(2)).toBe(true);
  });

  it("4手目以降は開局手ではない", () => {
    expect(isOpeningMove(3)).toBe(false);
    expect(isOpeningMove(10)).toBe(false);
  });

  it("OPENING_MOVESは3", () => {
    expect(OPENING_MOVES).toBe(3);
  });
});

describe("buildGameReview", () => {
  function makeMove(
    isPlayerMove: boolean,
    quality: EvaluatedMove["quality"],
  ): EvaluatedMove {
    return {
      moveIndex: 0,
      position: { row: 7, col: 7 },
      isPlayerMove,
      quality,
      playedScore: 0,
      bestScore: 0,
      scoreDiff: 0,
      bestMove: { row: 7, col: 7 },
      candidates: [],
    };
  }

  it("精度はプレイヤーのexcellent+goodの割合", () => {
    const moves = [
      makeMove(true, "excellent"),
      makeMove(true, "good"),
      makeMove(true, "inaccuracy"),
      makeMove(true, "mistake"),
    ];
    const review = buildGameReview(moves);
    expect(review.accuracy).toBe(50);
  });

  it("相手の手は精度計算に含めない", () => {
    const moves = [
      makeMove(true, "excellent"),
      makeMove(false, "blunder"),
      makeMove(true, "good"),
      makeMove(false, "blunder"),
    ];
    const review = buildGameReview(moves);
    expect(review.accuracy).toBe(100);
  });

  it("クリティカルエラーはmistake+blunderの数", () => {
    const moves = [
      makeMove(true, "mistake"),
      makeMove(true, "blunder"),
      makeMove(true, "inaccuracy"),
    ];
    const review = buildGameReview(moves);
    expect(review.criticalErrors).toBe(2);
  });

  it("プレイヤーの手がない場合は精度100", () => {
    const moves = [makeMove(false, "blunder")];
    const review = buildGameReview(moves);
    expect(review.accuracy).toBe(100);
  });
});

describe("buildEvaluatedMove: モード別", () => {
  const moveHistory = "H8 H9 I8 G8";

  it("fullEval: スコア差から品質を算出", () => {
    const result: FullEvalResult = {
      mode: "fullEval",
      moveIndex: 3,
      bestMove: { row: 7, col: 7 },
      bestScore: 500,
      playedScore: 500,
      candidates: [],
      completedDepth: 6,
    };
    const evaluated = buildEvaluatedMove(result, moveHistory, true);
    expect(evaluated.quality).toBe("excellent");
    expect(evaluated.scoreDiff).toBe(0);
    expect(evaluated.completedDepth).toBe(6);
    expect(evaluated.isLightEval).toBeUndefined();
  });

  it("lightEval: isLightEval=true、quality=excellent固定", () => {
    const result: LightEvalResult = {
      mode: "lightEval",
      moveIndex: 3,
      bestMove: { row: 5, col: 5 },
      forcedWinType: "vcf",
    };
    const evaluated = buildEvaluatedMove(result, moveHistory, true);
    expect(evaluated.isLightEval).toBe(true);
    expect(evaluated.quality).toBe("excellent");
    expect(evaluated.forcedWinType).toBe("vcf");
    expect(evaluated.candidates).toEqual([]);
  });

  it("isBookMove=true: スコア差が大きくてもミス判定を抑制する（quality=good）", () => {
    const result: FullEvalResult = {
      mode: "fullEval",
      moveIndex: 3,
      bestMove: { row: 7, col: 7 },
      bestScore: 2000,
      playedScore: 0, // scoreDiff=2000 → 素の分類なら blunder
      candidates: [],
      completedDepth: 6,
      isBookMove: true,
    };
    const evaluated = buildEvaluatedMove(result, moveHistory, true);
    expect(evaluated.quality).toBe("good");
    expect(evaluated.isBookMove).toBe(true);
  });

  it("isBookMove=false: 通常どおりスコア差で分類される", () => {
    const result: FullEvalResult = {
      mode: "fullEval",
      moveIndex: 3,
      bestMove: { row: 7, col: 7 },
      bestScore: 2000,
      playedScore: 0,
      candidates: [],
      completedDepth: 6,
      isBookMove: false,
    };
    const evaluated = buildEvaluatedMove(result, moveHistory, true);
    expect(evaluated.quality).toBe("blunder");
    expect(evaluated.isBookMove).toBe(false);
  });

  it("isBookMove=true でも forcedLossType が検出されていれば抑制しない（通常判定＋blunder）", () => {
    const result: FullEvalResult = {
      mode: "fullEval",
      moveIndex: 3,
      bestMove: { row: 7, col: 7 },
      bestScore: 2000,
      playedScore: 0,
      candidates: [],
      completedDepth: 6,
      isBookMove: true,
      forcedLossType: "vct",
    };
    const evaluated = buildEvaluatedMove(result, moveHistory, true);
    expect(evaluated.quality).toBe("blunder");
    expect(evaluated.isBookMove).toBe(false);
  });

  it("isBookMove 未指定: 従来どおりfalse扱いで分類される", () => {
    const result: FullEvalResult = {
      mode: "fullEval",
      moveIndex: 3,
      bestMove: { row: 7, col: 7 },
      bestScore: 500,
      playedScore: 500,
      candidates: [],
      completedDepth: 6,
    };
    const evaluated = buildEvaluatedMove(result, moveHistory, true);
    expect(evaluated.isBookMove).toBe(false);
  });
});

describe("getQualityLabel", () => {
  it("isBookMove=true のときは quality に関わらず「定石（ブック手）」を返す", () => {
    expect(getQualityLabel("blunder", true)).toBe("定石（ブック手）");
    expect(getQualityLabel("excellent", true)).toBe("定石（ブック手）");
  });

  it("isBookMove が未指定/falseなら通常のラベルを返す", () => {
    expect(getQualityLabel("excellent")).toBe("最善手");
    expect(getQualityLabel("blunder", false)).toBe("悪手");
  });
});

describe("applyVCTResult", () => {
  const base: EvaluatedMove = {
    moveIndex: 3,
    position: { row: 7, col: 7 },
    isPlayerMove: true,
    quality: "good",
    playedScore: 300,
    bestScore: 400,
    scoreDiff: 100,
    bestMove: { row: 6, col: 6 },
    candidates: [],
  };

  it("forcedLossType があれば既存にマージ", () => {
    const vct: VCTCheckResult = {
      mode: "vctCheck",
      moveIndex: 3,
      forcedLossType: "vct",
      forcedLossSequence: [{ row: 5, col: 5 }],
    };
    const merged = applyVCTResult(base, vct);
    expect(merged.forcedLossType).toBe("vct");
    expect(merged.forcedLossSequence).toEqual([{ row: 5, col: 5 }]);
    expect(merged.quality).toBe("good"); // 元の品質は維持
  });

  it("forcedLossType がなければ元のまま返す", () => {
    const vct: VCTCheckResult = {
      mode: "vctCheck",
      moveIndex: 3,
    };
    const merged = applyVCTResult(base, vct);
    expect(merged).toBe(base); // 同一参照
  });
});

describe("findLosingMove", () => {
  function makeMove(
    moveIndex: number,
    isPlayerMove: boolean,
    opts?: {
      forcedLossType?: string;
      candidates?: { opponentForcedWin?: string }[];
    },
  ): EvaluatedMove {
    return {
      moveIndex,
      position: { row: 0, col: 0 },
      isPlayerMove,
      quality: "excellent",
      playedScore: 0,
      bestScore: 0,
      scoreDiff: 0,
      bestMove: { row: 0, col: 0 },
      candidates: (opts?.candidates ?? []).map((c) => ({
        position: { row: 0, col: 0 },
        score: 0,
        searchScore: 0,
        opponentForcedWin: c.opponentForcedWin as
          | EvaluatedMove["forcedLossType"]
          | undefined,
      })),
      forcedLossType: opts?.forcedLossType as EvaluatedMove["forcedLossType"],
    };
  }

  it("forcedLossType がないとき undefined を返す", () => {
    const moves = [makeMove(3, true), makeMove(4, false), makeMove(5, true)];
    expect(findLosingMove(moves)).toBeUndefined();
  });

  it("forcedLossType が付いた手で生存候補がある → その手が敗着", () => {
    const moves = [
      makeMove(3, true),
      makeMove(4, false),
      makeMove(5, true, {
        forcedLossType: "vct",
        candidates: [
          { opponentForcedWin: "vcf" },
          {}, // opponentForcedWin なし = 生存
        ],
      }),
    ];
    expect(findLosingMove(moves)).toEqual({ moveIndex: 5 });
  });

  it("全候補が負け → 前の手に遡及して敗着", () => {
    const moves = [
      makeMove(3, true, {
        candidates: [{ opponentForcedWin: undefined }],
      }),
      makeMove(4, false),
      makeMove(5, true, {
        forcedLossType: "vct",
        candidates: [
          { opponentForcedWin: "vcf" },
          { opponentForcedWin: "vct" },
        ],
      }),
    ];
    // 5手目は全候補負け → 3手目に遡及。3手目は候補に生存あり → 3手目が敗着
    expect(findLosingMove(moves)).toEqual({ moveIndex: 3 });
  });

  it("コンピュータ手の forcedLossType は無視する", () => {
    const moves = [
      makeMove(3, true),
      makeMove(4, false, { forcedLossType: "vcf" }),
      makeMove(5, true),
      makeMove(6, false),
      makeMove(7, true, { forcedLossType: "vct" }),
    ];
    expect(findLosingMove(moves)).toEqual({ moveIndex: 7 });
  });

  it("候補が空なら遡及しない（判定不能 → その手が敗着）", () => {
    const moves = [
      makeMove(3, true),
      makeMove(5, true, { forcedLossType: "vct", candidates: [] }),
    ];
    expect(findLosingMove(moves)).toEqual({ moveIndex: 5 });
  });

  it("空の evaluatedMoves で undefined を返す", () => {
    expect(findLosingMove([])).toBeUndefined();
  });

  it("3段階遡及: 全候補負け → 全候補負け → 生存あり → 敗着", () => {
    const allLose = [
      { opponentForcedWin: "vct" },
      { opponentForcedWin: "vcf" },
    ];
    const moves = [
      makeMove(3, true, { candidates: [{}] }), // 生存あり
      makeMove(4, false),
      makeMove(5, true, {
        forcedLossType: "vct",
        candidates: allLose,
      }),
      makeMove(6, false),
      makeMove(7, true, {
        forcedLossType: "vct",
        candidates: allLose,
      }),
      makeMove(8, false),
      makeMove(9, true, {
        forcedLossType: "vct",
        candidates: allLose,
      }),
    ];
    // 9→7→5: 全候補負け → 3手目に生存あり → 3手目が敗着
    expect(findLosingMove(moves)).toEqual({ moveIndex: 3 });
  });
});

describe("allCandidatesLose", () => {
  function makeEval(
    candidates: { opponentForcedWin?: string }[],
  ): EvaluatedMove {
    return {
      moveIndex: 0,
      position: { row: 0, col: 0 },
      isPlayerMove: true,
      quality: "excellent",
      playedScore: 0,
      bestScore: 0,
      scoreDiff: 0,
      bestMove: { row: 0, col: 0 },
      candidates: candidates.map((c) => ({
        position: { row: 0, col: 0 },
        score: 0,
        searchScore: 0,
        opponentForcedWin: c.opponentForcedWin as
          | EvaluatedMove["forcedLossType"]
          | undefined,
      })),
    };
  }

  it("空候補 → false", () => {
    expect(allCandidatesLose(makeEval([]))).toBe(false);
  });

  it("全候補 opponentForcedWin → true", () => {
    expect(
      allCandidatesLose(
        makeEval([{ opponentForcedWin: "vct" }, { opponentForcedWin: "vcf" }]),
      ),
    ).toBe(true);
  });

  it("一部のみ → false", () => {
    expect(
      allCandidatesLose(makeEval([{ opponentForcedWin: "vct" }, {}])),
    ).toBe(false);
  });
});

describe("adjustCandidatesForForcedLoss", () => {
  it("opponentForcedWin なし → 元のまま", () => {
    const candidates = [
      { position: { row: 1, col: 1 }, score: 0, searchScore: 500 },
    ];
    const result = adjustCandidatesForForcedLoss(candidates, 500, {
      row: 1,
      col: 1,
    });
    expect(result.bestScore).toBe(500);
  });

  it("一部に opponentForcedWin → 安全な候補が bestMove に", () => {
    const candidates = [
      {
        position: { row: 1, col: 1 },
        score: 0,
        searchScore: 500,
        opponentForcedWin: "vct" as const,
      },
      { position: { row: 2, col: 2 }, score: 0, searchScore: 400 },
    ];
    const result = adjustCandidatesForForcedLoss(candidates, 500, {
      row: 1,
      col: 1,
    });
    expect(result.bestMove).toEqual({ row: 2, col: 2 });
    expect(result.bestScore).toBe(400);
  });

  it("全候補 opponentForcedWin → 元の bestScore/bestMove を維持", () => {
    const candidates = [
      {
        position: { row: 1, col: 1 },
        score: 0,
        searchScore: 500,
        opponentForcedWin: "vct" as const,
      },
      {
        position: { row: 2, col: 2 },
        score: 0,
        searchScore: 400,
        opponentForcedWin: "vcf" as const,
      },
    ];
    const result = adjustCandidatesForForcedLoss(candidates, 500, {
      row: 1,
      col: 1,
    });
    expect(result.bestScore).toBe(500);
    expect(result.bestMove).toEqual({ row: 1, col: 1 });
  });
});

describe("buildBacktrackSequence", () => {
  it("中間手 + 元のシーケンスを結合", () => {
    const moves = ["H8", "I9", "F7", "G8", "I7"];
    const seq = buildBacktrackSequence(
      moves,
      1, // prevMoveIndex
      3, // currentMoveIndex
      [{ row: 6, col: 8 }], // currentSequence
    );
    // moves[2]=F7, moves[3]=G8 + currentSequence
    expect(seq).toHaveLength(3);
  });

  it("元のシーケンスが undefined → 中間手のみ", () => {
    const moves = ["H8", "I9", "F7"];
    const seq = buildBacktrackSequence(moves, 0, 2, undefined);
    expect(seq).toHaveLength(2); // moves[1]=I9, moves[2]=F7
  });
});

describe("buildBacktrackBranches", () => {
  it("実戦手と同じ候補はスキップ", () => {
    const moves = ["H8", "I9", "F7", "G8"];
    // G8 = parseMove("G8") = { row: 7, col: 6 }
    const candidates = [
      {
        position: { row: 7, col: 6 }, // G8 = 実戦手
        score: 0,
        searchScore: 0,
        opponentForcedWinSequence: [{ row: 0, col: 0 }],
      },
      {
        position: { row: 5, col: 5 },
        score: 0,
        searchScore: 0,
        opponentForcedWinSequence: [{ row: 1, col: 1 }],
      },
    ];
    const branches = buildBacktrackBranches(moves, 1, 3, candidates);
    expect(branches).toHaveLength(1);
    expect(branches[0]!.defenseMove).toEqual({ row: 5, col: 5 });
  });

  it("opponentForcedWinSequence がない候補はスキップ", () => {
    const moves = ["H8", "I9", "F7", "G8"];
    const candidates = [
      { position: { row: 5, col: 5 }, score: 0, searchScore: 0 },
    ];
    const branches = buildBacktrackBranches(moves, 1, 3, candidates);
    expect(branches).toHaveLength(0);
  });
});
