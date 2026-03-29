/* eslint-disable no-bitwise -- WASM option bitfield encoding requires bitwise ops */

/**
 * evaluateBoard WASM パリティテスト
 *
 * WASM版 evaluateBoard（跳びパターン含む）と TS版 evaluateBoard の完全一致を検証する。
 */

import { describe, expect, it } from "vitest";

import type { WasmModuleContext } from "./types";

import { evaluateBoard } from "../evaluation/boardEvaluation";
import { createBoardWithStones } from "../testUtils";
import { boardStateToWasm, colorToWasm } from "./boardAdapter";
import { loadWasmModule } from "./loader";

interface EvalOptions {
  enableLeafMise?: boolean;
  lastMoverIsPerspective?: boolean;
  singleFourPenaltyMultiplier?: number;
  connectivityBonusValue?: number;
}

// ────────────────────────────────────────────
// WASM ビットフィールドエンコード
// ────────────────────────────────────────────

function encodeEvalOptions(options?: EvalOptions): number {
  let flags = 0;

  if (options?.enableLeafMise) {
    flags |= 1;
  }

  if (options?.lastMoverIsPerspective !== undefined) {
    flags |= (options.lastMoverIsPerspective ? 1 : 2) << 1;
  }

  if (options?.singleFourPenaltyMultiplier !== undefined) {
    const raw = Math.round(options.singleFourPenaltyMultiplier * 100);
    flags |= (raw & 0xff) << 8;
  }

  if (options?.connectivityBonusValue !== undefined) {
    // 0=デフォルト(30)なので、明示的な0は255で送る（Zig側で0に変換）
    const raw =
      options.connectivityBonusValue === 0
        ? 255
        : options.connectivityBonusValue;
    flags |= (raw & 0xff) << 16;
  }

  return flags;
}

// ────────────────────────────────────────────
// テスト本体
// ────────────────────────────────────────────

function runParity(
  wasm: WasmModuleContext,
  stones: { row: number; col: number; color: "black" | "white" }[],
  perspective: "black" | "white",
  options?: EvalOptions,
): void {
  const board = createBoardWithStones(stones);

  const tsResult = evaluateBoard(board, perspective, {
    enableLeafMise: options?.enableLeafMise,
    lastMoverIsPerspective: options?.lastMoverIsPerspective,
    singleFourPenaltyMultiplier: options?.singleFourPenaltyMultiplier,
    connectivityBonusValue: options?.connectivityBonusValue,
  });

  boardStateToWasm(wasm, board);
  const wasmResult = wasm.evaluateBoard(
    colorToWasm(perspective),
    encodeEvalOptions(options),
  );

  expect(wasmResult).toBe(tsResult);
}

describe("evaluateBoard WASM parity", async () => {
  const wasm: WasmModuleContext = await loadWasmModule();

  describe("基本ケース", () => {
    it("空盤面 → 0", () => {
      runParity(wasm, [], "black");
    });

    it("単独石 → 0", () => {
      runParity(wasm, [{ row: 7, col: 7, color: "black" }], "black");
    });

    it("対称配置 → black と white で符号反転", () => {
      const stones: { row: number; col: number; color: "black" | "white" }[] = [
        { row: 7, col: 6, color: "black" },
        { row: 7, col: 7, color: "black" },
        { row: 7, col: 8, color: "black" },
        { row: 3, col: 6, color: "white" },
        { row: 3, col: 7, color: "white" },
        { row: 3, col: 8, color: "white" },
      ];
      const board = createBoardWithStones(stones);
      boardStateToWasm(wasm, board);

      const refBlack = evaluateBoard(board, "black");
      const refWhite = evaluateBoard(board, "white");
      const wasmBlack = wasm.evaluateBoard(colorToWasm("black"), 0);
      const wasmWhite = wasm.evaluateBoard(colorToWasm("white"), 0);

      expect(wasmBlack).toBe(refBlack);
      expect(wasmWhite).toBe(refWhite);
      expect(wasmBlack + wasmWhite).toBe(0);
    });
  });

  describe("活三パターン", () => {
    it("黒活三 → 黒視点で正スコア", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
        ],
        "black",
      );
    });

    it("白活三 → 白視点で正スコア", () => {
      runParity(
        wasm,
        [
          { row: 5, col: 5, color: "white" },
          { row: 5, col: 6, color: "white" },
          { row: 5, col: 7, color: "white" },
        ],
        "white",
      );
    });
  });

  describe("四パターン", () => {
    it("片端塞がり四", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 3, color: "white" },
          { row: 7, col: 4, color: "black" },
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
        ],
        "black",
      );
    });

    it("活四（両端開）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
        ],
        "black",
      );
    });
  });

  describe("複数方向パターン", () => {
    it("十字配置 — 連携ボーナスあり", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
        ],
        "black",
      );
    });
  });

  describe("四三脅威スキャン", () => {
    it("四三が作れる配置 → 脅威ボーナス", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
        ],
        "black",
      );
    });

    it("石数5未満 → 脅威スキャンスキップ", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 3, col: 3, color: "white" },
        ],
        "black",
      );
    });
  });

  describe("オプション", () => {
    it("enableLeafMise=true", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 7, col: 4, color: "white" },
          { row: 5, col: 5, color: "black" },
          { row: 6, col: 5, color: "black" },
          { row: 8, col: 5, color: "black" },
          { row: 2, col: 2, color: "white" },
          { row: 2, col: 3, color: "white" },
        ],
        "black",
        { enableLeafMise: true },
      );
    });

    it("lastMoverIsPerspective=true（テンポ補正）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
        ],
        "black",
        { lastMoverIsPerspective: true },
      );
    });

    it("lastMoverIsPerspective=false（相手のテンポ補正）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
          { row: 3, col: 5, color: "white" },
        ],
        "black",
        { lastMoverIsPerspective: false },
      );
    });

    it("singleFourPenaltyMultiplier=0.7", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 7, col: 4, color: "white" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
        ],
        "black",
        { singleFourPenaltyMultiplier: 0.7 },
      );
    });

    it("connectivityBonusValue=0（無効）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
        ],
        "black",
        { connectivityBonusValue: 0 },
      );
    });
  });

  describe("黒オーバーライン補正", () => {
    it("黒4連の先に黒石 → 端を塞がりとして扱う", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 7, col: 10, color: "black" },
        ],
        "black",
      );
    });
  });

  describe("跳びパターン", () => {
    it("跳び四（●●●・●）", () => {
      // (7,5),(7,6),(7,7),_,(7,9) → 跳び四
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 9, color: "black" },
          { row: 3, col: 3, color: "white" },
        ],
        "black",
      );
    });

    it("跳び四（●●・●●）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 7, col: 9, color: "black" },
          { row: 3, col: 3, color: "white" },
        ],
        "black",
      );
    });

    it("跳び三（・●●・●・）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 3, col: 3, color: "white" },
        ],
        "black",
      );
    });

    it("跳び三（・●・●●・）", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 3, col: 3, color: "white" },
        ],
        "black",
      );
    });

    it("跳び四 + 連続三 → 四三脅威", () => {
      // 横に跳び四、縦に連続三
      runParity(
        wasm,
        [
          { row: 7, col: 4, color: "black" },
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
        ],
        "black",
      );
    });

    it("白の跳びパターン", () => {
      runParity(
        wasm,
        [
          { row: 5, col: 5, color: "white" },
          { row: 5, col: 6, color: "white" },
          { row: 5, col: 8, color: "white" },
          { row: 5, col: 9, color: "white" },
          { row: 7, col: 7, color: "black" },
        ],
        "white",
      );
    });

    it("斜め跳び四", () => {
      // 右下斜め: (3,3),(4,4),(5,5),_,(7,7)
      runParity(
        wasm,
        [
          { row: 3, col: 3, color: "black" },
          { row: 4, col: 4, color: "black" },
          { row: 5, col: 5, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 10, col: 10, color: "white" },
        ],
        "black",
      );
    });
  });

  describe("禁手関連", () => {
    it("黒三三（禁手）の配置", () => {
      // 横三 + 縦三の交点が禁手
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
        ],
        "black",
      );
    });

    it("黒四四の配置", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 4, color: "black" },
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 5, col: 7, color: "black" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
          { row: 3, col: 3, color: "white" },
          { row: 3, col: 4, color: "white" },
        ],
        "black",
      );
    });
  });

  describe("混合配置", () => {
    it("両者複数パターンの中盤局面", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 6, col: 6, color: "black" },
          { row: 8, col: 8, color: "black" },
          { row: 4, col: 3, color: "white" },
          { row: 5, col: 3, color: "white" },
          { row: 6, col: 3, color: "white" },
          { row: 10, col: 9, color: "white" },
          { row: 10, col: 10, color: "white" },
        ],
        "black",
      );
    });

    it("全オプション有効の複雑局面", () => {
      runParity(
        wasm,
        [
          { row: 7, col: 5, color: "black" },
          { row: 7, col: 6, color: "black" },
          { row: 7, col: 7, color: "black" },
          { row: 7, col: 8, color: "black" },
          { row: 7, col: 4, color: "white" },
          { row: 6, col: 7, color: "black" },
          { row: 8, col: 7, color: "black" },
          { row: 5, col: 5, color: "black" },
          { row: 4, col: 3, color: "white" },
          { row: 5, col: 3, color: "white" },
          { row: 6, col: 3, color: "white" },
          { row: 10, col: 9, color: "white" },
          { row: 10, col: 10, color: "white" },
        ],
        "black",
        {
          enableLeafMise: true,
          lastMoverIsPerspective: true,
          singleFourPenaltyMultiplier: 0.8,
          connectivityBonusValue: 50,
        },
      );
    });
  });
});
