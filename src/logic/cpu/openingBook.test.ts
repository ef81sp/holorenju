/**
 * オープニングブック（opening-book-2026-07-16.md §2）のテスト。
 *
 * - 着手API（getBookMove）: cpu.worker.ts 専用。ヒット時に canonical 空間から
 *   実盤座標へ逆変換した手を返す。randomPool があれば注入 rng で選択。
 * - 注釈専用API（isBookMove）: review.worker.ts 専用。着手選択には使わない。
 *   打たれた手がブック一致かどうかだけを判定する。
 */
import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import {
  canonicalKeyWithTransform,
  transformPosition,
} from "@/logic/boardSymmetry";
import { formatMove, parseMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import {
  __setOpeningBookAssetForTesting,
  getBookMove,
  getBookMoveCandidates,
  isBookMove,
  preloadOpeningBook,
} from "./openingBook";

function boardFromMoves(moves: string[]): BoardState {
  const board = createEmptyBoard();
  moves.forEach((m, i) => {
    const pos = parseMove(m);
    const row = board[pos.row];
    if (row) {
      row[pos.col] = i % 2 === 0 ? "black" : "white";
    }
  });
  return board;
}

describe("openingBook (着手API: getBookMove)", () => {
  it("未ロード時は null を返す（探索へフォールバック）", () => {
    __setOpeningBookAssetForTesting(null);
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    expect(getBookMove(board, "white")).toBeNull();
  });

  it("ロード済み・ヒット時は canonical 空間の手を実盤座標に逆変換して返す", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key, transformName } = canonicalKeyWithTransform(board, "white");
    const canonicalMove = "K12"; // 適当な空きマス（canonical空間）
    __setOpeningBookAssetForTesting({
      entries: { [key]: { move: canonicalMove } },
    });

    const result = getBookMove(board, "white");
    expect(result).not.toBeNull();
    // 逆変換した結果を、同じ変換で canonical 空間に戻すと元の canonicalMove に一致する
    expect(formatMove(transformPosition(result!, transformName))).toBe(
      canonicalMove,
    );
  });

  it("ミス時（ヒットしない）は null を返す", () => {
    __setOpeningBookAssetForTesting({ entries: {} });
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    expect(getBookMove(board, "white")).toBeNull();
  });

  it("randomPool がある場合は注入した rng で選択する", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key, transformName } = canonicalKeyWithTransform(board, "white");
    __setOpeningBookAssetForTesting({
      entries: {
        [key]: { move: "K12", randomPool: ["K12", "L13", "M14"] },
      },
    });

    // rng() = 0 → 先頭（K12）
    const first = getBookMove(board, "white", () => 0);
    expect(formatMove(transformPosition(first!, transformName))).toBe("K12");

    // rng() が 1 未満で末尾寄り → 最後（M14）
    const last = getBookMove(board, "white", () => 0.999);
    expect(formatMove(transformPosition(last!, transformName))).toBe("M14");
  });
});

describe("getBookMoveCandidates", () => {
  it("未ロード時は null", () => {
    __setOpeningBookAssetForTesting(null);
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    expect(getBookMoveCandidates(board, "white")).toBeNull();
  });

  it("ヒットなし時は null", () => {
    __setOpeningBookAssetForTesting({ entries: {} });
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    expect(getBookMoveCandidates(board, "white")).toBeNull();
  });

  it("randomPool がない場合は既定手1件を返す", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key, transformName } = canonicalKeyWithTransform(board, "white");
    __setOpeningBookAssetForTesting({ entries: { [key]: { move: "K12" } } });
    const candidates = getBookMoveCandidates(board, "white");
    expect(candidates).toHaveLength(1);
    expect(formatMove(transformPosition(candidates![0]!, transformName))).toBe(
      "K12",
    );
  });

  it("randomPool がある場合は全件を実盤座標で返す", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key, transformName } = canonicalKeyWithTransform(board, "white");
    __setOpeningBookAssetForTesting({
      entries: { [key]: { move: "K12", randomPool: ["K12", "L13", "M14"] } },
    });
    const candidates = getBookMoveCandidates(board, "white");
    expect(candidates).toHaveLength(3);
    const canonicalStrs = candidates!.map((p) =>
      formatMove(transformPosition(p, transformName)),
    );
    expect(new Set(canonicalStrs)).toEqual(new Set(["K12", "L13", "M14"]));
  });
});

describe("openingBook (注釈専用API: isBookMove)", () => {
  it("未ロード時は false を返す", () => {
    __setOpeningBookAssetForTesting(null);
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    expect(isBookMove(board, "white", parseMove("G11"))).toBe(false);
  });

  it("打たれた手がブックの既定手と一致すれば true", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key } = canonicalKeyWithTransform(board, "white");
    __setOpeningBookAssetForTesting({
      entries: { [key]: { move: "K12" } },
    });
    // getBookMove（別途テスト済み）が返す実盤座標は、ブックの既定手を
    // 正しく逆変換した結果のはず。それを isBookMove に渡せば true になる。
    const bookMove = getBookMove(board, "white")!;
    expect(isBookMove(board, "white", bookMove)).toBe(true);
  });

  it("打たれた手がブックのrandomPoolのいずれかと一致すれば true", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key } = canonicalKeyWithTransform(board, "white");
    __setOpeningBookAssetForTesting({
      entries: {
        [key]: { move: "K12", randomPool: ["K12", "L13"] },
      },
    });
    const poolMove2 = getBookMove(board, "white", () => 0.999)!; // L13 相当
    expect(isBookMove(board, "white", poolMove2)).toBe(true);
  });

  it("打たれた手がブック手と一致しなければ false", () => {
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    const { key } = canonicalKeyWithTransform(board, "white");
    __setOpeningBookAssetForTesting({
      entries: { [key]: { move: "K12" } },
    });
    // 明らかに異なる位置（盤面上の空きマス）
    expect(isBookMove(board, "white", { row: 0, col: 0 })).toBe(false);
  });

  it("局面がブックに存在しなければ false", () => {
    __setOpeningBookAssetForTesting({ entries: {} });
    const board = boardFromMoves(["H8", "I9", "I8", "J8", "H9", "H10"]);
    expect(isBookMove(board, "white", parseMove("G11"))).toBe(false);
  });
});

describe("preloadOpeningBook", () => {
  it("資産が存在しない場合でも例外を投げず null 扱いになる", async () => {
    __setOpeningBookAssetForTesting(undefined);
    // 実際の @/assets/opening-book-hard.json をロードしようとする。
    // フィクスチャ資産が存在する開発環境ではロードに成功する可能性があるため、
    // ここでは「例外を投げないこと」だけを確認する（存在有無は問わない）。
    await expect(preloadOpeningBook()).resolves.not.toThrow();
  });
});
