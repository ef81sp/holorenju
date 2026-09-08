/**
 * evalParams.ts（TS の名前→id 表）と wasm（scores.zig / prospect.zig）の照合。
 *
 * 1. 双方向照合: id 空間を `getEvalParamName` で走査し、非空の名前集合が TS の
 *    `EVAL_PARAM_IDS` のキー集合と一致し、各キーの id も一致する（ドリフト検出）。
 * 2. 注入効果: prospect id を `setEvalParam` するとフル評価（evaluateBoard, prospect 基底）
 *    が既定から変わり、探索側のインクリメンタル評価経路（findBestMove maxNodes=1）とも
 *    一致する。`resetEvalParams` で既定に戻る。
 *
 * docs/plans/strength-screen-2026-09-08.md §2 T1-3。
 */
import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { boardStateToWasm } from "@/logic/cpu/wasm/boardAdapter";
import { WasmBoardEvaluator } from "@/logic/cpu/wasm/bridge";
import { loadWasmModule } from "@/logic/cpu/wasm/loader";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";

import { EVAL_PARAM_IDS, PROSPECT_PARAM_ID_BASE } from "./evalParams.ts";
import { readCString } from "./wasmCString.ts";

/** 走査上限（prospect 末尾 133 より十分大きい）。 */
const ID_SCAN_LIMIT = 256;
/** searchEngine.ts レイアウトB の eval_basis ビット（prospectBasisWiring.wasm.test.ts と同じ）。 */
const PROSPECT_BASIS_FLAG_SEARCH = 1 << 18;

function emptyBoard(): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < 15; r++) {
    board.push(Array<null>(15).fill(null));
  }
  return board;
}

/** 黒の四三点フィクスチャ（prospectBasisWiring.wasm.test.ts の buildFourThreeBoard と同一）。 */
function buildFourThreeBoard(): BoardState {
  const board = emptyBoard();
  board[7]![3] = "white";
  board[7]![4] = "black";
  board[7]![5] = "black";
  board[7]![6] = "black";
  board[5]![7] = "black";
  board[6]![7] = "black";
  return board;
}

/**
 * 黒白ともに死四（両端塞がり）を 2 本ずつ持つ局面（即詰み・即勝ち手なし）。
 * prospectBasisWiring.wasm.test.ts の buildFourHeavyBoard と同一構成。
 */
function buildFourHeavyBoard(): BoardState {
  const board = emptyBoard();
  board[7]![4] = "black";
  board[7]![5] = "black";
  board[7]![6] = "black";
  board[7]![7] = "black";
  board[7]![3] = "white";
  board[7]![8] = "white";

  board[4]![12] = "black";
  board[5]![12] = "black";
  board[6]![12] = "black";
  board[7]![12] = "black";
  board[3]![12] = "white";
  board[8]![12] = "white";

  board[1]![4] = "white";
  board[1]![5] = "white";
  board[1]![6] = "white";
  board[1]![7] = "white";
  board[1]![3] = "black";
  board[1]![8] = "black";

  board[4]![2] = "white";
  board[5]![2] = "white";
  board[6]![2] = "white";
  board[7]![2] = "white";
  board[3]![2] = "black";
  board[8]![2] = "black";

  return board;
}

/** 局面の prospect 特徴ベクトル（index = id - PROSPECT_PARAM_ID_BASE）。 */
function prospectFeatures(
  wasm: Awaited<ReturnType<typeof loadWasmModule>>,
  board: BoardState,
): number[] {
  boardStateToWasm(wasm, board);
  const count = wasm.extractProspectFeatures(1, 1);
  const ptr = wasm.getProspectFeatureBuffer();
  const view = new DataView(wasm.memory.buffer);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(view.getInt32(ptr + i * 4, true));
  }
  return out;
}

describe("EVAL_PARAM_IDS と wasm getEvalParamName の双方向照合", () => {
  it("wasm の非空名の集合 == TS のキー集合、かつ各 id が一致する", async () => {
    const wasm = await loadWasmModule();
    const wasmNames = new Map<string, number>();
    for (let id = 0; id < ID_SCAN_LIMIT; id++) {
      const name = readCString(wasm, wasm.getEvalParamName(id));
      if (name === "") {
        continue;
      }
      expect(wasmNames.has(name), `wasm 側で名前が重複: ${name}`).toBe(false);
      wasmNames.set(name, id);
    }
    const tsEntries = Object.entries(EVAL_PARAM_IDS);
    expect([...wasmNames.keys()].sort()).toEqual(
      tsEntries.map(([k]) => k).sort(),
    );
    for (const [name, id] of tsEntries) {
      expect(wasmNames.get(name), `id 不一致: ${name}`).toBe(id);
    }
  });

  it("prospect 基底の重みは全 id が既定値を持つ（getEvalParam が sentinel でない）", async () => {
    const wasm = await loadWasmModule();
    wasm.resetEvalParams();
    for (const [name, id] of Object.entries(EVAL_PARAM_IDS)) {
      if (id < PROSPECT_PARAM_ID_BASE) {
        continue;
      }
      const v = wasm.getEvalParam(id);
      expect(v, `${name} が未定義 sentinel`).not.toBe(-2147483648);
    }
  });
});

describe("prospect id の setEvalParam がフル評価と探索側評価に効く", () => {
  const TARGET = "PROSPECT_SOLO_F3_TURN" as const;
  const targetId = EVAL_PARAM_IDS[TARGET];

  it("フィクスチャは対象特徴を持つ（前提固定）", async () => {
    const wasm = await loadWasmModule();
    const features = prospectFeatures(wasm, buildFourThreeBoard());
    expect(features[targetId - PROSPECT_PARAM_ID_BASE]).not.toBe(0);
  });

  it("注入後に evaluateBoard(prospect) が変わり、resetEvalParams で戻る", async () => {
    const wasm = await loadWasmModule();
    const evaluator = new WasmBoardEvaluator(wasm);
    const board = buildFourThreeBoard();

    wasm.resetEvalParams();
    const baseline = evaluator.evaluateBoard(board, "black", {
      evalBasis: "prospect",
    });
    const defaultWeight = wasm.getEvalParam(targetId);

    wasm.setEvalParam(targetId, defaultWeight + 100);
    expect(wasm.getEvalParam(targetId)).toBe(defaultWeight + 100);
    const injected = evaluator.evaluateBoard(board, "black", {
      evalBasis: "prospect",
    });
    expect(injected).not.toBe(baseline);

    // legacy 基底には影響しない
    wasm.resetEvalParams();
    const legacyBaseline = evaluator.evaluateBoard(board, "black");
    wasm.setEvalParam(targetId, defaultWeight + 100);
    expect(evaluator.evaluateBoard(board, "black")).toBe(legacyBaseline);

    wasm.resetEvalParams();
    expect(wasm.getEvalParam(targetId)).toBe(defaultWeight);
    expect(
      evaluator.evaluateBoard(board, "black", { evalBasis: "prospect" }),
    ).toBe(baseline);
  });

  /**
   * 探索側（incremental_eval 経由の abort 評価）でも注入が効くことを確認する。
   * 四三フィクスチャは事前探索で即決（勝ち手）してしまうので、即詰み・即勝ちの無い
   * 死四のみの局面（prospectBasisWiring.wasm.test.ts の buildFourHeavyBoard）を使う。
   * 注入対象 id は、候補手後の局面で計数が非ゼロの特徴から選ぶ（前提を明示）。
   */
  it("注入後の findBestMove(maxNodes=1) のスコアは候補手後局面の evaluateBoard(prospect) と一致する", async () => {
    const wasm = await loadWasmModule();
    const engine = new WasmSearchEngine(wasm);
    const evaluator = new WasmBoardEvaluator(wasm);
    const board = buildFourHeavyBoard();

    wasm.resetEvalParams();
    engine.clearTT();
    const defaultResult = engine.findBestMoveWithParams(
      board,
      "black",
      6,
      0,
      1,
      PROSPECT_BASIS_FLAG_SEARCH,
    );
    const after = board.map((row) => [...row]);
    after[defaultResult.position.row]![defaultResult.position.col] = "black";

    const features = prospectFeatures(wasm, after);
    const offset = features.findIndex((x) => x !== 0);
    expect(offset, "候補手後局面に非ゼロの prospect 特徴が無い").not.toBe(-1);
    const id = PROSPECT_PARAM_ID_BASE + offset;
    const defaultWeight = wasm.getEvalParam(id);
    const directDefault = evaluator.evaluateBoard(after, "black", {
      evalBasis: "prospect",
      lastMoverIsPerspective: true,
    });

    wasm.setEvalParam(id, defaultWeight + 100);
    engine.clearTT();
    const result = engine.findBestMoveWithParams(
      board,
      "black",
      6,
      0,
      1,
      PROSPECT_BASIS_FLAG_SEARCH,
    );
    // maxNodes=1 の候補手はムーブオーダリング依存だが、同一局面なら注入前後で同じ
    expect(result.position).toEqual(defaultResult.position);
    const direct = evaluator.evaluateBoard(after, "black", {
      evalBasis: "prospect",
      lastMoverIsPerspective: true,
    });
    wasm.resetEvalParams();

    expect(result.score).toBe(direct);
    expect(direct).not.toBe(directDefault);
  });
});
