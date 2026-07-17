/**
 * ルート集合構築（opening-trap-mining-2026-07-16.md §3）のテスト。
 */
import { describe, expect, it } from "vitest";

import { BOARD_SIZE, TENGEN } from "@/constants";
import { canonicalKey } from "@/logic/boardSymmetry";
import { getAllJushuNames } from "@/logic/cpu/opening";
import { createEmptyBoard } from "@/logic/renjuRules";

import {
  buildAllRoots,
  buildJushuRoots,
  buildOffJushuRoots,
} from "./trapRoutes";

describe("buildJushuRoots", () => {
  it("26珠型すべてのルートを返す", () => {
    const roots = buildJushuRoots();
    expect(roots.length).toBe(getAllJushuNames().length);
    expect(roots.length).toBe(26);
  });

  it("各ルートは黒1=天元固定", () => {
    for (const route of buildJushuRoots()) {
      expect(route.positions[0]).toEqual(TENGEN);
    }
  });

  it("各ルートの3手が盤内かつ互いに異なる", () => {
    for (const route of buildJushuRoots()) {
      const [p1, p2, p3] = route.positions;
      for (const p of [p1, p2, p3]) {
        expect(p.row).toBeGreaterThanOrEqual(0);
        expect(p.row).toBeLessThan(BOARD_SIZE);
        expect(p.col).toBeGreaterThanOrEqual(0);
        expect(p.col).toBeLessThan(BOARD_SIZE);
      }
      const keys = new Set([p1, p2, p3].map((p) => `${p.row},${p.col}`));
      expect(keys.size).toBe(3);
    }
  });
});

describe("buildOffJushuRoots", () => {
  const roots = buildOffJushuRoots();

  it("数個〜十数個のルートを返す（対称正規化後）", () => {
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThan(30);
  });

  it("すべてのルートで黒3は天元からチェビシェフ距離3以上", () => {
    for (const route of roots) {
      const [, , black3] = route.positions;
      const dist = Math.max(
        Math.abs(black3.row - TENGEN.row),
        Math.abs(black3.col - TENGEN.col),
      );
      expect(dist).toBeGreaterThanOrEqual(3);
    }
  });

  it("すべてのルートで黒3は白2の周囲2マス以内", () => {
    for (const route of roots) {
      const [, white2, black3] = route.positions;
      const dr = Math.abs(black3.row - white2.row);
      const dc = Math.abs(black3.col - white2.col);
      expect(Math.max(dr, dc)).toBeLessThanOrEqual(2);
    }
  });

  it("ルート名がすべて一意", () => {
    const names = roots.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("重複する対称形を含まない（各ルートの局面の canonical key が一意）", () => {
    const keys = roots.map((r) => {
      const board = createEmptyBoard();
      const [p1, p2, p3] = r.positions;
      board[p1.row]![p1.col] = "black";
      board[p2.row]![p2.col] = "white";
      board[p3.row]![p3.col] = "black";
      return canonicalKey(board, "white");
    });
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("buildAllRoots", () => {
  it("珠型ルートと珠型外ルートを結合して返す", () => {
    const all = buildAllRoots();
    expect(all.length).toBe(
      buildJushuRoots().length + buildOffJushuRoots().length,
    );
  });
});
