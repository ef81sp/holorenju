/**
 * 開局（珠型）ロジックのテスト
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import {
  getOpeningEvaluation,
  getOpeningMove,
  getOpeningPatternInfo,
  isOpeningPhase,
  JUSHU_EVALUATION,
  TENGEN,
} from "./opening";
import { placeStonesOnBoard } from "./testUtils";

describe("isOpeningPhase", () => {
  it("手数が0の場合はtrue", () => {
    expect(isOpeningPhase(0)).toBe(true);
  });

  it("手数が1の場合はtrue", () => {
    expect(isOpeningPhase(1)).toBe(true);
  });

  it("手数が2の場合はtrue", () => {
    expect(isOpeningPhase(2)).toBe(true);
  });

  it("手数が3の場合はfalse", () => {
    expect(isOpeningPhase(3)).toBe(false);
  });

  it("手数が4以上の場合はfalse", () => {
    expect(isOpeningPhase(4)).toBe(false);
    expect(isOpeningPhase(10)).toBe(false);
  });
});

describe("getOpeningMove", () => {
  describe("1手目（黒）", () => {
    it("空の盤面で黒は天元を返す", () => {
      const board = createEmptyBoard();
      const move = getOpeningMove(board, "black");

      expect(move).toEqual(TENGEN);
    });

    it("空の盤面で白はnullを返す", () => {
      const board = createEmptyBoard();
      const move = getOpeningMove(board, "white");

      expect(move).toBe(null);
    });
  });

  describe("2手目（白）", () => {
    it("天元に黒がある場合、白は周囲8マスのいずれかを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

      const move = getOpeningMove(board, "white");

      expect(move).not.toBe(null);
      if (move) {
        // 天元からの距離が1であることを確認
        const dr = Math.abs(move.row - TENGEN.row);
        const dc = Math.abs(move.col - TENGEN.col);
        expect(dr).toBeLessThanOrEqual(1);
        expect(dc).toBeLessThanOrEqual(1);
        expect(dr + dc).toBeGreaterThan(0); // 天元自体ではない
      }
    });

    it("天元以外に黒がある場合、白はnullを返す（通常AI処理へ）", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [{ row: 8, col: 8, color: "black" }]);

      const move = getOpeningMove(board, "white");

      expect(move).toBe(null);
    });

    it("黒が2手目に呼ばれた場合はnullを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

      const move = getOpeningMove(board, "black");

      expect(move).toBe(null);
    });
  });

  describe("3手目（黒）", () => {
    it("直打ち（斜め）の場合、有効な珠型パターンを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [
        { row: 7, col: 7, color: "black" }, // 天元
        { row: 8, col: 8, color: "white" }, // 斜め（直打ち）
      ]);

      const move = getOpeningMove(board, "black");

      expect(move).not.toBe(null);
      if (move) {
        // 空きマスであることを確認
        expect(board[move.row]?.[move.col]).toBe(null);
        // 盤面内であることを確認
        expect(move.row).toBeGreaterThanOrEqual(0);
        expect(move.row).toBeLessThan(15);
        expect(move.col).toBeGreaterThanOrEqual(0);
        expect(move.col).toBeLessThan(15);
      }
    });

    it("間打ち（縦横）の場合、有効な珠型パターンを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [
        { row: 7, col: 7, color: "black" }, // 天元
        { row: 8, col: 7, color: "white" }, // 縦方向（間打ち）
      ]);

      const move = getOpeningMove(board, "black");

      expect(move).not.toBe(null);
      if (move) {
        // 空きマスであることを確認
        expect(board[move.row]?.[move.col]).toBe(null);
        // 盤面内であることを確認
        expect(move.row).toBeGreaterThanOrEqual(0);
        expect(move.row).toBeLessThan(15);
        expect(move.col).toBeGreaterThanOrEqual(0);
        expect(move.col).toBeLessThan(15);
      }
    });

    it("白が天元周囲以外に置いた場合はnullを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [
        { row: 7, col: 7, color: "black" }, // 天元
        { row: 10, col: 10, color: "white" }, // 遠い位置
      ]);

      const move = getOpeningMove(board, "black");

      expect(move).toBe(null);
    });

    it("白が3手目に呼ばれた場合はnullを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [
        { row: 7, col: 7, color: "black" },
        { row: 8, col: 8, color: "white" },
      ]);

      const move = getOpeningMove(board, "white");

      expect(move).toBe(null);
    });
  });

  describe("4手目以降", () => {
    it("4手目以降はnullを返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [
        { row: 7, col: 7, color: "black" },
        { row: 8, col: 8, color: "white" },
        { row: 6, col: 6, color: "black" },
      ]);

      const moveBlack = getOpeningMove(board, "black");
      const moveWhite = getOpeningMove(board, "white");

      expect(moveBlack).toBe(null);
      expect(moveWhite).toBe(null);
    });
  });

  describe("ランダム性", () => {
    it("2手目は複数回呼んでも有効な位置を返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);

      // 10回実行して、すべて有効な位置であることを確認
      for (let i = 0; i < 10; i++) {
        const move = getOpeningMove(board, "white");
        expect(move).not.toBe(null);
        if (move) {
          const dr = Math.abs(move.row - TENGEN.row);
          const dc = Math.abs(move.col - TENGEN.col);
          expect(dr).toBeLessThanOrEqual(1);
          expect(dc).toBeLessThanOrEqual(1);
        }
      }
    });

    it("3手目は複数回呼んでも有効な位置を返す", () => {
      const board = createEmptyBoard();
      placeStonesOnBoard(board, [
        { row: 7, col: 7, color: "black" },
        { row: 8, col: 8, color: "white" },
      ]);

      // 10回実行して、すべて有効な位置であることを確認
      for (let i = 0; i < 10; i++) {
        const move = getOpeningMove(board, "black");
        expect(move).not.toBe(null);
        if (move) {
          expect(board[move.row]?.[move.col]).toBe(null);
        }
      }
    });
  });
});

describe("getOpeningPatternInfo", () => {
  it("3手未満の場合はnullを返す", () => {
    const board = createEmptyBoard();
    expect(getOpeningPatternInfo(board)).toBe(null);

    placeStonesOnBoard(board, [{ row: 7, col: 7, color: "black" }]);
    expect(getOpeningPatternInfo(board)).toBe(null);

    placeStonesOnBoard(board, [{ row: 8, col: 8, color: "white" }]);
    expect(getOpeningPatternInfo(board)).toBe(null);
  });

  it("斜月パターンを認識する（間接打ち）", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 8, col: 8, color: "white" }, // 右下斜め（間接打ち）
      { row: 6, col: 6, color: "black" }, // 斜月（白と反対の斜め）
    ]);

    const info = getOpeningPatternInfo(board);
    expect(info).not.toBe(null);
    if (info) {
      expect(info.name).toBe("斜月");
      expect(info.type).toBe("diagonal");
    }
  });

  it("花月パターンを認識する（直接打ち）", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 8, col: 7, color: "white" }, // 下（直接打ち）
      { row: 8, col: 8, color: "black" }, // 花月
    ]);

    const info = getOpeningPatternInfo(board);
    expect(info).not.toBe(null);
    if (info) {
      expect(info.name).toBe("花月");
      expect(info.type).toBe("orthogonal");
    }
  });

  it("寒星パターンを認識する（直接打ち）", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 8, col: 7, color: "white" }, // 下（直接打ち）
      { row: 9, col: 7, color: "black" }, // 寒星
    ]);

    const info = getOpeningPatternInfo(board);
    expect(info).not.toBe(null);
    if (info) {
      expect(info.name).toBe("寒星");
      expect(info.type).toBe("orthogonal");
    }
  });

  it("天元に黒石がない場合はnullを返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 6, col: 6, color: "black" }, // 天元以外
      { row: 8, col: 8, color: "white" },
      { row: 5, col: 5, color: "black" },
    ]);

    expect(getOpeningPatternInfo(board)).toBe(null);
  });
});

describe("珠型の座標変換", () => {
  it("白が左上（6,6）の場合も正しく珠型を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 6, col: 6, color: "white" }, // 左上斜め
    ]);

    const move = getOpeningMove(board, "black");
    expect(move).not.toBe(null);
    if (move) {
      expect(board[move.row]?.[move.col]).toBe(null);
    }
  });

  it("白が上（6,7）の場合も正しく珠型を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 6, col: 7, color: "white" }, // 上
    ]);

    const move = getOpeningMove(board, "black");
    expect(move).not.toBe(null);
    if (move) {
      expect(board[move.row]?.[move.col]).toBe(null);
    }
  });

  it("白が左（7,6）の場合も正しく珠型を返す", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 7, col: 6, color: "white" }, // 左
    ]);

    const move = getOpeningMove(board, "black");
    expect(move).not.toBe(null);
    if (move) {
      expect(board[move.row]?.[move.col]).toBe(null);
    }
  });
});

describe("JUSHU_EVALUATION", () => {
  it("花月は黒必勝として500点", () => {
    expect(JUSHU_EVALUATION["花月"]).toBe(500);
  });

  it("寒星は白有利として-200点", () => {
    expect(JUSHU_EVALUATION["寒星"]).toBe(-200);
  });

  it("瑞星は互角として0点", () => {
    expect(JUSHU_EVALUATION["瑞星"]).toBe(0);
  });

  it("全26種類の珠型が定義されている", () => {
    // 直接打ち（ORTHOGONAL_PATTERNS）13種
    const orthogonalPatterns = [
      "寒星",
      "渓月",
      "疎星",
      "花月",
      "残月",
      "松月",
      "丘月",
      "新月",
      "雨月",
      "金星",
      "瑞星",
      "山月",
      "遊星",
    ];
    // 間接打ち（DIAGONAL_PATTERNS）13種
    const diagonalPatterns = [
      "彗星",
      "名月",
      "明星",
      "嵐月",
      "流星",
      "斜月",
      "銀月",
      "浦月",
      "水月",
      "雲月",
      "恒星",
      "峡月",
      "長星",
    ];
    const allPatterns = [...orthogonalPatterns, ...diagonalPatterns];
    expect(allPatterns.length).toBe(26);
    for (const name of allPatterns) {
      expect(JUSHU_EVALUATION[name]).toBeDefined();
    }
  });
});

describe("getOpeningEvaluation", () => {
  it("花月は黒有利として評価", () => {
    const board = createEmptyBoard();
    // 花月の配置（直接打ち）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 8, col: 7, color: "white" }, // 下（直接打ち）
      { row: 8, col: 8, color: "black" }, // 花月
    ]);

    const blackEval = getOpeningEvaluation(board, "black");
    const whiteEval = getOpeningEvaluation(board, "white");

    expect(blackEval).toBe(500);
    expect(whiteEval).toBe(-500);
  });

  it("寒星は白有利として評価", () => {
    const board = createEmptyBoard();
    // 寒星の配置（直接打ち）
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" }, // 天元
      { row: 8, col: 7, color: "white" }, // 下（直接打ち）
      { row: 9, col: 7, color: "black" }, // 寒星
    ]);

    const blackEval = getOpeningEvaluation(board, "black");
    const whiteEval = getOpeningEvaluation(board, "white");

    expect(blackEval).toBe(-200);
    expect(whiteEval).toBe(200);
  });

  it("3手未満では開局評価なし", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 7, color: "black" },
      { row: 8, col: 8, color: "white" },
    ]);

    expect(getOpeningEvaluation(board, "black")).toBe(0);
  });

  it("11手目以降は開局評価なし", () => {
    const board = createEmptyBoard();
    // 11手置かれた状態をシミュレート
    const positions: [number, number][] = [
      [7, 7],
      [8, 8],
      [6, 7],
      [9, 9],
      [5, 7],
      [10, 10],
      [4, 7],
      [11, 11],
      [3, 7],
      [12, 12],
      [2, 7],
    ];
    positions.forEach(([r, c], i) => {
      placeStonesOnBoard(board, [
        { row: r, col: c, color: i % 2 === 0 ? "black" : "white" },
      ]);
    });

    expect(getOpeningEvaluation(board, "black")).toBe(0);
  });

  it("天元に黒石がない場合は開局評価なし", () => {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 0, col: 0, color: "black" },
      { row: 1, col: 1, color: "white" },
      { row: 2, col: 2, color: "black" },
    ]);

    expect(getOpeningEvaluation(board, "black")).toBe(0);
  });
});

describe("全26珠型の検出", () => {
  // 天元の座標
  const TENGEN_ROW = 7;
  const TENGEN_COL = 7;

  /**
   * 珠型検出のヘルパー関数
   */
  function detectJushu(
    whiteOffset: { dr: number; dc: number },
    blackOffset: { dr: number; dc: number },
  ): { name: string; type: "diagonal" | "orthogonal" } | null {
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: TENGEN_ROW, col: TENGEN_COL, color: "black" },
      {
        row: TENGEN_ROW + whiteOffset.dr,
        col: TENGEN_COL + whiteOffset.dc,
        color: "white",
      },
      {
        row: TENGEN_ROW + blackOffset.dr,
        col: TENGEN_COL + blackOffset.dc,
        color: "black",
      },
    ]);
    return getOpeningPatternInfo(board);
  }

  describe("直接打ち（縦横）13種", () => {
    // 白が下(+1,0)に置いた場合を基準
    const whiteOffset = { dr: 1, dc: 0 };

    it.each([
      [{ dr: -2, dc: 0 }, "瑞星"],
      [{ dr: -2, dc: 1 }, "山月"],
      [{ dr: -2, dc: 2 }, "遊星"],
      [{ dr: -1, dc: 0 }, "松月"],
      [{ dr: -1, dc: 1 }, "丘月"],
      [{ dr: -1, dc: 2 }, "新月"],
      [{ dr: 0, dc: 1 }, "雨月"],
      [{ dr: 0, dc: 2 }, "金星"],
      [{ dr: 1, dc: 1 }, "花月"],
      [{ dr: 1, dc: 2 }, "残月"],
      [{ dr: 2, dc: 0 }, "寒星"],
      [{ dr: 2, dc: 1 }, "渓月"],
      [{ dr: 2, dc: 2 }, "疎星"],
    ])("黒が(%o)に置くと「%s」", (blackOffset, expectedName) => {
      const info = detectJushu(whiteOffset, blackOffset);
      expect(info).not.toBe(null);
      expect(info?.name).toBe(expectedName);
      expect(info?.type).toBe("orthogonal");
    });
  });

  describe("間接打ち（斜め）13種", () => {
    // 白が右下(+1,+1)に置いた場合を基準
    const whiteOffset = { dr: 1, dc: 1 };

    it.each([
      [{ dr: -2, dc: -2 }, "彗星"],
      [{ dr: -2, dc: -1 }, "名月"],
      [{ dr: -2, dc: 0 }, "明星"],
      [{ dr: -2, dc: 1 }, "嵐月"],
      [{ dr: -2, dc: 2 }, "流星"],
      [{ dr: -1, dc: -1 }, "斜月"],
      [{ dr: -1, dc: 0 }, "銀月"],
      [{ dr: -1, dc: 1 }, "浦月"],
      [{ dr: -1, dc: 2 }, "水月"],
      [{ dr: 0, dc: 1 }, "雲月"],
      [{ dr: 0, dc: 2 }, "恒星"],
      [{ dr: 1, dc: 2 }, "峡月"],
      [{ dr: 2, dc: 2 }, "長星"],
    ])("黒が(%o)に置くと「%s」", (blackOffset, expectedName) => {
      const info = detectJushu(whiteOffset, blackOffset);
      expect(info).not.toBe(null);
      expect(info?.name).toBe(expectedName);
      expect(info?.type).toBe("diagonal");
    });
  });

  it("全26珠型がユニークに検出される", () => {
    const detectedNames = new Set<string>();

    // 直接打ち（縦横）: 白が上下左右4方向
    const orthogonalOffsets = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];

    // 間接打ち（斜め）: 白が斜め4方向
    const diagonalOffsets = [
      { dr: -1, dc: -1 },
      { dr: -1, dc: 1 },
      { dr: 1, dc: -1 },
      { dr: 1, dc: 1 },
    ];

    // 黒3手目の候補位置（天元から-2～+2の範囲）
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 && dc === 0) {
          continue;
        }

        for (const whiteOffset of [...orthogonalOffsets, ...diagonalOffsets]) {
          // 白と同じ位置は除外
          if (whiteOffset.dr === dr && whiteOffset.dc === dc) {
            continue;
          }

          const info = detectJushu(whiteOffset, { dr, dc });
          if (info) {
            detectedNames.add(info.name);
          }
        }
      }
    }

    expect(detectedNames.size).toBe(26);
  });
});
