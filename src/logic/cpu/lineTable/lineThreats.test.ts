/**
 * lineThreats テスト
 *
 * hasFourThreePotentialBit が board版 hasFourThreePotential と等価であることを検証。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";

import { DIRECTIONS } from "../core/constants";
import { countInDirection } from "../evaluation/directionAnalysis";
import { createsFourThree } from "../evaluation/winningPatterns";
import { isNearExistingStone } from "../moveGenerator";
import { buildLineTable } from "./lineTable";
import { hasFourThreePotentialBit } from "./lineThreats";

/** 空盤を生成 */
function emptyBoard(): BoardState {
  return Array.from({ length: BOARD_SIZE }, (): (null | "black" | "white")[] =>
    Array.from({ length: BOARD_SIZE }, (): null => null),
  );
}

/** 盤面のセルに安全に値をセット */
function setCell(
  board: BoardState,
  r: number,
  c: number,
  value: "black" | "white" | null,
): void {
  const row = board[r];
  if (row) {
    row[c] = value;
  }
}

/**
 * board版 hasFourThreePotential（boardEvaluation.ts の private 関数を再実装）
 *
 * テスト用に等価ロジックを公開。
 */
function hasFourThreePotentialBoard(
  board: BoardState,
  row: number,
  col: number,
  color: "black" | "white",
): boolean {
  let hasFour = false;
  let hasOpenThree = false;

  for (const dir of DIRECTIONS) {
    const [dr, dc] = dir;

    const pos = countInDirection(board, row, col, dr, dc, color);
    const neg = countInDirection(board, row, col, -dr, -dc, color);
    const total = pos.count + neg.count;

    if (total >= 3 && (pos.endState === "empty" || neg.endState === "empty")) {
      hasFour = true;
    } else if (
      total >= 2 &&
      pos.endState === "empty" &&
      neg.endState === "empty"
    ) {
      hasOpenThree = true;
    }

    if (hasFour && hasOpenThree) {
      return true;
    }
  }
  return false;
}

/** シード付き擬似乱数生成器 */
function createRng(seed: number): () => number {
  let s = seed;
  return (): number => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff; // eslint-disable-line no-bitwise
    return s / 0x7fffffff;
  };
}

/** ランダム盤面を生成 */
function randomBoard(rng: () => number, stoneCount: number): BoardState {
  const board = emptyBoard();
  const positions: { r: number; c: number }[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      positions.push({ r, c });
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = positions[i];
    positions[i] = positions[j] ?? { r: 0, c: 0 };
    positions[j] = tmp ?? { r: 0, c: 0 };
  }
  for (let i = 0; i < stoneCount && i < positions.length; i++) {
    const pos = positions[i];
    if (!pos) {
      continue;
    }
    const { r, c } = pos;
    setCell(board, r, c, i % 2 === 0 ? "black" : "white");
  }
  return board;
}

/**
 * 盤面上の全空きセルについて、bit版とboard版の出力を比較
 */
function verifyBoardMatch(board: BoardState): void {
  const lt = buildLineTable(board);

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }

      for (const color of ["black", "white"] as const) {
        const expected = hasFourThreePotentialBoard(board, r, c, color);
        const actual = hasFourThreePotentialBit(
          lt.blacks,
          lt.whites,
          r,
          c,
          color,
        );

        expect(
          actual,
          `(${r},${c}) color=${color}: bit=${actual} board=${expected}`,
        ).toBe(expected);
      }
    }
  }
}

describe("hasFourThreePotentialBit vs hasFourThreePotentialBoard", () => {
  it("既知の四三位置: 黒が四三を作れるセル", () => {
    // ___BBB_ の (7,4) に置くと横に四、他方向に活三が必要
    // 横: BBB + 仮置き = 4連（四の候補）
    // 縦に活三を作るため追加
    const board = emptyBoard();
    // 横に3連: (7,5)(7,6)(7,7)
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black");
    // 縦に2連: (5,4)(6,4) → (7,4) に置くと縦に3連両端open
    setCell(board, 5, 4, "black");
    setCell(board, 6, 4, "black");

    const lt = buildLineTable(board);

    // (7,4) は四（横）+ 活三（縦）のポテンシャル
    expect(hasFourThreePotentialBit(lt.blacks, lt.whites, 7, 4, "black")).toBe(
      true,
    );
    expect(hasFourThreePotentialBoard(board, 7, 4, "black")).toBe(true);
  });

  it("四のみ: 活三がない場合は false", () => {
    const board = emptyBoard();
    // 横に3連のみ
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black");

    const lt = buildLineTable(board);

    // (7,4) は四（横）のみ、活三なし
    expect(hasFourThreePotentialBit(lt.blacks, lt.whites, 7, 4, "black")).toBe(
      false,
    );
    expect(hasFourThreePotentialBoard(board, 7, 4, "black")).toBe(false);
  });

  it("活三のみ: 四がない場合は false", () => {
    const board = emptyBoard();
    // 横に2連: (7,5)(7,6)
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    // 縦に2連: (5,4)(6,4)
    setCell(board, 5, 4, "black");
    setCell(board, 6, 4, "black");

    const lt = buildLineTable(board);

    // (7,4) は活三が2方向あるかもしれないが四はない
    expect(hasFourThreePotentialBit(lt.blacks, lt.whites, 7, 4, "black")).toBe(
      false,
    );
    expect(hasFourThreePotentialBoard(board, 7, 4, "black")).toBe(false);
  });

  it("盤端のセル: sentinel 0xffff 処理が正常", () => {
    const board = emptyBoard();
    // (0,0) 付近: 斜め↗ラインがない
    setCell(board, 0, 1, "black");
    setCell(board, 0, 2, "black");
    setCell(board, 0, 3, "black");
    setCell(board, 1, 0, "black");
    setCell(board, 2, 0, "black");

    verifyBoardMatch(board);
  });

  it("短斜めライン上のセル", () => {
    const board = emptyBoard();
    // (0,4) 付近: ↗の短い斜めライン
    setCell(board, 0, 5, "black");
    setCell(board, 0, 6, "black");
    setCell(board, 0, 7, "black");
    setCell(board, 1, 3, "black");
    setCell(board, 2, 3, "black");

    verifyBoardMatch(board);
  });

  it("白色でも正しく判定", () => {
    const board = emptyBoard();
    setCell(board, 7, 5, "white");
    setCell(board, 7, 6, "white");
    setCell(board, 7, 7, "white");
    setCell(board, 5, 4, "white");
    setCell(board, 6, 4, "white");

    const lt = buildLineTable(board);

    expect(hasFourThreePotentialBit(lt.blacks, lt.whites, 7, 4, "white")).toBe(
      true,
    );
    expect(hasFourThreePotentialBoard(board, 7, 4, "white")).toBe(true);
  });

  it("相手石がある方向は端がopponent", () => {
    const board = emptyBoard();
    // 横3連だが片端に相手石
    setCell(board, 7, 4, "white"); // 相手石
    setCell(board, 7, 5, "black");
    setCell(board, 7, 6, "black");
    setCell(board, 7, 7, "black");
    // (7,8) に置くと四になるが、end2がopponent
    // 縦に活三
    setCell(board, 6, 8, "black");
    setCell(board, 5, 8, "black");

    verifyBoardMatch(board);
  });

  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で完全一致`, () => {
      const rng = createRng(stoneCount * 54321);
      for (let i = 0; i < RANDOM_BOARD_COUNT; i++) {
        const board = randomBoard(rng, stoneCount);
        verifyBoardMatch(board);
      }
    });
  }
});

/**
 * scanFourThreeThreat の旧ロジック（isNearExistingStone あり）
 *
 * boardEvaluation.ts の private 関数を再実装。isNearExistingStone を含む旧パス。
 */
function scanFourThreeThreatOld(
  board: BoardState,
  color: "black" | "white",
  stoneCount: number,
): boolean {
  if (stoneCount < 5) {
    return false;
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r]?.[c] !== null) {
        continue;
      }
      if (!isNearExistingStone(board, r, c, 1)) {
        continue;
      }
      if (!hasFourThreePotentialBoard(board, r, c, color)) {
        continue;
      }
      if (createsFourThree(board, r, c, color)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * scanFourThreeThreat の新ロジック（isNearExistingStone 排除、ビットマスクパス）
 *
 * lineTable パスのみ。rowOccupied で占有判定し、hasFourThreePotentialBit で直接フィルタ。
 */
function scanFourThreeThreatNew(
  board: BoardState,
  color: "black" | "white",
  stoneCount: number,
): boolean {
  if (stoneCount < 5) {
    return false;
  }
  const lt = buildLineTable(board);
  for (let r = 0; r < BOARD_SIZE; r++) {
    const rowOccupied = (lt.blacks[r] ?? 0) | (lt.whites[r] ?? 0); // eslint-disable-line no-bitwise
    for (let c = 0; c < BOARD_SIZE; c++) {
      // eslint-disable-next-line no-bitwise
      if (rowOccupied & (1 << c)) {
        continue;
      }
      if (!hasFourThreePotentialBit(lt.blacks, lt.whites, r, c, color)) {
        continue;
      }
      if (createsFourThree(board, r, c, color)) {
        return true;
      }
    }
  }
  return false;
}

describe("scanFourThreeThreat: isNearExistingStone 排除後の等価性", () => {
  /** 盤面の石数をカウント */
  function countStones(board: BoardState, color: "black" | "white"): number {
    let count = 0;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r]?.[c] === color) {
          count++;
        }
      }
    }
    return count;
  }

  const RANDOM_BOARD_COUNT = 200;
  const STONE_COUNTS = [6, 10, 16, 24];

  for (const stoneCount of STONE_COUNTS) {
    it(`ランダム盤面 ${RANDOM_BOARD_COUNT}局 (${stoneCount}石) で旧版と新版が一致`, () => {
      const rng = createRng(stoneCount * 12345);
      for (let i = 0; i < RANDOM_BOARD_COUNT; i++) {
        const board = randomBoard(rng, stoneCount);
        for (const color of ["black", "white"] as const) {
          const sc = countStones(board, color);
          const oldResult = scanFourThreeThreatOld(board, color, sc);
          const newResult = scanFourThreeThreatNew(board, color, sc);
          expect(
            newResult,
            `board#${i} color=${color}: old=${oldResult} new=${newResult}`,
          ).toBe(oldResult);
        }
      }
    });
  }
});
