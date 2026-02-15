import { describe, expect, it } from "vitest";

import { parseInitialBoard } from "./boardParser";
import {
  findDummyDefensePosition,
  getDefenseResponse,
  hasRemainingAttacks,
  validateAttackMove,
} from "./vcfPuzzle";

// 盤面ヘルパー: 15x15の空盤面
const EMPTY = "-".repeat(15);

/**
 * 部分指定で盤面を作成するヘルパー
 * entries: [rowIndex, rowString] のペア配列
 */
function makeBoard(entries: [number, string][]) {
  const lines = Array(15).fill(EMPTY) as string[];
  for (const [row, str] of entries) {
    lines[row] = str;
  }
  return parseInitialBoard(lines);
}

describe("validateAttackMove", () => {
  it("空セルに四を作る手は有効", () => {
    // 横に黒3つ並んでいる: row7, col5-7 → col8に打てば四
    const board = makeBoard([[7, "-----xxx-------"]]);
    const result = validateAttackMove(board, { row: 7, col: 8 }, "black");
    expect(result).toEqual({ valid: true, type: "four" });
  });

  it("五連を完成させる手は有効（type: five）", () => {
    // 横に黒4つ並んでいる: row7, col4-7 → col8に打てば五連
    const board = makeBoard([[7, "----xxxx-------"]]);
    const result = validateAttackMove(board, { row: 7, col: 8 }, "black");
    expect(result).toEqual({ valid: true, type: "five" });
  });

  it("占有セルへの手は無効", () => {
    const board = makeBoard([[7, "-------x-------"]]);
    const result = validateAttackMove(board, { row: 7, col: 7 }, "black");
    expect(result).toEqual({ valid: false, reason: "occupied" });
  });

  it("四にならない手は無効", () => {
    // 黒が2つだけ: 四にならない
    const board = makeBoard([[7, "------xx-------"]]);
    const result = validateAttackMove(board, { row: 7, col: 5 }, "black");
    expect(result).toEqual({ valid: false, reason: "not-four" });
  });

  it("黒の禁手は無効", () => {
    // 三三の禁手を作る配置
    // row5: col7に黒2つ (横三)
    // col7: row5-6に黒2つ (縦三)
    // row7,col7に打つと三三
    const board = makeBoard([
      [5, "------x--------"],
      [6, "------x--------"],
      [7, "----xx---------"],
    ]);
    const result = validateAttackMove(board, { row: 7, col: 6 }, "black");
    expect(result).toEqual({ valid: false, reason: "forbidden" });
  });

  it("白の手は禁手チェックなし", () => {
    // 白は禁手がないので、四を作れば有効
    const board = makeBoard([[7, "-----ooo-------"]]);
    const result = validateAttackMove(board, { row: 7, col: 8 }, "white");
    expect(result).toEqual({ valid: true, type: "four" });
  });
});

describe("getDefenseResponse", () => {
  it("止め四に対して防御位置を返す", () => {
    // 横に黒4つ: row7, col4-7、左端(col3)は壁外ではなく相手石とする
    // col4-7に黒、col3に白 → col8が唯一の防御位置
    const board = makeBoard([[7, "---oxxxx-------"]]);
    const result = getDefenseResponse(board, { row: 7, col: 7 }, "black");
    expect(result.type).toBe("blocked");
    if (result.type === "blocked") {
      expect(result.position).toEqual({ row: 7, col: 8 });
    }
  });

  it("活四に対してopen-fourを返す", () => {
    // 横に黒4つ: row7, col4-7、両端が空
    const board = makeBoard([[7, "----xxxx-------"]]);
    const result = getDefenseResponse(board, { row: 7, col: 7 }, "black");
    expect(result.type).toBe("open-four");
    if (result.type === "open-four") {
      expect(result.winPositions).toHaveLength(2);
    }
  });

  it("防御後にCPU五連が成立する場合counter-fiveを返す", () => {
    // 黒が四を作ったが、白の防御位置に白石を置くと白が五連になる
    // row7: 黒4つ (col4-7)、col3に白で止め四
    // row8: 白4つ (col4-7) → col8に白が防御すると白五連
    const board = makeBoard([
      [7, "---oxxxx-------"],
      [8, "----oooo-------"],
    ]);
    const result = getDefenseResponse(board, { row: 7, col: 7 }, "black");
    expect(result.type).toBe("counter-five");
    if (result.type === "counter-five") {
      expect(result.defensePos).toEqual({ row: 7, col: 8 });
    }
  });

  it("禁手陥穽: 防御側が黒で禁手位置に防御が必要な場合", () => {
    // 白先VCFで、黒が防御すべき位置が三三禁手の場合
    // row5: 白4つ(col2-5)、col1に黒(左端ブロック) → 防御位置はcol6のみ
    // col6に黒を打つと:
    //   縦三: (3,6),(4,6),(5,6) → 両端(2,6),(6,6)空 → 活四可能 = 真三
    //   斜め三(右下): (5,6),(6,7),(7,8) → 両端(4,5),(8,9)空 → 活四可能 = 真三
    // → 三三禁手!
    const board = makeBoard([
      [3, "------x--------"], // (3,6) = 黒
      [4, "------x--------"], // (4,6) = 黒
      [5, "oxoooo---------"], // (5,0)=白,(5,1)=黒,(5,2-5)=白 → 白の止め四
      [6, "-------x-------"], // (6,7) = 黒
      [7, "--------x------"], // (7,8) = 黒
    ]);

    const result = getDefenseResponse(board, { row: 5, col: 5 }, "white");
    expect(result.type).toBe("forbidden-trap");
  });
});

describe("hasRemainingAttacks", () => {
  it("四を作れる手が残っている場合はtrue", () => {
    // 黒3つ並び → 四を作れる
    const board = makeBoard([[7, "-----xxx-------"]]);
    expect(hasRemainingAttacks(board, "black")).toBe(true);
  });

  it("五連を作れる手のみ残っている場合もtrue", () => {
    // 黒4つ並び、左端が白で塞がれているが右端は空 → col8で五連可能
    const board = makeBoard([[7, "---oxxxx-------"]]);
    expect(hasRemainingAttacks(board, "black")).toBe(true);
  });

  it("四も五も作れない場合はfalse", () => {
    // 黒石が散在して四を作れない
    const board = makeBoard([[7, "x-o-x-o-x-o-x-o"]]);
    expect(hasRemainingAttacks(board, "black")).toBe(false);
  });
});

describe("findDummyDefensePosition", () => {
  it("勝ち手2箇所を除外した空きセルを返す", () => {
    const board = makeBoard([[7, "----xxxx-------"]]);
    const winPositions = [
      { row: 7, col: 3 },
      { row: 7, col: 8 },
    ];
    const pos = findDummyDefensePosition(board, winPositions);
    expect(pos).not.toBeNull();
    if (pos) {
      // 勝ち手位置ではない
      expect(winPositions).not.toContainEqual(pos);
      // 空セル
      expect(board[pos.row]?.[pos.col]).toBeNull();
    }
  });
});
