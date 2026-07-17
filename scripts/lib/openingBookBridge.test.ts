/**
 * cpu-bridge-worker.ts のオープニングブック配線（opening-book-2026-07-16.md
 * ★v2プラン B3仕様）のテスト。match.test.ts と同じ方針で worker を起動せず、
 * cpu-bridge-worker.ts が実際に import して使う同一コード（loadOpeningBookFromWorktree/
 * countStones）を直接検証することで配線の正しさを担保する。
 *
 * B3仕様①②の検証:
 * ①book 照会コード+資産は worktreePath から動的 import される
 *   → 実際のリポジトリルートを worktreePath として渡し、実資産で
 *     isBookEligible/getBookMove が機能することを確認する。
 * ②モジュール/資産の不在（旧コミット相当）は book-OFF として扱い、クラッシュしない
 *   → 存在しないパスを渡しても例外を投げず null を返すことを確認する。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { BOARD_SIZE } from "@/constants";
import { createEmptyBoard } from "@/logic/renjuRules";

import { countStones, loadOpeningBookFromWorktree } from "./openingBookBridge";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** このファイルは scripts/lib/ にあるため、2階層上がリポジトリルート。 */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** canonicalKey（225セル文字列 + "|手番"）を直接盤面へパースする（realAsset テストと同じ手法）。 */
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

describe("countStones", () => {
  it("空盤は0", () => {
    expect(countStones(createEmptyBoard())).toBe(0);
  });

  it("石の数を正しく数える", () => {
    const board = createEmptyBoard();
    board[0]![0] = "black";
    board[1]![1] = "white";
    board[2]![2] = "black";
    expect(countStones(board)).toBe(3);
  });
});

describe("loadOpeningBookFromWorktree", () => {
  it("B3仕様②: 資産が存在しないworktreePathを渡すと例外を投げずnullを返す（book-OFF、旧commit相当）", async () => {
    const bridge = await loadOpeningBookFromWorktree(
      path.join(REPO_ROOT, "__nonexistent-worktree-for-test__"),
    );
    expect(bridge).toBeNull();
  });

  it("B3仕様①: 実リポジトリルートをworktreePathとして渡すと、実際のブック照会コード+資産をロードできる", async () => {
    const bridge = await loadOpeningBookFromWorktree(REPO_ROOT);
    expect(bridge).not.toBeNull();

    // isBookEligible: cpu.worker.ts と同じ判定基準（bookGate.ts をそのまま使っている）。
    expect(bridge!.isBookEligible("hard", "white", 3)).toBe(true);
    expect(bridge!.isBookEligible("hard", "white", 10)).toBe(false);
    expect(bridge!.isBookEligible("easy", "white", 3)).toBe(false);
  });

  it("B3仕様①: ロードしたbridge経由で実資産の局面が実際にヒットする（getBookMove）", async () => {
    const bridge = await loadOpeningBookFromWorktree(REPO_ROOT);
    expect(bridge).not.toBeNull();

    // 実資産（src/assets/opening-book-hard.json）を直接読み、決定的にサンプルした
    // canonicalKey で getBookMove がヒットすることを確認する（realAsset テストと
    // 同じ検証パターンだが、cpu-bridge-worker.ts が実際に使う worktree 経由の
    // ロード関数を通す点が異なる）。
    const assetPath = path.join(
      REPO_ROOT,
      "src",
      "assets",
      "opening-book-hard.json",
    );
    const asset = JSON.parse(readFileSync(assetPath, "utf-8")) as {
      entries: Record<string, unknown>;
    };
    const allKeys = Object.keys(asset.entries);
    expect(allKeys.length).toBeGreaterThan(0);
    const sampleKey = allKeys[Math.floor(allKeys.length / 2)]!;

    const { board, color } = boardFromCanonicalKey(sampleKey);
    const move = bridge!.getBookMove(board, color);
    expect(move).not.toBeNull();
  });
});
