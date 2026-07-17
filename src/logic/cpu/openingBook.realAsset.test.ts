/**
 * 実資産統合テスト（実装レビューで発覚した穴の恒久回帰テスト）。
 *
 * ゲート1（scripts/verify-book-blocks-traps.ts）は Node CLI 向けの
 * `setOpeningBookAsset`（fs直読み）で資産をセットするため、実際の
 * ランタイム API（`preloadOpeningBook` の動的 import 経路）が本当に機能するかは
 * 別途の検証が必要だった。素の Node スクリプトから `import("*.json")` を叩くと
 * import attribute（`with { type: "json" }`）要求でロードに失敗し、
 * `preloadOpeningBook` がサイレントに null へフォールバックしていた
 * （openingBook.ts 側でエラーログを出すよう修正済み）。
 *
 * cpu.worker.ts の実行環境（Vite バンドル・ブラウザ）は Vite が `.json` を
 * 独自に変換するため、この Node 固有の制約を受けない。このテストはその根拠を
 * 固定する: vitest の unit プロジェクトも Vite の変換パイプラインを経由するため、
 * 実際の `preloadOpeningBook`（動的 import）が実資産で正しくロード・ヒットする
 * ことを直接確認できる（= Node CLI で起きた問題は Vite 経路には存在しない）。
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

/** canonicalKey（225セル文字列 + "|手番"）を直接盤面へパースする。 */
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

describe("openingBook 実資産統合テスト", () => {
  it("実資産（src/assets/opening-book-hard.json）がプレースホルダのまま空になっていない", () => {
    // これが0件のままなら、権威ダンプからの実ビルドがまだ資産へ反映されて
    // いない（B2のplaceholder-emptyのまま）ことにこのテストで気づける。
    expect(Object.keys(realAsset.entries).length).toBeGreaterThan(0);
  });

  it("preloadOpeningBook（実際の動的import経路）で実資産をロードし、複数局面が実際にヒットする", async () => {
    // モジュールキャッシュをリセットし、preloadOpeningBook 内部の
    // 動的 import 経路を実際に通す（他のテストでキャッシュ済みだと
    // この検証の意味が無くなるため）。
    __setOpeningBookAssetForTesting(undefined);
    await preloadOpeningBook();

    const allKeys = Object.keys(realAsset.entries);
    expect(allKeys.length).toBeGreaterThan(0);

    // 決定的に「先頭・1/4・中間・3/4・末尾」からサンプルを取る
    // （実行のたびに変わらない。ランダムサンプリングは使わない）。
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
