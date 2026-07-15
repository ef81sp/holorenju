/**
 * 攻め側フィルタ（脅威プレフィルタ・候補スコア上位・ランダム枠）のテスト。
 *
 * E2E アドミッションテスト（opening-trap-mining-2026-07-16.md §7 issue blocker
 * 反映・go/no-go ゲート）: ボス実戦ライン（雲月 → 白4 → H7 → 白6 → I7）の
 * 黒手2つが攻め側フィルタ（脅威プレフィルタ）を通ることを機械的に固定する。
 * 通らなければ設計に反するため、このテストが red のまま実装を進めてはならない。
 */
import { describe, expect, it } from "vitest";

import type { Position } from "@/types/game";

import { createBoardFromRecord } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import { passesThreatPrefilter, selectAttackerMoves } from "./trapFilters";

describe("passesThreatPrefilter — E2E アドミッション（go/no-go ゲート）", () => {
  it("黒5=H7（H8 I9 I8 G8 の後）は脅威プレフィルタを通る", () => {
    // H8(天元)黒・I9白・I8黒・G8白 の4手局面、次は黒5手目
    const { board, nextColor } = createBoardFromRecord("H8 I9 I8 G8");
    expect(nextColor).toBe("black");
    const h7: Position = { row: 8, col: 7 }; // H7
    expect(passesThreatPrefilter(board, h7, "black")).toBe(true);
  });

  it("黒7=I7（H8 I9 I8 G8 H7 G6 の後）は脅威プレフィルタを通る", () => {
    const { board, nextColor } = createBoardFromRecord("H8 I9 I8 G8 H7 G6");
    expect(nextColor).toBe("black");
    const i7: Position = { row: 8, col: 8 }; // I7
    expect(passesThreatPrefilter(board, i7, "black")).toBe(true);
  });

  it("明白な非脅威手（孤立した遠方の手）は黒5局面で落ちる", () => {
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    const farCorner: Position = { row: 0, col: 0 }; // A15、他の石から遠く孤立
    expect(passesThreatPrefilter(board, farCorner, "black")).toBe(false);
  });

  it("明白な非脅威手（孤立した遠方の手）は黒7局面で落ちる", () => {
    const { board } = createBoardFromRecord("H8 I9 I8 G8 H7 G6");
    const farCorner: Position = { row: 14, col: 14 }; // O1、他の石から遠く孤立
    expect(passesThreatPrefilter(board, farCorner, "black")).toBe(false);
  });
});

describe("selectAttackerMoves", () => {
  it("脅威プレフィルタ通過手と候補スコア上位手を重複なく統合する", () => {
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    const h7: Position = { row: 8, col: 7 };
    const candidates: Position[] = [
      h7, // 脅威プレフィルタにも候補にも入る（重複除去確認）
      { row: 0, col: 5 },
    ];
    const result = selectAttackerMoves({
      board,
      color: "black",
      candidates,
      topK: 2,
      maxTotal: 20,
      randomSlotCount: 0,
      randomSeed: 1,
    });
    const positions = result.map((r) => `${r.position.row},${r.position.col}`);
    expect(new Set(positions).size).toBe(positions.length); // 重複なし

    const h7Entry = result.find(
      (r) => r.position.row === 8 && r.position.col === 7,
    );
    expect(h7Entry?.provenance.threatPrefilter).toBe(true);
    expect(h7Entry?.provenance.topKCandidate).toBe(true);
  });

  it("maxTotal で出力件数をキャップする", () => {
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    const result = selectAttackerMoves({
      board,
      color: "black",
      candidates: [],
      topK: 0,
      maxTotal: 3,
      randomSlotCount: 10,
      randomSeed: 42,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("同一シードなら決定的に同じランダム枠を返す", () => {
    const { board } = createBoardFromRecord("H8 I9 I8 G8");
    const params = {
      board,
      color: "black" as const,
      candidates: [],
      topK: 0,
      maxTotal: 50,
      randomSlotCount: 5,
      randomSeed: 777,
    };
    const a = selectAttackerMoves(params);
    const b = selectAttackerMoves(params);
    expect(a.map((r) => r.position)).toEqual(b.map((r) => r.position));
  });

  it("provenance が randomSlot のみの手を含む（脅威にも候補にも含まれない）", () => {
    // 空盤面: 自石が存在しないため脅威プレフィルタは全マスで false になる
    const board = createEmptyBoard();
    const result = selectAttackerMoves({
      board,
      color: "black",
      candidates: [],
      topK: 0,
      maxTotal: 50,
      randomSlotCount: 5,
      randomSeed: 5,
    });
    expect(result.length).toBeGreaterThan(0);
    for (const r of result) {
      expect(r.provenance.threatPrefilter).toBe(false);
      expect(r.provenance.topKCandidate).toBe(false);
      expect(r.provenance.randomSlot).toBe(true);
    }
  });
});
