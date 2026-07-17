/**
 * 実資産統合テスト（ブラウザ版）。
 *
 * openingBook.realAsset.test.ts の Node（vitest unit プロジェクト）版に加えて、
 * cpu.worker.ts の実行環境そのもの（実ブラウザ・Chromium）で
 * `preloadOpeningBook`（動的 import 経路）が実資産を正しくロード・ヒットする
 * ことを直接確認する（実装レビューで指摘された「Vite/ブラウザでの動作根拠」）。
 */
import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import realAsset from "@/assets/opening-book-hard.json";
import { BOARD_SIZE } from "@/constants";
import { createEmptyBoard } from "@/logic/renjuRules";

import {
  __setOpeningBookAssetForTesting,
  getBookMoveCandidates,
  preloadOpeningBook,
} from "./openingBook";

function boardFromCanonicalKey(key: string): {
  board: BoardState;
  color: "black" | "white";
} {
  const [boardStr, colorStr] = key.split("|");
  if (!boardStr || boardStr.length !== BOARD_SIZE * BOARD_SIZE) {
    throw new Error(`不正な canonicalKey: ${key}`);
  }
  const board = createEmptyBoard();
  for (let i = 0; i < boardStr.length; i++) {
    const ch = boardStr[i];
    if (ch === ".") {
      continue;
    }
    const row = Math.floor(i / BOARD_SIZE);
    const col = i % BOARD_SIZE;
    const boardRow = board[row];
    if (boardRow) {
      boardRow[col] = ch === "B" ? "black" : "white";
    }
  }
  return { board, color: colorStr === "white" ? "white" : "black" };
}

describe("openingBook 実資産統合テスト（実ブラウザ）", () => {
  it("実ブラウザで preloadOpeningBook が実資産をロードし、複数局面が実際にヒットする", async () => {
    __setOpeningBookAssetForTesting(undefined);
    await preloadOpeningBook();

    const allKeys = Object.keys(realAsset.entries);
    expect(allKeys.length).toBeGreaterThan(0);

    const sampleIndices = [
      0,
      Math.floor(allKeys.length / 4),
      Math.floor(allKeys.length / 2),
      Math.floor((allKeys.length * 3) / 4),
      allKeys.length - 1,
    ];
    const sampleKeys = [...new Set(sampleIndices)].map((i) => allKeys[i]!);

    for (const key of sampleKeys) {
      const { board, color } = boardFromCanonicalKey(key);
      const candidates = getBookMoveCandidates(board, color);
      expect(candidates, `key=${key}`).not.toBeNull();
      expect(candidates?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
