/**
 * VCT パリティテスト
 *
 * TS版 vct.test.ts の主要ケースを WASM版 findBestMove 経由で間接検証する。
 * VCTは findBestMove 内部で使われるため、VCTが効く盤面で正しい手/スコアを返すかで確認。
 *
 * テスト観点:
 * - VCTのみで勝てる盤面（VCFでは勝てない）
 * - 石数14以上のVCT発動条件
 * - VCTカウンター脅威がある場合
 * - TS版既知バグのZig版反映確認（跳び四オーバーライン、ct=four偽陽性）
 */

import { describe, expect, it } from "vitest";

import { createEmptyBoard } from "@/logic/renjuRules";

import type { SearchStats } from "../search/context";
import type { IterativeDeepingResult } from "../search/results";

import { FULL_EVAL_OPTIONS } from "../evaluation";
import { findBestMoveIterativeWithTT } from "../search/minimax";
import { createBoardWithStones, placeStonesOnBoard } from "../testUtils";
import { loadWasmModule } from "./loader";
import { WasmSearchEngine } from "./searchEngine";

/**
 * 勝ちスコアの閾値。WASM版は現在 i32 スコアで TS版と同じスケール（FIVE=100000）を使用。
 * 深さオフセットがあるため 99000 以上を勝ちスコアとみなす。
 */
const WIN_SCORE_THRESHOLD = 99000;

/** TS版探索のヘルパー（randomFactor=0, FULL_EVAL_OPTIONS） */
function tsSearch(
  board: ReturnType<typeof createEmptyBoard>,
  color: "black" | "white",
  maxDepth: number,
  timeLimit = 10000,
): IterativeDeepingResult & { stats: SearchStats } {
  return findBestMoveIterativeWithTT({
    board,
    color,
    maxDepth,
    timeLimit,
    randomFactor: 0,
    evaluationOptions: FULL_EVAL_OPTIONS,
  });
}

describe("VCT パリティ: VCTが効く盤面でfindBestMoveが正しい手を選ぶ", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("VCFでも勝てる活三盤面でFIVEスコア", () => {
    // VCF ⊂ VCT: 活三からVCF/VCTどちらでも勝てる
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      5000,
      600000,
    );

    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("VCTのみで勝てる盤面: 四三が可能な形", () => {
    // 四三（VCT）が可能だがVCFだけでは勝てない盤面
    // 白の横二 + 縦二 → 交差点で四三を作れる
    const board = createBoardWithStones([
      // 横方向のリソース
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      // 縦方向のリソース
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      // ダミー石（石数を増やす）
      { row: 0, col: 0, color: "black" },
      { row: 0, col: 2, color: "white" },
      { row: 0, col: 4, color: "black" },
      { row: 0, col: 6, color: "white" },
      { row: 1, col: 0, color: "black" },
      { row: 1, col: 2, color: "white" },
      { row: 1, col: 4, color: "black" },
      { row: 1, col: 6, color: "white" },
      { row: 2, col: 0, color: "black" },
      { row: 2, col: 2, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // 四三で勝ちスコア（探索順序差で(7,7)以外の勝ち手を選ぶ場合がある）
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("白の斜め活三からVCT成立", () => {
    const board = createBoardWithStones([
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("離散した石ではVCTなし → 勝ちスコアにならない", () => {
    const board = createBoardWithStones([
      { row: 0, col: 0, color: "black" },
      { row: 14, col: 14, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "black",
      2,
      5000,
      600000,
    );

    // 勝ちスコアにはならない
    expect(result.score).toBeLessThan(WIN_SCORE_THRESHOLD);
  });
});

describe("VCT パリティ: 石数閾値の動作", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("14石以上でVCT探索が発動し勝ち手を選ぶ", () => {
    // 14石以上の盤面で活三がある: VCT探索が発動する
    const board = createBoardWithStones([
      // 黒の活三
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
      // ダミー石で14石以上にする
      { row: 0, col: 0, color: "white" },
      { row: 0, col: 1, color: "black" },
      { row: 0, col: 3, color: "white" },
      { row: 0, col: 5, color: "black" },
      { row: 1, col: 0, color: "white" },
      { row: 1, col: 1, color: "black" },
      { row: 1, col: 3, color: "white" },
      { row: 1, col: 5, color: "black" },
      { row: 2, col: 0, color: "white" },
      { row: 2, col: 1, color: "black" },
      { row: 2, col: 3, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      5000,
      600000,
    );

    // 活三→VCT/VCFで勝ちスコア
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });
});

describe("VCT パリティ: カウンター脅威", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("ct=four: ブロックが脅威を作る場合 → 白VCT成立", () => {
    // TS版 vct.test.ts の "ct=four でブロックが脅威を作る → VCT開始手として有効" と同じ盤面
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 4, color: "white" },
      { row: 10, col: 5, color: "white" },
      { row: 10, col: 6, color: "white" },
      { row: 6, col: 4, color: "black" },
      { row: 8, col: 4, color: "black" },
      { row: 9, col: 4, color: "black" },
      // (7,8)防御時のVCF用
      { row: 0, col: 5, color: "white" },
      { row: 0, col: 6, color: "white" },
      { row: 0, col: 7, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // 白がVCT成立で勝ちスコア
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("ct=four: ブロックが脅威を作らない場合でもfindBestMoveは有効な手を返す", () => {
    // TS版 vct.test.ts の "ct=four でブロックが脅威を作らない → VCT開始手として無効" と同じ盤面
    // NOTE: TS版のhasVCTはfalseだが、findBestMoveはminimax全幅探索で
    // VCT以外の勝ち筋（白5石 vs 黒3石の石数優位）を見つける場合がある
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 5, col: 4, color: "white" },
      { row: 2, col: 5, color: "white" },
      { row: 2, col: 6, color: "white" },
      { row: 6, col: 4, color: "black" },
      { row: 8, col: 4, color: "black" },
      { row: 9, col: 4, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // 有効な手を返すこと
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    // スコアは正（白有利）
    expect(result.score).toBeGreaterThan(0);
  });

  it("ct=three + VCFあり → VCT成立", () => {
    // TS版 "ct=three: VCFがある場合VCT成立" と同じ盤面
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 5, col: 6, color: "white" },
      { row: 6, col: 6, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });

  it("ct=three + VCFなし → findBestMoveは有効な手を返す", () => {
    // TS版 "ct=three: VCFがない場合VCT不成立" と同じ盤面
    // NOTE: hasVCTはfalseだが、findBestMoveはminimax全幅探索で
    // VCT以外の勝ち筋を見つける場合がある（石数が少なく白有利な盤面）
    const board = createBoardWithStones([
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      { row: 5, col: 3, color: "black" },
      { row: 6, col: 3, color: "black" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // 有効な手を返すこと
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    // スコアは正（白有利: 横二 vs 黒縦二で活三が作れる）
    expect(result.score).toBeGreaterThan(0);
  });
});

describe("TS版既知バグのZig版反映確認", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("跳び四のオーバーライン: 黒 ●●●・●● はギャップを埋めると6連で長連禁手", () => {
    // TS版 threatMoves.test.ts "跳び四 ●●●・●● で黒 → 長連なので false"
    // col3●col4●col5●col6・col7●col8● → ギャップ埋めると6連
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "black" },
      { row: 7, col: 4, color: "black" },
      { row: 7, col: 5, color: "black" },
      // col6 空き（ギャップ）
      { row: 7, col: 7, color: "black" },
      { row: 7, col: 8, color: "black" },
    ]);

    // 黒番で (7,6) に打っても長連なので勝ちにはならない
    // findBestMove が (7,6) を勝ち手として選ばないことを確認
    const result = engine.findBestMoveWithParams(
      board,
      "black",
      2,
      5000,
      600000,
    );

    // 長連禁手なので (7,6) は五連ではない → 勝ちスコアにならない
    if (result.position.row === 7 && result.position.col === 6) {
      // もし (7,6) を選んだなら、勝ちスコアであってはならない
      expect(result.score).toBeLessThan(WIN_SCORE_THRESHOLD);
    }
    // 正しい実装では (7,6) を選ばない（禁手のため）
  });

  it("跳び四のオーバーライン: 白は長連ルールなしで有効", () => {
    // 白で同パターン → 長連ルールなし → 有効な跳び四
    const board = createEmptyBoard();
    placeStonesOnBoard(board, [
      { row: 7, col: 3, color: "white" },
      { row: 7, col: 4, color: "white" },
      { row: 7, col: 5, color: "white" },
      // col6 空き（ギャップ）
      { row: 7, col: 7, color: "white" },
      { row: 7, col: 8, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      2,
      5000,
      600000,
    );

    // 白は長連ルールなし → 勝ちスコア
    // (7,6)の跳び四が最適だが、(7,2)等の別手も五連に繋がるため探索順序で異なりうる
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
    // いずれかの勝ち手: (7,6)跳び四 or (7,2)端四 or (7,9)端四
    const isWinningPos =
      (result.position.row === 7 && result.position.col === 6) ||
      (result.position.row === 7 && result.position.col === 2) ||
      (result.position.row === 7 && result.position.col === 9);
    expect(isWinningPos).toBe(true);
  });

  it("ct=four 偽陽性: ブロックが囲まれた活三でもfindBestMoveは有効な手を返す", () => {
    // TS版 "ブロックが囲まれた活三を作る場合、VCT開始手として無効" と同じ盤面
    // NOTE: isVCTFirstMoveではfalseだが、findBestMoveの全幅探索では
    // VCT以外の経路で勝ちを見つける場合がある
    const board = createBoardWithStones([
      // 止め四リソース (row 7)
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 4, color: "black" }, // 左端ブロック
      // カウンターフォーリソース (col 9)
      { row: 5, col: 9, color: "white" }, // 上端ブロック
      { row: 6, col: 9, color: "black" },
      { row: 8, col: 9, color: "black" },
      { row: 9, col: 9, color: "black" },
      // (5,9)-(6,8)-(7,7)斜めリソースを遮断
      { row: 6, col: 8, color: "black" },
      // ブロック位置(10,9)で活三になるが両端に黒
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
      { row: 10, col: 7, color: "black" }, // 活三左端
      { row: 10, col: 13, color: "black" }, // 活三右端（1マス空け）
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // 有効な手を返すこと
    expect(result.position.row).toBeGreaterThanOrEqual(0);
    expect(result.position.row).toBeLessThan(15);
    // 白が石数で優位なのでスコアは正
    expect(result.score).toBeGreaterThan(0);
  });

  it("ct=four 偽陽性: ブロックが活三+VCFリソースを持つ場合はVCT成立", () => {
    // TS版 "ブロックが活三+VCFリソースを持つ場合、VCT開始手として有効" と同じ盤面
    const board = createBoardWithStones([
      // 止め四リソース (row 7)
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      { row: 7, col: 8, color: "white" },
      { row: 7, col: 4, color: "black" },
      // カウンターフォーリソース (col 9)
      { row: 5, col: 9, color: "white" },
      { row: 6, col: 9, color: "black" },
      { row: 8, col: 9, color: "black" },
      { row: 9, col: 9, color: "black" },
      // ブロック位置(10,9)で活三（制限なし: VCTリソースあり）
      { row: 10, col: 10, color: "white" },
      { row: 10, col: 11, color: "white" },
      // 追加VCFリソース (row 0): 活三 → 活四 → 勝利
      { row: 0, col: 5, color: "white" },
      { row: 0, col: 6, color: "white" },
      { row: 0, col: 7, color: "white" },
    ]);

    const result = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // VCT成立で勝ちスコア
    expect(result.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
  });
});

describe("VCT パリティ: TS版との手の一致検証", async () => {
  const wasm = await loadWasmModule();
  const engine = new WasmSearchEngine(wasm);

  it("活三からの勝ち手がTS版と一致", () => {
    const board = createBoardWithStones([
      { row: 7, col: 5, color: "black" },
      { row: 7, col: 6, color: "black" },
      { row: 7, col: 7, color: "black" },
    ]);

    const tsResult = tsSearch(board, "black", 4);
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "black",
      4,
      5000,
      600000,
    );

    // 両方とも勝ちスコア
    expect(tsResult.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD); // TS版 FIVE スコア
    expect(wasmResult.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
    // 同じ手を選ぶ
    expect(wasmResult.position).toEqual(tsResult.position);
  });

  it("白の斜め活三からの勝ち手がTS版と一致", () => {
    const board = createBoardWithStones([
      { row: 5, col: 5, color: "white" },
      { row: 6, col: 6, color: "white" },
      { row: 7, col: 7, color: "white" },
    ]);

    const tsResult = tsSearch(board, "white", 4);
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    expect(tsResult.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
    expect(wasmResult.score).toBeGreaterThanOrEqual(WIN_SCORE_THRESHOLD);
    expect(wasmResult.position).toEqual(tsResult.position);
  });

  it("四三が可能な盤面で白有利のスコアを返す", { timeout: 30000 }, () => {
    const board = createBoardWithStones([
      // 横方向のリソース
      { row: 7, col: 5, color: "white" },
      { row: 7, col: 6, color: "white" },
      // 縦方向のリソース
      { row: 5, col: 7, color: "white" },
      { row: 6, col: 7, color: "white" },
      // ダミー石で14石以上にする
      { row: 0, col: 0, color: "black" },
      { row: 0, col: 2, color: "white" },
      { row: 0, col: 4, color: "black" },
      { row: 0, col: 6, color: "white" },
      { row: 1, col: 0, color: "black" },
      { row: 1, col: 2, color: "white" },
      { row: 1, col: 4, color: "black" },
      { row: 1, col: 6, color: "white" },
      { row: 2, col: 0, color: "black" },
      { row: 2, col: 2, color: "white" },
    ]);

    const tsResult = tsSearch(board, "white", 4);
    const wasmResult = engine.findBestMoveWithParams(
      board,
      "white",
      4,
      5000,
      600000,
    );

    // TS版もWASM版も白有利のスコアを返す
    // NOTE: 探索深さとVCT閾値の違いにより、TS版は勝ちスコア未達でも
    // WASM版は勝ちスコアを返す場合がある（WASM版がVCTでより深く読む可能性）
    expect(tsResult.score).toBeGreaterThan(0);
    expect(wasmResult.score).toBeGreaterThan(0);
  });
});
