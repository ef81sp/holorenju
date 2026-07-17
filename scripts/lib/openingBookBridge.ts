/**
 * cpu-bridge-worker.ts のオープニングブック読み込みロジック（opening-book-2026-07-16.md
 * ★v2プラン B3仕様）を、worker を起動せずに単体テストできるよう分離したモジュール
 * （scripts/lib/match.ts の buildBridgeCustomParams と同じ方針。テスト時は worker を
 * 起動しないが、cpu-bridge-worker.ts が実際に import して使う「同一コード」を
 * 直接検証することで配線の正しさを担保する）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type { BoardState, Position } from "@/types/game";

/** 盤面上の石数を数える（src/logic/cpu/core/boardUtils.ts の countStones と同じロジック）。 */
export function countStones(board: BoardState): number {
  let count = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== null) {
        count++;
      }
    }
  }
  return count;
}

interface OpeningBookAssetLike {
  entries: Record<string, unknown>;
}

interface OpeningBookModuleExports {
  getBookMove?: (
    board: BoardState,
    color: "black" | "white",
  ) => Position | null;
  setOpeningBookAsset?: (asset: OpeningBookAssetLike | null) => void;
}

interface BookGateModuleExports {
  isBookEligible?: (
    difficulty: string,
    turn: "black" | "white",
    moveCount: number,
  ) => boolean;
}

export interface OpeningBookBridge {
  getBookMove: (board: BoardState, color: "black" | "white") => Position | null;
  isBookEligible: (
    difficulty: string,
    turn: "black" | "white",
    moveCount: number,
  ) => boolean;
}

/**
 * worktree からオープニングブック照会コード＋資産を動的 import する
 * （opening-book-2026-07-16.md ★v2プラン B3仕様）。
 *
 * ①book 照会コード+資産は worktreePath から動的 import する（host 側の
 *   コードを使うと A/B 両側が同一ブックになり比較が null 化するため）。
 * ②モジュール/資産の不在（旧コミット）は book-OFF として扱い、クラッシュしない
 *   （null を返すだけ。呼び出し側は従来の探索のみにフォールバックする）。
 *
 * 資産のロードには（Node生ESMがJSON importに import attribute を要求する
 * 制約を回避するため）動的 import ではなく readFileSync+JSON.parse を使い、
 * openingBook.ts の setOpeningBookAsset へ直接セットする（Node CLIスクリプト
 * と同じパターン。verify-book-blocks-traps.ts 参照）。
 */
export async function loadOpeningBookFromWorktree(
  worktreePath: string,
): Promise<OpeningBookBridge | null> {
  const assetPath = path.join(
    worktreePath,
    "src",
    "assets",
    "opening-book-hard.json",
  );
  if (!fs.existsSync(assetPath)) {
    console.warn(
      `[openingBookBridge] オープニングブック資産が見つかりません` +
        `（book-OFFとして続行）: ${assetPath}`,
    );
    return null;
  }

  try {
    const openingBookUrl = pathToFileURL(
      path.join(worktreePath, "src", "logic", "cpu", "openingBook.ts"),
    ).href;
    const bookGateUrl = pathToFileURL(
      path.join(worktreePath, "src", "logic", "cpu", "bookGate.ts"),
    ).href;
    const [openingBookModule, bookGateModule] = await Promise.all([
      import(openingBookUrl) as Promise<OpeningBookModuleExports>,
      import(bookGateUrl) as Promise<BookGateModuleExports>,
    ]);

    const { getBookMove, setOpeningBookAsset } = openingBookModule;
    const { isBookEligible } = bookGateModule;
    if (
      typeof getBookMove !== "function" ||
      typeof setOpeningBookAsset !== "function" ||
      typeof isBookEligible !== "function"
    ) {
      console.warn(
        "[openingBookBridge] オープニングブックモジュールの想定エクスポートが" +
          "見つかりません（book-OFFとして続行）",
      );
      return null;
    }

    const assetJson = JSON.parse(
      fs.readFileSync(assetPath, "utf-8"),
    ) as OpeningBookAssetLike;
    setOpeningBookAsset(assetJson);

    return { getBookMove, isBookEligible };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[openingBookBridge] オープニングブックのロードに失敗しました` +
        `（book-OFFとして続行）: ${msg}`,
    );
    return null;
  }
}
