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
  type HangDumpJsonV1,
  type HangDumpJsonV2,
  type HangDumpMatch,
  type HangDumpSideConfig,
  isHangDumpV2,
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
      timeLimit: 10000,
      maxNodes: 1000000,
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
        interrupted: true,
        thinkingTimeMs: 29600,
        roundTripMs: 29650,
        stats: { nodes: 987654 },
      },
    ],
    recentGames: [
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
    ],
  },
  liveness: {
    timeCheckCount: 918273,
    lastTimeCheckAt: "2026-08-23T00:00:29.000Z",
    msSinceLastTimeCheck: 12,
    requestId: 265,
    timeCheckDeltaDuringSample: 4211,
    sampleWindowMs: 250,
    verdict: "searching",
  },
  mainThread: {
    running: true,
    intervalMs: 1000,
    samples: [
      { at: "2026-08-23T00:00:00.000Z", timerLagMs: 3, clockSkewMs: 0 },
    ],
    maxTimerLagMs: 3,
    maxClockSkewJumpMs: 0,
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

function writeAndRead(ctx: HangContext = context()): {
  outPath: string;
  dump: HangDumpJsonV2;
} {
  const outputDir = path.join(makeTmpDir(), "hang-dumps");
  const outPath = writeHangDump({
    outputDir,
    context: ctx,
    match,
    bench,
    workerConfigs,
  });
  return {
    outPath,
    dump: JSON.parse(fs.readFileSync(outPath, "utf-8")) as HangDumpJsonV2,
  };
}

describe("isHangDumpV2", () => {
  it("v2 なら true", () => {
    const { dump } = writeAndRead();
    expect(isHangDumpV2(dump)).toBe(true);
  });

  it("v1 ダンプ（ディスクに残る実データ）は false", () => {
    const v1 = { schemaVersion: 1 } as HangDumpJsonV1 as HangDumpJson;
    expect(isHangDumpV2(v1)).toBe(false);
  });
});

describe("writeHangDump", () => {
  it("出力ディレクトリが無ければ作り、hang-<iso>-g<idx>.json に書く", () => {
    const { outPath } = writeAndRead();
    expect(fs.existsSync(outPath)).toBe(true);
    expect(path.basename(outPath)).toMatch(/^hang-.+-g3\.json$/);
  });

  it("schemaVersion は 2（#128 で telemetry/liveness/recentGames を追加）", () => {
    const { dump } = writeAndRead();
    expect(dump.schemaVersion).toBe(HANG_DUMP_SCHEMA_VERSION);
    expect(dump.schemaVersion).toBe(2);
  });

  it("ハングした側の worker 設定と telemetry を載せる", () => {
    const { dump } = writeAndRead();
    expect(dump.worker.side).toBe("A");
    expect(dump.worker.commit.shortSha).toBe("aaaaaaa");
    expect(dump.worker.telemetry.requestCount).toBe(42);
    expect(dump.worker.telemetry.engineParams?.maxNodes).toBe(1000000);
    expect(dump.worker.telemetry.pendingRequest?.moveSeed).toBe(12345);
    expect(dump.worker.telemetry.recentMoves[0]?.stats?.nodes).toBe(987654);
  });

  it("interrupted を保持する（長考が打ち切られたかの判別）", () => {
    const { dump } = writeAndRead();
    expect(dump.worker.telemetry.recentMoves[0]?.interrupted).toBe(true);
  });

  it("生存信号（liveness）を載せる", () => {
    const { dump } = writeAndRead();
    expect(dump.hang.liveness.verdict).toBe("searching");
    expect(dump.hang.liveness.timeCheckDeltaDuringSample).toBe(4211);
  });

  it("メインスレッドのイベントループ状態を載せる", () => {
    const { dump } = writeAndRead();
    expect(dump.hang.mainThread.running).toBe(true);
    expect(dump.hang.mainThread.maxTimerLagMs).toBe(3);
  });

  it("recentGames は telemetry から取る（SSoT）", () => {
    const { dump } = writeAndRead();
    expect(dump.recentGames).toEqual(context().telemetry.recentGames);
  });

  it("telemetry に直近局が無ければ空配列", () => {
    const ctx = context();
    ctx.telemetry.recentGames = [];
    const { dump } = writeAndRead(ctx);
    expect(dump.recentGames).toEqual([]);
  });

  it("相手側は opponent に入る", () => {
    const { dump } = writeAndRead();
    expect(dump.opponent.side).toBe("B");
    expect(dump.opponent.commit.shortSha).toBe("bbbbbbb");
  });

  it("何が取れて何が取れないかを notes に残す", () => {
    const { dump } = writeAndRead();
    expect(dump.notes.length).toBeGreaterThan(0);
    expect(dump.notes.join("\n")).toContain("liveness");
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
