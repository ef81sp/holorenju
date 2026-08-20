/**
 * VCT 探索が「長連にしかならない跳び四」を本物の四として扱う問題の回帰テスト
 *
 * 背景（GitHub issue #115「長連を含む追い詰めを提案される」）:
 * 黒の跳び四は、ギャップを埋めると 6 連（長連）になる場合は五にできないので四ではない。
 * `classifyThreat` / `checkDefenseCounterThreat` / `createsFour` は
 * `isJumpFourOverline` で補正していたが、受け点を返す
 * `getThreatDefensePositions`（zig/src/vct.zig）の跳び四ブランチだけ補正が無かった。
 *
 * その結果、三でしかない攻め手に対して「跳び四のギャップ 1 点」だけが受けとして
 * 列挙され、受け側の正当な他の受けが探索木から消えて偽の追い詰めが成立していた。
 *
 * 実例（左下原点・黒先手）: 下記棋譜の 14 石局面で黒の VCT 手順として
 * 15.L7 16.M6 17.L8 18.L6 19.J7 20.M10 21.J8 22.I8 … が返っていた。
 * 21.J8 時点の 8 行目は G8 H8 _ J8 K8 L8 で、ギャップ I8 は黒が打つと長連。
 * `classifyThreat(J8)` は four=false/three=true と正しいのに、受けだけ I8 の
 * 1 点強制になっていた（分類と受け点で基準が食い違っていた）。
 *
 * 修正: 跳び四ブランチにも `isJumpFourOverline` ガードを入れ、他 3 箇所と同基準にした。
 */

import { describe, expect, it } from "vitest";

import type { BoardState, Position, StoneColor } from "@/types/game";
import type { ForcedWinNode } from "@/types/review";

import { createBoardFromRecord, formatMove } from "@/logic/gameRecordParser";

import { loadWasmModule } from "../wasm/loader";
import { WasmSearchEngine } from "../wasm/searchEngine";
import { classifyThreat, preloadThreatWasm } from "../wasm/threatAdapter";
import { detectForcedWin } from "./forcedWinDetection";

/** 実戦棋譜。先頭 14 手が問題の局面（黒 15 手目の直前） */
const RECORD =
  "H8 H7 G8 G9 I10 H9 J9 J10 K8 H11 L9 K9 I11 I9 I12 K10 L10 L8 K11 I13 L11 M10 M9 N8 J12 L12 H12 G12 F9 F8 G7 F11 H13 I8 G10 E7 D6 D8 F6 G6 F5 E5 E8 C7 G4 D7 B7 C8 C9 D9 E10 D11 D10 C10 B9 G11 E11 E9 F10 B6 A5 F12 E13 J8";

const engine = new WasmSearchEngine(await loadWasmModule());
await preloadThreatWasm();

function setStone(
  board: BoardState,
  pos: Position,
  color: StoneColor | null,
): void {
  const row = board[pos.row];
  if (row) {
    row[pos.col] = color;
  }
}

/**
 * 詰み木を全経路たどり、攻め手ノードの「受けが 1 点だけ」の主張を検証する。
 *
 * 受けを 1 点に強制できるのは四（止め四 / 跳び四）だけ。三で受けが 1 点になることは
 * 無いので、`defenses.length === 1` なのに `createsFour === false` なら
 * 受け点の列挙が分類より強い主張をしている＝ issue #115 と同型の不整合。
 */
function collectForcedDefenseMismatches(
  node: ForcedWinNode | undefined,
  board: BoardState,
  attacker: StoneColor,
  ply: number,
  path: string[],
  out: string[],
): void {
  if (!node) {
    return;
  }
  const move = node.attackerMove;
  setStone(board, move, attacker);
  const line = [...path, `${ply}.${formatMove(move)}`];

  if (node.defenses.length === 1) {
    const { createsFour } = classifyThreat(board, move.row, move.col, attacker);
    if (!createsFour) {
      const [defense] = node.defenses;
      out.push(
        `${line.join(" ")} は四ではないのに受けが ${
          defense ? formatMove(defense.defenderMove) : "?"
        } の 1 点に強制されている`,
      );
    }
  }

  const defender: StoneColor = attacker === "black" ? "white" : "black";
  for (const defense of node.defenses) {
    setStone(board, defense.defenderMove, defender);
    collectForcedDefenseMismatches(
      defense.next,
      board,
      attacker,
      ply + 2,
      [...line, `${ply + 1}.${formatMove(defense.defenderMove)}`],
      out,
    );
    setStone(board, defense.defenderMove, null);
  }

  setStone(board, move, null);
}

describe("VCT: 長連にしかならない跳び四で受けを1点に絞らない（issue #115）", () => {
  it("14 石局面の黒 VCT 手順に長連前提の強制受けが現れない", () => {
    const { board } = createBoardFromRecord(RECORD, 14);
    const result = detectForcedWin(board, "black", false, false, engine);

    // この局面自体には黒の追い詰めがある（修正で消えるのは偽手順の方だけ）
    expect(result.forcedWinType).toBe("vct");
    expect(result.forcedWin).not.toBeNull();
    expect(formatMove(result.forcedWin!.firstMove)).toBe("L7");

    const mismatches: string[] = [];
    collectForcedDefenseMismatches(
      result.forcedWin?.tree,
      board,
      "black",
      15,
      [],
      mismatches,
    );
    expect(mismatches).toEqual([]);
  }, 300_000);
});
