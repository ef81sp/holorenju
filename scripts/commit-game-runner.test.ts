/**
 * runCommitGame の開局配置（openingMoves の一般化）を、bridge worker を起動せずに
 * 偽 worker（EventEmitter + postMessage）で固定する。
import type { Worker } from "node:worker_threads";

 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import type { BoardState, Position } from "../src/types/game.ts";

import { parseMove } from "../src/logic/gameRecordParser.ts";
import { runCommitGame } from "./commit-game-runner.ts";

interface SeenRequest {
  color: "black" | "white";
  stones: number;
}

/** 与えた手を順に返す偽 worker。要求ごとに手番色と石数を記録する。 */
class FakeWorker extends EventEmitter {
  readonly seen: SeenRequest[] = [];
  private next = 0;

  constructor(private readonly replies: Position[]) {
    super();
  }

  postMessage(msg: {
    requestId: number;
    board: BoardState;
    color: "black" | "white";
  }): void {
    const stones = msg.board.flat().filter((c) => c !== null).length;
    this.seen.push({ color: msg.color, stones });
    const position = this.replies[this.next++];
    if (!position) {
      throw new Error("偽 worker の応答が尽きた");
    }
    setImmediate(() => {
      this.emit("message", {
        requestId: msg.requestId,
        position,
        score: 0,
        depth: 1,
        thinkingTimeMs: 1,
        interrupted: false,
      });
    });
  }
}

const asWorker = (w: FakeWorker): Worker => w as unknown as Worker;
const moves = (s: string): Position[] => s.split(" ").map(parseMove);

describe("runCommitGame openingMoves", () => {
  it("7 手開局（黒 4・白 3）を黒から交互に置き、白番から探索が始まる", async () => {
    // 黒: H8 A1 A3 A5 / 白: B2 C2 D2（横三）。白 E2→四、黒は受けず、白 F2 で五。
    const opening = moves("H8 B2 A1 C2 A3 D2 A5");
    const white = new FakeWorker(moves("E2 F2"));
    const black = new FakeWorker(moves("A9"));

    // A=黒（black worker）, B=白
    const result = await runCommitGame(asWorker(black), asWorker(white), true, {
      openingMoves: opening,
      moveTimeoutMs: 5000,
    });

    expect(white.seen[0]).toEqual({ color: "white", stones: 7 });
    expect(black.seen[0]).toEqual({ color: "black", stones: 8 });
    expect(result.winner).toBe("B");
    expect(result.reason).toBe("five");
    expect(result.moveHistory.slice(0, 7).every((m) => m.isOpening)).toBe(true);
    expect(result.moveHistory.slice(7).every((m) => !m.isOpening)).toBe(true);
    expect(result.moves).toBe(10);
  });

  it("3 手開局（珠型）は従来どおり白番から始まる", async () => {
    const opening = moves("H8 I9 G7");
    const white = new FakeWorker(moves("B2 C2 D2 E2 F2"));
    const black = new FakeWorker(moves("A1 A3 A5 A7"));
    const result = await runCommitGame(asWorker(black), asWorker(white), true, {
      openingMoves: opening,
      moveTimeoutMs: 5000,
    });
    expect(white.seen[0]).toEqual({ color: "white", stones: 3 });
    expect(result.winner).toBe("B");
    expect(result.moveHistory.filter((m) => m.isOpening)).toHaveLength(3);
  });

  it("偶数手開局なら黒番から始まる", async () => {
    const opening = moves("H8 I9");
    const black = new FakeWorker(moves("A1 A2 A3 A4 A5"));
    const white = new FakeWorker(moves("O1 O2 O3 O4"));
    const result = await runCommitGame(asWorker(black), asWorker(white), true, {
      openingMoves: opening,
      moveTimeoutMs: 5000,
    });
    expect(black.seen[0]).toEqual({ color: "black", stones: 2 });
    expect(result.winner).toBe("A");
    expect(result.reason).toBe("five");
  });
});
