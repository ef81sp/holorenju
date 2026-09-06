/**
 * 振り返り exact_top_k の実機テスト（review-multipv-2026-09-06.md §3）
 *
 * 実 wasm で `findBestMoveForReview` を呼び、root 上位 K 手の真値化
 * （`refineTopCandidates`）が TS 側から観測できる形で効いていることを固定する。
 *
 * - (a) `exactTopK = 5` で候補が 2 件以上なら先頭 min(5, 件数) 件が `scoreExact` かつ降順
 * - (b) `exactTopK = 0` は全候補が境界値（`scoreExact = false`）。最善手は 5 の側と
 *       一致し同スコア、一致しない場合は 5 の側が 0 の側以上（再探索で最善を超える手が出る仕様）
 * - (c) `forcedMove` に候補外の空点を渡すと候補に含まれ真値、件数は最大 6
 * - (d) `exactTopK = 0` で 2 位以下が同値だった組が、5 では別の値に分かれる局面
 *
 * 局面は設計メモ §3-0 の参照棋譜（白番 29 手）の途中局面。黒番の局面は脅威プローブが
 * 重く 1 局面数十秒かかるので白番だけを使う。決定的モード（壁時計を読まずノード予算で
 * 縛る）にして、ベンチ負荷下でも同じ結果になるようにする。
 */

import { afterAll, describe, expect, it } from "vitest";

import type { BoardState, Position } from "@/types/game";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import {
  encodeEvalOptions,
  WasmSearchEngine,
  type WasmCandidateEntry,
} from "../wasm/searchEngine";
import { REVIEW_SEARCH_PARAMS } from "./reviewConstants";

const wasm = await loadWasmModule();
wasm.setDeterministicMode?.(1);
afterAll(() => {
  wasm.setDeterministicMode?.(0);
});
const engine = new WasmSearchEngine(wasm);

/** fullEval.ts の REVIEW_EVAL_FLAGS 相当（hard 評価オプション） */
const EVAL_FLAGS = encodeEvalOptions(REVIEW_SEARCH_PARAMS.evaluationOptions);
const DEPTH = 6;
const MAX_NODES = 300_000;
const ASPIRATION_MODE = 1;

/** 設計メモ §3-0 の参照棋譜（白番 29 手） */
const RECORD =
  "H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12";

/**
 * 白番の途中局面（着手数）。事前探索で即決されず、決定的モードで候補が 2 件以上出るもの。
 * - 7: 候補 2 件（F6 / J10）
 * - 11: 候補 5 件。exactTopK=0 で I7 と I10 が同値（-3603）に並び、5 では分かれる
 * - 13: 候補 2 件（J9 / F5）
 */
const WHITE_POSITIONS = [7, 11, 13] as const;

/** 候補に絶対入らない盤隅の空点（C3） */
const FAR_EMPTY_POINT: Position = { row: 2, col: 2 };

function positionAt(moveCount: number): {
  board: BoardState;
  color: "black" | "white";
} {
  const record = RECORD.split(" ").slice(0, moveCount).join(" ");
  const { board, nextColor } = createBoardFromRecord(record);
  return { board, color: nextColor };
}

function search(
  moveCount: number,
  exactTopK: number,
  forcedMove?: Position,
): WasmCandidateEntry[] & { best: Position; bestScore: number } {
  const { board, color } = positionAt(moveCount);
  const result = engine.findBestMoveForReview(
    board,
    color,
    DEPTH,
    0,
    MAX_NODES,
    0,
    ASPIRATION_MODE,
    EVAL_FLAGS,
    exactTopK,
    forcedMove,
  );
  return Object.assign(result.candidates, {
    best: result.position,
    bestScore: result.score,
  });
}

function samePosition(a: Position, b: Position): boolean {
  return a.row === b.row && a.col === b.col;
}

function isDescending(scores: number[]): boolean {
  return scores.every((s, i) => i === 0 || (scores[i - 1] ?? s) >= s);
}

describe.each(WHITE_POSITIONS)("参照棋譜 白番 %d 手目の局面", (moveCount) => {
  const k0 = search(moveCount, 0);
  const k5 = search(moveCount, 5);

  it("候補が 2 件以上ある（事前探索で即決されない局面）", () => {
    expect(k0.length).toBeGreaterThanOrEqual(2);
    expect(k5.length).toBeGreaterThanOrEqual(2);
  });

  it("(a) exactTopK=5: 先頭 min(5, 件数) 件が scoreExact で、スコアは降順", () => {
    const exactCount = Math.min(5, k5.length);
    for (let i = 0; i < exactCount; i++) {
      expect(k5[i]?.scoreExact, `候補 ${i}`).toBe(true);
    }
    expect(isDescending(k5.map((c) => c.score))).toBe(true);
  });

  it("(b) exactTopK=0: 全候補が境界値（scoreExact=false）", () => {
    expect(k0.every((c) => c.scoreExact === false)).toBe(true);
  });

  it("(b) 最善手は exactTopK=0 と一致して同スコア、または 5 の側が 0 の側以上", () => {
    const [best0] = k0;
    const [best5] = k5;
    expect(best0).toBeDefined();
    expect(best5).toBeDefined();
    if (!best0 || !best5) {
      return;
    }
    expect(samePosition(k5.best, best5.position)).toBe(true);
    expect(k5.bestScore).toBe(best5.score);
    if (samePosition(best0.position, best5.position)) {
      expect(best5.score).toBe(best0.score);
    } else {
      expect(best5.score).toBeGreaterThanOrEqual(best0.score);
    }
  });

  it("(c) forcedMove に候補外の空点を渡すと真値で候補に含まれ、件数は最大 6", () => {
    expect(k5.some((c) => samePosition(c.position, FAR_EMPTY_POINT))).toBe(
      false,
    );
    const forced = search(moveCount, 5, FAR_EMPTY_POINT);
    const entry = forced.find((c) => samePosition(c.position, FAR_EMPTY_POINT));
    expect(entry).toBeDefined();
    expect(entry?.scoreExact).toBe(true);
    expect(forced.length).toBeLessThanOrEqual(6);
    expect(forced.length).toBe(Math.min(6, k5.length + 1));
    // 強制候補以外の並びと真値は exactTopK=5 単独と同じ
    const rest = forced.filter(
      (c) => !samePosition(c.position, FAR_EMPTY_POINT),
    );
    expect(rest.map((c) => [c.position, c.score, c.scoreExact])).toEqual(
      k5.map((c) => [c.position, c.score, c.scoreExact]),
    );
  });
});

describe("(d) exactTopK=0 で同値に並んだ 2 位以下が exactTopK=5 で分かれる（白番 11 手目）", () => {
  const k0 = search(11, 0);
  const k5 = search(11, 5);

  it("exactTopK=0 では 2 位以下に同値の組がある", () => {
    const tied = findTiedPairs(k0);
    expect(tied.length).toBeGreaterThan(0);
  });

  it("その組は exactTopK=5 ではどちらも真値で、別の値になる", () => {
    const tied = findTiedPairs(k0);
    const split = tied.filter(([a, b]) => {
      const ea = k5.find((c) => samePosition(c.position, a.position));
      const eb = k5.find((c) => samePosition(c.position, b.position));
      return (
        ea?.scoreExact === true &&
        eb?.scoreExact === true &&
        ea.score !== eb.score
      );
    });
    expect(split.length).toBeGreaterThan(0);
  });
});

/** 2 位以下（index >= 1）で同じスコアの候補の組を列挙する */
function findTiedPairs(
  candidates: WasmCandidateEntry[],
): [WasmCandidateEntry, WasmCandidateEntry][] {
  const pairs: [WasmCandidateEntry, WasmCandidateEntry][] = [];
  for (let i = 1; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a && b && a.score === b.score) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}
