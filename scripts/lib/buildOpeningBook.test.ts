/**
 * --dump-book JSONL → オープニングブック資産（opening-book-hard.json）の
 * ビルドロジック（opening-book-2026-07-16.md §2）のテスト。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canonicalKeyWithTransform } from "@/logic/boardSymmetry";
import { createBoardFromRecord } from "@/logic/gameRecordParser";

import type { BookDumpMetadata } from "./bookDumpMetadata";
import type { BookDumpNode } from "./trapPipeline";

import {
  assertHardMoveInvariant,
  buildOpeningBookAsset,
  buildOpeningBookEntries,
  findConsistentTransform,
  mergeNodesByCanonicalKey,
  nodeToCanonicalEntry,
  parseDumpJsonl,
  reconstructNodeBoard,
  resolveCanonicalEntry,
} from "./buildOpeningBook";

function plainNode(overrides: Partial<BookDumpNode> = {}): BookDumpNode {
  return {
    canonicalKey: "",
    route: "雲月",
    ply: 4,
    movesUpToHere: ["H8", "I9", "I8"],
    hardMove: "J8",
    forcedWinKind: null,
    forcedWinSequenceStr: null,
    survivorMoves: null,
    ...overrides,
  };
}

/** movesUpToHere を実際に盤面へ再現し、正しい canonicalKey を計算して埋める。 */
function withRealCanonicalKey(node: BookDumpNode): BookDumpNode {
  const { board } = createBoardFromRecord(node.movesUpToHere.join(" "));
  return {
    ...node,
    canonicalKey: canonicalKeyWithTransform(board, "white").key,
  };
}

describe("parseDumpJsonl", () => {
  it("メタデータ行とノード行を分離してパースする", () => {
    const metadata: BookDumpMetadata = {
      type: "metadata",
      timestamp: "2026-07-16T00:00:00.000Z",
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 1,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
    };
    const node = plainNode();
    const text = `${JSON.stringify(metadata)}\n${JSON.stringify(node)}\n`;

    const result = parseDumpJsonl(text);
    expect(result.metadata).toEqual(metadata);
    expect(result.nodes).toEqual([node]);
  });

  it("空行を無視する", () => {
    const metadata: BookDumpMetadata = {
      type: "metadata",
      timestamp: "t",
      gitRev: "g",
      wasmBuildTime: "w",
      seed: 1,
      roots: null,
      b5: 1,
      b7: 1,
      hardTimeMs: null,
    };
    const text = `${JSON.stringify(metadata)}\n\n${JSON.stringify(plainNode())}\n\n`;
    const result = parseDumpJsonl(text);
    expect(result.nodes).toHaveLength(1);
  });

  it("メタデータ行が無ければエラーを投げる", () => {
    expect(() => parseDumpJsonl(`${JSON.stringify(plainNode())}\n`)).toThrow();
  });
});

describe("reconstructNodeBoard / findConsistentTransform", () => {
  it("movesUpToHere が完全な場合、正しい変換を一意に特定する", () => {
    const node = withRealCanonicalKey(plainNode());
    const board = reconstructNodeBoard(node);
    const transformName = findConsistentTransform(board, node.canonicalKey);
    expect(transformName).not.toBeNull();

    // 見つけた変換で盤面を canonical 化すると、記録された canonicalKey と完全一致する
    const { key } = canonicalKeyWithTransform(board, "white");
    expect(key).toBe(node.canonicalKey);
  });

  it("movesUpToHere が1手欠けていても（ply8の既知の欠損）矛盾なく変換を特定できる", () => {
    // 完全な7手局面から正しい canonicalKey を計算した後、
    // movesUpToHere からは最後の1手（黒7相当）を落とす。
    const fullMoves = ["H8", "I9", "I8", "J8", "H9", "H10", "G11"];
    const { board: fullBoard } = createBoardFromRecord(fullMoves.join(" "));
    const trueCanonicalKey = canonicalKeyWithTransform(fullBoard, "white").key;

    const degenerateNode: BookDumpNode = {
      canonicalKey: trueCanonicalKey,
      route: "雲月",
      ply: 8,
      movesUpToHere: fullMoves.slice(0, 6), // 黒7 (G11) を欠落させる
      hardMove: "F11",
      forcedWinKind: null,
      forcedWinSequenceStr: null,
      survivorMoves: null,
    };

    const partialBoard = reconstructNodeBoard(degenerateNode);
    const transformName = findConsistentTransform(
      partialBoard,
      degenerateNode.canonicalKey,
    );
    expect(transformName).not.toBeNull();
  });

  it("canonicalKey が盤面と矛盾する場合は null を返す（安全側フォールバック）", () => {
    const node = withRealCanonicalKey(plainNode());
    const board = reconstructNodeBoard(node);
    const bogusKey = `${"B".repeat(225)}|white`;
    expect(findConsistentTransform(board, bogusKey)).toBeNull();
  });
});

describe("nodeToCanonicalEntry", () => {
  it("通常ノード（トラップなし）: hardMove を canonical 空間に変換したエントリを返す", () => {
    const node = withRealCanonicalKey(plainNode({ hardMove: "J8" }));
    const entry = nodeToCanonicalEntry(node);
    expect(entry).not.toBeNull();
    expect(entry?.randomPool).toBeUndefined();
    expect(typeof entry?.move).toBe("string");
  });

  it("トラップノード（生存手あり）: randomPool に生存手（canonical空間）が入る", () => {
    const node = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "I8", "J8", "H9", "H10", "G11"],
        hardMove: "F11",
        forcedWinKind: "VCT",
        forcedWinSequenceStr: "F11 ...",
        survivorMoves: ["E12", "D13"],
      }),
    );
    const entry = nodeToCanonicalEntry(node);
    expect(entry).not.toBeNull();
    expect(entry?.randomPool).toHaveLength(2);
    expect(entry?.randomPool).toContain(entry?.move);
  });

  it("彗星型（survivorMoves 空配列）: null（非掲載）を返す", () => {
    const node = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "I8", "J8", "H9", "H10", "G11"],
        hardMove: "F11",
        forcedWinKind: "VCT",
        forcedWinSequenceStr: "F11 ...",
        survivorMoves: [],
      }),
    );
    expect(nodeToCanonicalEntry(node)).toBeNull();
  });

  it("変換特定に失敗した場合は null を返す", () => {
    const node = plainNode({ canonicalKey: `${"B".repeat(225)}|white` });
    expect(nodeToCanonicalEntry(node)).toBeNull();
  });
});

describe("mergeNodesByCanonicalKey", () => {
  it("重複しないノードはそのまま通す", () => {
    // H8(=天元、全変換の不動点)を含む局面と、天元に石が無い局面は、
    // どの D4 変換でも同一canonicalKeyになり得ない（構造的に非対称）。
    const a = withRealCanonicalKey(
      plainNode({ movesUpToHere: ["H8", "I9", "I8"] }),
    );
    const b = withRealCanonicalKey(
      plainNode({ movesUpToHere: ["A1", "B2", "C3"], hardMove: "D4" }),
    );
    expect(a.canonicalKey).not.toBe(b.canonicalKey);
    const merged = mergeNodesByCanonicalKey([a, b]);
    expect(merged).toHaveLength(2);
  });

  it("同一canonicalKeyでトラップ行と非トラップ行が両方あれば、トラップとしてマージする", () => {
    const base = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "I8", "J8", "H9", "H10", "G11"],
        hardMove: "F11",
      }),
    );
    const nonTrap = { ...base, forcedWinKind: null, survivorMoves: null };
    const trap: BookDumpNode = {
      ...base,
      forcedWinKind: "VCT",
      forcedWinSequenceStr: "F11 ...",
      survivorMoves: ["E12"],
    };
    const merged = mergeNodesByCanonicalKey([nonTrap, trap]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.forcedWinKind).toBe("VCT");
    expect(merged[0]?.survivorMoves).toEqual(["E12"]);
  });

  it("同一canonicalKeyの複数トラップ行は生存手の和集合を取る（重複除去）", () => {
    const base = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "I8", "J8", "H9", "H10", "G11"],
        hardMove: "F11",
      }),
    );
    const trap1: BookDumpNode = {
      ...base,
      forcedWinKind: "VCT",
      forcedWinSequenceStr: "F11 ...",
      survivorMoves: ["E12", "D13"],
    };
    const trap2: BookDumpNode = {
      ...base,
      forcedWinKind: "VCF",
      forcedWinSequenceStr: "F11 ...",
      survivorMoves: ["D13", "C14"],
    };
    const merged = mergeNodesByCanonicalKey([trap1, trap2]);
    expect(merged).toHaveLength(1);
    expect(new Set(merged[0]?.survivorMoves)).toEqual(
      new Set(["E12", "D13", "C14"]),
    );
  });
});

describe("buildOpeningBookEntries", () => {
  it("彗星型を除外しつつ、通常・トラップノードからエントリを構築し統計を返す", () => {
    const plain = withRealCanonicalKey(
      plainNode({ movesUpToHere: ["H8", "I9", "I8"] }),
    );
    const trap = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "H9", "I8", "J9", "J8", "K9"],
        hardMove: "F11",
        forcedWinKind: "VCT",
        forcedWinSequenceStr: "F11 ...",
        survivorMoves: ["E12"],
      }),
    );
    const comet = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "H9", "I8", "J9", "H10", "K9"],
        hardMove: "F11",
        forcedWinKind: "VCT",
        forcedWinSequenceStr: "F11 ...",
        survivorMoves: [],
      }),
    );

    const { entries, stats } = buildOpeningBookEntries([plain, trap, comet]);

    expect(Object.keys(entries)).toHaveLength(2);
    expect(entries[plain.canonicalKey]).toBeDefined();
    // 実盤の生存手 "E12" が canonical 空間でどの表記になるかは局面の変換次第なので
    // ハードコードせず、nodeToCanonicalEntry の単体テストで検証済みの変換経路を
    // 通した期待値と突き合わせる。
    const expectedEntry = nodeToCanonicalEntry(trap);
    expect(entries[trap.canonicalKey]).toEqual(expectedEntry);
    expect(entries[comet.canonicalKey]).toBeUndefined();

    expect(stats.totalDumpNodes).toBe(3);
    expect(stats.mergedNodes).toBe(3);
    // trapNodes は forcedWinKind !== null のノード数（彗星型=生存手0件のトラップも含む）
    expect(stats.trapNodes).toBe(2);
    expect(stats.cometNodesSkipped).toBe(1);
    expect(stats.entryCount).toBe(2);

    // ゲート3（実装レビュー B1）: 挙動不変レポート用の内訳統計
    expect(stats.nonTrapEntryCount).toBe(1); // plain のみ
    expect(stats.trapEntryCount).toBe(1); // trap のみ（comet は非掲載）
    const expectedPoolSize = expectedEntry!.randomPool!.length;
    expect(stats.randomPoolSizeDistribution).toEqual({
      [expectedPoolSize]: 1,
    });
  });

  it("非トラップエントリの invariant 違反があればビルドを失敗させる", () => {
    // resolveCanonicalEntry が返す move を意図的に壊した状態を assertHardMoveInvariant
    // に直接渡して検証する（buildOpeningBookEntries 経由では正規パイプライン上
    // 矛盾を作れないため、下位の invariant チェック自体を直接テストする）。
    const node = withRealCanonicalKey(
      plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
    );
    const resolved = resolveCanonicalEntry(node)!;
    const corruptedEntry = { move: "A1" }; // hardMove(J8) とは無関係な手
    expect(() =>
      assertHardMoveInvariant(node, corruptedEntry, resolved.transformName),
    ).toThrow(/invariant/);
  });
});

describe("assertHardMoveInvariant", () => {
  it("非トラップノードで正しいエントリなら例外を投げない", () => {
    const node = withRealCanonicalKey(
      plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
    );
    const { entry, transformName } = resolveCanonicalEntry(node)!;
    expect(() =>
      assertHardMoveInvariant(node, entry, transformName),
    ).not.toThrow();
  });

  it("非トラップノードで不一致なエントリなら例外を投げる", () => {
    const node = withRealCanonicalKey(
      plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
    );
    expect(() =>
      assertHardMoveInvariant(node, { move: "A1" }, "identity"),
    ).toThrow(/invariant/);
  });

  it("トラップノード（forcedWinKind !== null）は対象外（不一致でも例外を投げない）", () => {
    const node = withRealCanonicalKey(
      plainNode({
        ply: 8,
        movesUpToHere: ["H8", "I9", "I8", "J8", "H9", "H10", "G11"],
        hardMove: "F11",
        forcedWinKind: "VCT",
        forcedWinSequenceStr: "F11 ...",
        survivorMoves: ["E12"],
      }),
    );
    expect(() =>
      assertHardMoveInvariant(node, { move: "A1" }, "identity"),
    ).not.toThrow();
  });
});

describe("buildOpeningBookAsset", () => {
  it("メタデータ・エントリ・統計を含む資産オブジェクトを構築する", () => {
    const metadata: BookDumpMetadata = {
      type: "metadata",
      timestamp: "2026-07-16T00:00:00.000Z",
      gitRev: "abc123",
      wasmBuildTime: "2026-07-16T00:00:00.000Z",
      seed: 20260716,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
    };
    const node = withRealCanonicalKey(plainNode());
    const asset = buildOpeningBookAsset({
      dumpMetadata: metadata,
      nodes: [node],
      sourceDump: "bench-results/book-dump.jsonl",
      buildGitRev: "def456",
      weightGeneration: "texel-r2",
      now: new Date("2026-07-16T12:00:00.000Z"),
    });

    expect(asset.version).toBe(1);
    expect(asset.sourceDump).toBe("bench-results/book-dump.jsonl");
    expect(asset.buildGitRev).toBe("def456");
    expect(asset.weightGeneration).toBe("texel-r2");
    expect(asset.dumpMetadata).toEqual(metadata);
    expect(asset.generatedAt).toBe("2026-07-16T12:00:00.000Z");
    expect(Object.keys(asset.entries)).toHaveLength(1);
    expect(asset.stats.entryCount).toBe(1);
  });
});

describe("実データフィクスチャ（scripts/lib/__fixtures__/opening-book/）からの構築", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const fixtureDumpPath = path.join(
    __dirname,
    "__fixtures__/opening-book/dump.jsonl",
  );

  it("実際の --dump-book 出力を invariant 違反なく資産化できる", () => {
    const dumpText = readFileSync(fixtureDumpPath, "utf-8");
    const { metadata, nodes } = parseDumpJsonl(dumpText);

    expect(nodes.length).toBeGreaterThan(0);

    // assertHardMoveInvariant はビルド失敗時に例外を投げるため、
    // 例外なく完了すること自体が「非トラップ由来エントリの挙動不変」の検証になる。
    const { entries, stats } = buildOpeningBookEntries(nodes);

    expect(stats.totalDumpNodes).toBe(nodes.length);
    expect(Object.keys(entries)).toHaveLength(stats.entryCount);
    expect(stats.nonTrapEntryCount + stats.trapEntryCount).toBe(
      stats.entryCount,
    );

    // フィクスチャ README に記載のとおり、このダンプにはトラップノードが
    // 2件（彗星型ではない）含まれる。
    const trapNodesInDump = nodes.filter((n) => n.forcedWinKind !== null);
    expect(trapNodesInDump.length).toBeGreaterThan(0);
    expect(stats.trapEntryCount).toBeGreaterThan(0);
    expect(metadata.roots).toBe("浦月");
  });
});
