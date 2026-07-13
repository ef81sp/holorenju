/**
 * 空点プロスペクト基底(eval_basis)の配線テスト
 *
 * docs/plans/eval-basis-prospect-2026-07-13.md §3.3 のとおり、eval_basis には
 * 2つのビットレイアウトが存在する:
 *   レイアウトA（bit24）: bridge.ts encodeEvalOptions → evaluate.decodeOptions
 *   レイアウトB（bit18）: searchEngine.ts encodeEvalOptions → main.zig findBestMove 手動デコード
 * 配線漏れは silent に「legacy と legacy を比較する事故」になるため、
 * evalOptionsWiring.wasm.test.ts の流儀を踏襲して両レイアウトの配線を固定する。
 */

import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { WasmBoardEvaluator } from "./bridge";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/* eslint-disable no-bitwise -- テスト内でビットフィールドを手動エンコード */

// ────────────────────────────────────────────────
// テスト局面
// ────────────────────────────────────────────────

function emptyBoard(): BoardState {
  const board: BoardState = [];
  for (let r = 0; r < 15; r++) {
    board.push(Array<null>(15).fill(null));
  }
  return board;
}

function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => [...row]);
}

/**
 * 黒の四三点フィクスチャ（prospect.zig の setupFourThreeFixture と同一局面）。
 * (7,7) が黒の四三点（横=b4, 縦=f3）になる非対称局面。
 */
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
 * 黒白ともに死四（両端塞がり）を2本ずつ持つ局面（即詰み・即勝ち手なし）。
 * evalOptionsWiring.wasm.test.ts の buildFourHeavyBoard と同一構成。
 * preSearch の即決を避け、maxNodes=1 で root 直下の静的評価に確実に落とすために使う。
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

const PROSPECT_EVAL_CLAMP = 10000;

// ────────────────────────────────────────────────
// レイアウトA: evaluateBoard（bit24）
// ────────────────────────────────────────────────

describe("レイアウトA: WasmBoardEvaluator.evaluateBoard の eval_basis 配線(bit24)", () => {
  it("evalBasis未指定(legacy)とprospectで評価値が異なる", async () => {
    const wasm = await loadWasmModule();
    const evaluator = new WasmBoardEvaluator(wasm);
    const board = buildFourThreeBoard();

    const legacyScore = evaluator.evaluateBoard(board, "black");
    const prospectScore = evaluator.evaluateBoard(board, "black", {
      evalBasis: "prospect",
    });

    expect(prospectScore).not.toBe(legacyScore);
  });

  it("evalBasis:'legacy' を明示しても未指定と同一（明示指定のリグレッション確認）", async () => {
    const wasm = await loadWasmModule();
    const evaluator = new WasmBoardEvaluator(wasm);
    const board = buildFourThreeBoard();

    const implicitLegacy = evaluator.evaluateBoard(board, "black");
    const explicitLegacy = evaluator.evaluateBoard(board, "black", {
      evalBasis: "legacy",
    });

    expect(explicitLegacy).toBe(implicitLegacy);
  });

  it("prospectの評価値は PROSPECT_EVAL_CLAMP(±10000) の範囲内", async () => {
    const wasm = await loadWasmModule();
    const evaluator = new WasmBoardEvaluator(wasm);
    const board = buildFourThreeBoard();

    const prospectScore = evaluator.evaluateBoard(board, "black", {
      evalBasis: "prospect",
    });

    expect(prospectScore).toBeGreaterThanOrEqual(-PROSPECT_EVAL_CLAMP);
    expect(prospectScore).toBeLessThanOrEqual(PROSPECT_EVAL_CLAMP);
  });

  it("黒視点と白視点で評価値の符号が反転する（反対称性、prospect）", async () => {
    const wasm = await loadWasmModule();
    const evaluator = new WasmBoardEvaluator(wasm);
    const board = buildFourThreeBoard();

    const blackScore = evaluator.evaluateBoard(board, "black", {
      evalBasis: "prospect",
    });
    const whiteScore = evaluator.evaluateBoard(board, "white", {
      evalBasis: "prospect",
    });

    expect(blackScore).toBe(-whiteScore);
  });
});

// ────────────────────────────────────────────────
// レイアウトB: findBestMove（bit18、探索経路）
// ────────────────────────────────────────────────

describe("レイアウトB: findBestMove の eval_basis 配線(bit18, 探索経路)", () => {
  it("maxNodes=1のtimeoutスコアがbit18(prospect)有無で変わる", async () => {
    const wasm = await loadWasmModule();
    const engine = new WasmSearchEngine(wasm);
    const board = buildFourHeavyBoard();

    engine.clearTT();
    const legacyResult = engine.findBestMoveWithParams(
      board,
      "black",
      6,
      0,
      1,
      0,
    );

    engine.clearTT();
    const prospectResult = engine.findBestMoveWithParams(
      board,
      "black",
      6,
      0,
      1,
      1 << 18,
    );

    expect(prospectResult.score).not.toBe(legacyResult.score);
  });
});

// ────────────────────────────────────────────────
// クロスレイアウト整合性
// ────────────────────────────────────────────────

describe("クロスレイアウト整合性: findBestMove(abort) と evaluateBoard の一致", () => {
  /**
   * maxNodes=1 で findBestMove を呼ぶと、root で最初に試された候補手を1手置いた
   * 局面の static eval（incremental_eval.getEvaluation、abort 時は
   * abortEvalOptions 経由）がそのままスコアとして返る（実挙動を検証済み、
   * 候補手はムーブオーダリング依存だが result.position から読み取れる）。
   *
   * このとき is_maximizing=false（探索候補手を打った側=black の相手番）で abort する
   * ため、last_mover_is_perspective は .yes（= 直前に black=perspective が着手した）
   * になる。よって「候補手を反映した局面」に対して
   * evaluateBoard(black, { lastMoverIsPerspective: true, evalBasis }) を呼べば
   * 探索経路の timeout スコアと厳密に一致するはずである（legacy/prospect 両方で検証）。
   */
  it.each(["legacy", "prospect"] as const)(
    "%s: findBestMove(maxNodes=1) のスコアは、候補手を反映した局面への evaluateBoard(lastMover=yes) と一致する",
    async (evalBasis) => {
      const wasm = await loadWasmModule();
      const engine = new WasmSearchEngine(wasm);
      const evaluator = new WasmBoardEvaluator(wasm);
      const board = buildFourHeavyBoard();

      const flags = evalBasis === "prospect" ? 1 << 18 : 0;
      engine.clearTT();
      const result = engine.findBestMoveWithParams(
        board,
        "black",
        6,
        0,
        1,
        flags,
      );

      const boardAfterCandidateMove = cloneBoard(board);
      boardAfterCandidateMove[result.position.row]![result.position.col] =
        "black";

      const directScore = evaluator.evaluateBoard(
        boardAfterCandidateMove,
        "black",
        {
          lastMoverIsPerspective: true,
          evalBasis: evalBasis === "prospect" ? "prospect" : undefined,
        },
      );

      expect(result.score).toBe(directScore);
    },
  );
});

/* eslint-enable no-bitwise */
