import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { BoardState } from "../../src/types/game.ts";
import type { HangContext } from "../commit-game-runner.ts";

import {
  HANG_DUMP_SCHEMA_VERSION,
  type HangDumpBench,
  type HangDumpJson,
  type HangDumpMatch,
  type HangDumpSideConfig,
  hangSideColor,
  writeHangDump,
} from "./hangDump.ts";

const tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hang-dump-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const emptyBoard = (): BoardState =>
  Array.from({ length: 15 }, () => Array.from({ length: 15 }, () => null));

const context = (): HangContext => ({
  requestId: 265,
  timeoutMs: 30000,
  side: "A",
  color: "white",
  board: emptyBoard(),
  moveHistory: [
    { row: 7, col: 7, time: 0, isOpening: true },
    { row: 6, col: 8, time: 0, isOpening: true },
    { row: 9, col: 7, time: 0, isOpening: true },
  ],
  elapsedMs: 293418,
  moveNumber: 4,
  telemetry: {
    requestCount: 42,
    engineParams: {
      worktreePath: "/tmp/A-480f4f4",
      difficulty: "hard",
      depth: 12,
      timeLimit: 5000,
      maxNodes: 3000000,
      randomFactor: 0.02,
      evaluationOptions: { evalBasis: "prospect" },
      engine: "wasm",
      bookEnabled: false,
      hasStatsBuffer: true,
      threatProbe: "ON(default)",
    },
    pendingRequest: {
      requestId: 265,
      gameIdx: 3,
      moveNumber: 4,
      color: "white",
      nonOpeningOrdinal: 1,
      moveSeed: 12345,
      sentAt: "2026-08-23T00:00:00.000Z",
    },
    recentMoves: [
      {
        requestId: 264,
        gameIdx: 3,
        moveNumber: 2,
        color: "white",
        depth: 6,
        score: 40,
        thinkingTimeMs: 4900,
        roundTripMs: 4950,
        stats: { nodes: 987654 },
      },
    ],
  },
});

const match: HangDumpMatch = {
  gameIdx: 3,
  jushuName: "峡月",
  isABlack: false,
  pairIdx: 3,
  gameSeed: 319205941,
};

const bench: HangDumpBench = {
  tool: "commit-bench",
  difficulty: "hard",
  randomFactor: 0.02,
  moveTimeoutMs: 30000,
  jobs: 5,
  baseSeed: 20260825,
};

const sideConfig = (label: string): HangDumpSideConfig => ({
  worktreePath: `/tmp/${label}`,
  evaluationOptions: undefined,
  bookEnabled: false,
  commit: {
    sha: `${label}0000000000000000000000000000000000`,
    shortSha: label,
    message: `commit ${label}`,
    date: "2026-08-23 01:13:47 +0900",
  },
});

const workerConfigs = { A: sideConfig("aaaaaaa"), B: sideConfig("bbbbbbb") };

function writeAndRead(
  overrides: Partial<Parameters<typeof writeHangDump>[0]> = {},
): { outPath: string; dump: HangDumpJson } {
  const outputDir = path.join(makeTmpDir(), "hang-dumps");
  const outPath = writeHangDump({
    outputDir,
    context: context(),
    match,
    bench,
    workerConfigs,
    ...overrides,
  });
  return {
    outPath,
    dump: JSON.parse(fs.readFileSync(outPath, "utf-8")) as HangDumpJson,
  };
}

describe("hangSideColor", () => {
  it("A側は isABlack のとき黒", () => {
    expect(hangSideColor("A", true)).toBe("black");
  });
  it("A側は isABlack が false なら白", () => {
    expect(hangSideColor("A", false)).toBe("white");
  });
  it("B側は isABlack のとき白", () => {
    expect(hangSideColor("B", true)).toBe("white");
  });
  it("B側は isABlack が false なら黒", () => {
    expect(hangSideColor("B", false)).toBe("black");
  });
});

describe("writeHangDump", () => {
  it("出力ディレクトリが無ければ作り、hang-<iso>-g<idx>.json に書く", () => {
    const { outPath } = writeAndRead();
    expect(fs.existsSync(outPath)).toBe(true);
    expect(path.basename(outPath)).toMatch(/^hang-.+-g3\.json$/);
  });

  it("schemaVersion は 2（#128 で telemetry/recentGames を追加）", () => {
    const { dump } = writeAndRead();
    expect(dump.schemaVersion).toBe(HANG_DUMP_SCHEMA_VERSION);
    expect(dump.schemaVersion).toBe(2);
  });

  it("ハングした側の worker 設定と telemetry を載せる", () => {
    const { dump } = writeAndRead();
    expect(dump.worker.side).toBe("A");
    expect(dump.worker.commit.shortSha).toBe("aaaaaaa");
    expect(dump.worker.telemetry?.requestCount).toBe(42);
    expect(dump.worker.telemetry?.engineParams?.maxNodes).toBe(3000000);
    expect(dump.worker.telemetry?.pendingRequest?.moveSeed).toBe(12345);
    expect(dump.worker.telemetry?.recentMoves[0]?.stats?.nodes).toBe(987654);
  });

  it("相手側は opponent に入る", () => {
    const { dump } = writeAndRead();
    expect(dump.opponent.side).toBe("B");
    expect(dump.opponent.commit.shortSha).toBe("bbbbbbb");
  });

  it("recentGames 未指定なら空配列", () => {
    const { dump } = writeAndRead();
    expect(dump.recentGames).toEqual([]);
  });

  it("recentGames はそのまま保存される（replay-history の入力）", () => {
    const recentGames = [
      {
        gameIdx: 1,
        jushuName: "寒星",
        isABlack: true,
        gameSeed: 111,
        moves: [
          { row: 7, col: 7, isOpening: true },
          { row: 6, col: 8, isOpening: true },
          { row: 9, col: 7, isOpening: true },
          { row: 6, col: 6, isOpening: false },
        ],
      },
    ];
    const { dump } = writeAndRead({ recentGames });
    expect(dump.recentGames).toEqual(recentGames);
  });

  it("wasm live stats が取れない理由を notes に残す", () => {
    const { dump } = writeAndRead();
    expect(dump.notes?.length).toBeGreaterThan(0);
    expect(dump.notes?.[0]).toContain("wasm");
  });

  it("盤面・着手履歴・ハング情報を保持する", () => {
    const { dump } = writeAndRead();
    expect(dump.type).toBe("hang-dump");
    expect(dump.board).toHaveLength(15);
    expect(dump.moveHistory).toHaveLength(3);
    expect(dump.hang.moveNumber).toBe(4);
    expect(dump.match.gameSeed).toBe(319205941);
    expect(dump.bench.baseSeed).toBe(20260825);
  });
});
