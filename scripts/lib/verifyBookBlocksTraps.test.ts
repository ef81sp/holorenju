/**
 * ゲート1（opening-book-2026-07-16.md §5-1）: severity-A レコードの黒手順を
 * ブック有効経路でなぞり、全件で強制勝ち不成立を検証するロジックのテスト。
 *
 * 実エンジン（WASM VCF/VCT探索）は使わず、BookLookup/ForcedWinChecker を
 * フェイクに差し替えてブランチ列挙・判定ロジックだけを検証する。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { BoardState } from "@/types/game";

import { canonicalKey } from "@/logic/boardSymmetry";
import {
  getBookMoveCandidates,
  setOpeningBookAsset,
} from "@/logic/cpu/openingBook";
import {
  createBoardFromRecord,
  formatMove,
  parseMove,
} from "@/logic/gameRecordParser";

import { buildOpeningBookEntries, parseDumpJsonl } from "./buildOpeningBook";
import {
  verifyRecordBlocked,
  type BookLookup,
  type ForcedWinChecker,
  type TrapRecordForVerify,
} from "./verifyBookBlocksTraps";

/** 黒1天元・白2・黒3・白4・黒5・白6・黒7（7手）の記録。 */
const RECORD_MOVES = ["H8", "I9", "I8", "J8", "H9", "H10", "G11"] as const;

/** RECORD_MOVES を実際に盤面へ再現して真の canonicalKey（ply8局面）を計算する。 */
function realCanonicalKeyPly8(): string {
  const { board } = createBoardFromRecord(RECORD_MOVES.join(" "));
  return canonicalKey(board, "white");
}

function makeRecord(
  overrides: Partial<TrapRecordForVerify> = {},
): TrapRecordForVerify {
  return {
    route: "雲月",
    canonicalKeyPly8: realCanonicalKeyPly8(),
    moves: [...RECORD_MOVES],
    ...overrides,
  };
}

/** board の署名 = 石の数（このテストの範囲では手順ごとに一意）。 */
function stoneCountKey(board: BoardState): string {
  let n = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell !== null) {
        n++;
      }
    }
  }
  return `n${n}`;
}

function fakeBook(entries: Record<string, string[]>): BookLookup {
  return {
    candidateMoves(board) {
      return entries[stoneCountKey(board)] ?? null;
    },
  };
}

/** checker: 指定した手ごとに強制勝ちの有無を固定するフェイク。 */
function fakeChecker(
  resultByMove: Record<string, "VCF" | "VCT" | null>,
): ForcedWinChecker {
  return {
    check(_board, _sideToMove, move) {
      const key = `${move.row},${move.col}`;
      return resultByMove[key] ?? null;
    },
  };
}

function keyForMove(moveStr: string): string {
  const p = parseMove(moveStr);
  return `${p.row},${p.col}`;
}

describe("verifyRecordBlocked", () => {
  it("ply8にブックのエントリが無い場合、bookMissingAtPly8=trueで検証不能として blocked=false", () => {
    const book = fakeBook({}); // 常にヒットなし
    const checker = fakeChecker({});
    const result = verifyRecordBlocked(makeRecord(), book, checker);
    expect(result.blocked).toBe(false);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]?.bookMissingAtPly8).toBe(true);
    expect(result.branches[0]?.diverged).toBe(false);
  });

  it("ply8にブックの既定手があり、それが強制勝ちを許さなければ blocked=true", () => {
    const book = fakeBook({ n7: ["F11"] });
    const checker = fakeChecker({}); // 全て null（強制勝ちなし）
    const result = verifyRecordBlocked(makeRecord(), book, checker);
    expect(result.blocked).toBe(true);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]?.white8).toBe("F11");
    expect(result.branches[0]?.forcedWinKind).toBeNull();
  });

  it("ply8にrandomPoolがあり、全候補が安全なら blocked=true（全候補を検証）", () => {
    const book = fakeBook({ n7: ["F11", "E12", "D13"] });
    const checker = fakeChecker({}); // 全て安全
    const result = verifyRecordBlocked(makeRecord(), book, checker);
    expect(result.blocked).toBe(true);
    expect(result.branches).toHaveLength(3);
    expect(result.branches.map((b) => b.white8).sort()).toEqual([
      "D13",
      "E12",
      "F11",
    ]);
  });

  it("randomPoolのうち1つでも強制勝ちを許せば blocked=false（その分岐を特定できる）", () => {
    const book = fakeBook({ n7: ["F11", "E12"] });
    const checker = fakeChecker({
      [keyForMove("E12")]: "VCF", // E12 だけ危険
    });
    const result = verifyRecordBlocked(makeRecord(), book, checker);
    expect(result.blocked).toBe(false);
    const badBranch = result.branches.find((b) => b.white8 === "E12");
    expect(badBranch?.forcedWinKind).toBe("VCF");
    expect(badBranch?.blocked).toBe(false);
    const goodBranch = result.branches.find((b) => b.white8 === "F11");
    expect(goodBranch?.blocked).toBe(true);
  });

  it("white4でブックが記録と異なる手を選ぶと、記録のply8局面から外れて diverged=true・blocked=true になる", () => {
    // white4のみブックが介入（記録のJ8ではなくK8）。以降は別局面になるため
    // 記録のcanonicalKeyPly8には到達しない。
    const book = fakeBook({ n3: ["K8"] });
    const checker = fakeChecker({});
    const result = verifyRecordBlocked(makeRecord(), book, checker);
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]?.diverged).toBe(true);
    expect(result.branches[0]?.blocked).toBe(true);
    expect(result.branches[0]?.white8).toBeNull();
    expect(result.branches[0]?.bookMissingAtPly8).toBe(false);
  });

  it("white4のrandomPoolが複数あり、一部が記録と一致・一部が乖離する場合、それぞれ独立して分岐する", () => {
    // white4: J8(記録と一致) と K8(乖離) の2択
    const book = fakeBook({ n3: ["J8", "K8"], n7: ["F11"] });
    const checker = fakeChecker({});
    const result = verifyRecordBlocked(makeRecord(), book, checker);
    expect(result.branches).toHaveLength(2);
    const matched = result.branches.find((b) => b.white4 === "J8");
    const diverged = result.branches.find((b) => b.white4 === "K8");
    expect(matched?.diverged).toBe(false);
    expect(matched?.white8).toBe("F11");
    expect(diverged?.diverged).toBe(true);
    expect(diverged?.white8).toBeNull();
    expect(result.blocked).toBe(true);
  });
});

describe("実データフィクスチャ（scripts/lib/__fixtures__/opening-book/）による統合確認", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixtureDir = path.join(__dirname, "__fixtures__/opening-book");

  interface FixtureSeverityARecord {
    canonicalKeyPly8: string;
    route: string;
    moves: string[];
  }

  it("フィクスチャダンプから構築したブックで、対応するseverity-Aレコードを封鎖できる", () => {
    const dumpText = readFileSync(path.join(fixtureDir, "dump.jsonl"), "utf-8");
    const { nodes } = parseDumpJsonl(dumpText);
    const { entries } = buildOpeningBookEntries(nodes);
    setOpeningBookAsset({ entries });

    const severityALines = readFileSync(
      path.join(fixtureDir, "severity-a.jsonl"),
      "utf-8",
    )
      .split("\n")
      .filter((line) => line.trim().length > 0);
    const records = severityALines.map(
      (line) => JSON.parse(line) as FixtureSeverityARecord,
    );
    expect(records.length).toBeGreaterThan(0);

    // 本番の verify-book-blocks-traps.ts と同じ実装（getBookMoveCandidates）を
    // BookLookup として使う。ForcedWinChecker だけはフェイク（常に安全）にする
    // ——採掘プロセス自体が生存手を VCF/VCT 検証済みのため、ここでの目的は
    // 「実データの canonicalKey/変換パイプラインで正しくヒットするか」の確認。
    const book: BookLookup = {
      candidateMoves(board) {
        const candidates = getBookMoveCandidates(board, "white");
        return candidates ? candidates.map(formatMove) : null;
      },
    };
    const checker: ForcedWinChecker = { check: () => null };

    for (const record of records) {
      const verifyRecord: TrapRecordForVerify = {
        route: record.route,
        canonicalKeyPly8: record.canonicalKeyPly8,
        moves: record.moves,
      };
      const result = verifyRecordBlocked(verifyRecord, book, checker);
      // bookMissingAtPly8 が発生しないこと（=このレコードのply8局面が
      // 実際にブックへ収録されている）が、実データでの配線確認の核心。
      const missing = result.branches.some((b) => b.bookMissingAtPly8);
      expect(missing).toBe(false);
      expect(result.blocked).toBe(true);
    }

    setOpeningBookAsset(null);
  });
});
