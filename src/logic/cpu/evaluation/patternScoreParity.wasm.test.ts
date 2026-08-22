/**
 * パターンスコア／パターンタイプの TS⇄Zig パリティテスト（issue #132）
 *
 * `getPatternScore` / `getPatternType` は TS
 * (`evaluation/directionAnalysis.ts`) と Zig (`zig/src/patterns.zig`) に
 * 二重実装されている。#132 で「黒の長連（6 連以上＝禁手）は五でも四でもない」を
 * 両方に入れたので、その一致を全入力の直積で機械的に確認する。
 *
 * 入力空間は小さい（count 0..15 × end1 3 値 × end2 3 値 × 色 2）ので全列挙する。
 */

import { describe, expect, it } from "vitest";

import type { PlayerColor } from "@/logic/renjuRules";

import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { CELL, END_STATE } from "@/logic/cpu/wasm/types";

import type { EndState, PatternType } from "./patternScores";

import { getPatternScore, getPatternType } from "./directionAnalysis";

const wasm = await loadWasmModule();

const END_STATES: { name: EndState; code: number }[] = [
  { name: "empty", code: END_STATE.EMPTY },
  { name: "opponent", code: END_STATE.OPPONENT },
  { name: "edge", code: END_STATE.EDGE },
];

const COLORS: { name: PlayerColor; code: number }[] = [
  { name: "black", code: CELL.BLACK },
  { name: "white", code: CELL.WHITE },
];

/** Zig `PatternType` の enum 値 → TS の PatternType 文字列 */
const TYPE_CODE_TO_NAME: PatternType[] = [
  null,
  "five",
  "openFour",
  "four",
  "openThree",
  "three",
  "openTwo",
  "two",
];

/** count の上限。ライン長 15 が物理的な最大 */
const MAX_COUNT = 15;

describe("getPatternScore / getPatternType の TS⇄Zig パリティ", () => {
  it("count 0..15 × 端状態 3×3 × 色 2 の全入力で一致する", () => {
    for (const color of COLORS) {
      for (let count = 0; count <= MAX_COUNT; count++) {
        for (const end1 of END_STATES) {
          for (const end2 of END_STATES) {
            const label = `count=${count} e1=${end1.name} e2=${end2.name} color=${color.name}`;
            const pattern = { count, end1: end1.name, end2: end2.name };

            expect(
              wasm.wasmGetPatternScore(count, end1.code, end2.code, color.code),
              `score: ${label}`,
            ).toBe(getPatternScore(pattern, color.name));

            const zigType =
              TYPE_CODE_TO_NAME[
                wasm.wasmGetPatternType(count, end1.code, end2.code, color.code)
              ] ?? null;
            expect(zigType, `type: ${label}`).toBe(
              getPatternType(pattern, color.name),
            );
          }
        }
      }
    }
  });

  // #132 の本体: 色盲だったころは黒の長連も FIVE(100000) を返していた
  it("黒の長連（6 連以上）は 0 点・null、白の長連は五（両実装）", () => {
    for (let count = 6; count <= MAX_COUNT; count++) {
      expect(
        wasm.wasmGetPatternScore(
          count,
          END_STATE.EMPTY,
          END_STATE.EMPTY,
          CELL.BLACK,
        ),
        `zig black count=${count}`,
      ).toBe(0);
      expect(
        getPatternScore({ count, end1: "empty", end2: "empty" }, "black"),
        `ts black count=${count}`,
      ).toBe(0);
      expect(
        wasm.wasmGetPatternType(
          count,
          END_STATE.EMPTY,
          END_STATE.EMPTY,
          CELL.WHITE,
        ),
        `zig white count=${count}`,
      ).toBe(1); // five
    }
  });
});
