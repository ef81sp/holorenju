/**
 * --dump-book JSONL → オープニングブック資産（opening-book-hard.json）の
 * ビルドロジック（opening-book-2026-07-16.md §2）のテスト。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  D4_TRANSFORMS,
  canonicalKeyWithTransform,
  inverseTransformPosition,
  transformPosition,
} from "@/logic/boardSymmetry";
import {
  createBoardFromRecord,
  formatMove,
  parseMove,
} from "@/logic/gameRecordParser";

import type { BookDumpMetadata } from "./bookDumpMetadata";
import type { BookDumpNode } from "./trapPipeline";
import type { ForcedWinChecker } from "./verifyBookBlocksTraps";

import {
  applyPatches,
  applyRapfiGuidance,
  assertHardMoveInvariant,
  buildOpeningBookAsset,
  buildOpeningBookEntries,
  extractBlackTrapNodes,
  findConsistentTransform,
  mergeBlackTrapIntoAsset,
  nodeToCanonicalEntry,
  parseBlackTrapDumpJsonl,
  parseDumpJsonl,
  parsePatchJsonl,
  parseRapfiMovesJsonl,
  parseRapfiVerificationCacheJsonl,
  reconstructNodeBoard,
  resolveCanonicalEntry,
  serializeRapfiVerificationCache,
  type BlackDumpRawNode,
  type OpeningBookEntry,
  type OpeningBookPatchEntry,
  type RapfiMoveEntry,
  type RapfiVerificationCacheEntry,
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
    expect(entry?.play.randomPool).toBeUndefined();
    expect(typeof entry?.play.move).toBe("string");
    expect(entry?.annotation).toEqual([entry?.play.move]);
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
    expect(entry?.play.randomPool).toHaveLength(2);
    expect(entry?.play.randomPool).toContain(entry?.play.move);
    expect(new Set(entry?.annotation)).toEqual(new Set(entry?.play.randomPool));
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

describe("同一canonicalKeyへのtransposition（別ルート合流）のマージ", () => {
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
    const { entries } = buildOpeningBookEntries([nonTrap, trap]);
    expect(entries[base.canonicalKey]?.play.randomPool).toEqual(
      nodeToCanonicalEntry(trap)?.play.randomPool,
    );
  });

  it("同一canonicalKey・同一向きの複数トラップ行は生存手の和集合を取る（重複除去）", () => {
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
    const { entries } = buildOpeningBookEntries([trap1, trap2]);
    const expectedUnion = new Set([
      ...nodeToCanonicalEntry(trap1)!.play.randomPool!,
      ...nodeToCanonicalEntry(trap2)!.play.randomPool!,
    ]);
    expect(new Set(entries[base.canonicalKey]?.play.randomPool)).toEqual(
      expectedUnion,
    );
  });

  /**
   * 回帰テスト（実装レビューで発覚した実データ不具合）: 同一canonicalKeyに
   * 「異なる実盤の向き」で到達する2ノードをマージする場合、それぞれの
   * 生存手は各ノード自身の変換で canonical 化してから合成しなければならない。
   * 先に実盤座標の文字列だけをマージしてから1つの変換をまとめて適用すると、
   * 一方のノードの座標がもう一方の変換で誤って canonical 化され、
   * 検証されていない出鱈目なセルがブックに混入する。
   */
  it("異なる向きの2ノードが同一canonicalKeyに合流する場合、各ノード自身の変換で生存手を変換してからマージする", () => {
    const movesA = ["C3", "D4", "E5", "F6", "G7", "H8", "I9"];
    const { board: boardA } = createBoardFromRecord(movesA.join(" "));

    const rotate90 = D4_TRANSFORMS.find(
      (t) => t.name === "rotate90",
    )!.transform;
    // movesB は movesA を rotate90 しただけの「同一局面の別の向き」。
    const movesB = movesA.map((m) =>
      formatMove(rotate90(parseMove(m).row, parseMove(m).col)),
    );
    const { board: boardB } = createBoardFromRecord(movesB.join(" "));
    expect(canonicalKeyWithTransform(boardA, "white").key).toBe(
      canonicalKeyWithTransform(boardB, "white").key,
    );
    const sharedCanonicalKey = canonicalKeyWithTransform(boardA, "white").key;

    // P はボードA上の空きマス。Q も同様（Pとは別のもう1つの空きマス）。
    const survivorP = "A1"; // boardA視点での生存手（実盤座標）
    const survivorQ = "B1"; // boardA側だけが持つ、もう1つの生存手
    // survivorPRotated は「boardA視点のPと同一の canonical セル」を
    // boardB視点の実盤座標で表したもの（rotate90を適用）。
    const pPos = parseMove(survivorP);
    const survivorPInB = formatMove(rotate90(pPos.row, pPos.col));

    const nodeA: BookDumpNode = {
      canonicalKey: sharedCanonicalKey,
      route: "routeA",
      ply: 8,
      movesUpToHere: movesA,
      hardMove: "N14",
      forcedWinKind: "VCT",
      forcedWinSequenceStr: "dummy",
      survivorMoves: [survivorP, survivorQ],
    };
    const nodeB: BookDumpNode = {
      canonicalKey: sharedCanonicalKey,
      route: "routeB",
      ply: 8,
      movesUpToHere: movesB,
      hardMove: "N13",
      forcedWinKind: "VCT",
      forcedWinSequenceStr: "dummy",
      // boardB視点で見ると、これは boardA の P と同一の canonical セルを指す
      // （routeB は独立に P を「再発見」した、という想定）。
      survivorMoves: [survivorPInB],
    };

    const { entries } = buildOpeningBookEntries([nodeA, nodeB]);
    const pool = entries[sharedCanonicalKey]?.play.randomPool ?? [];

    // 正しい実装なら、P（boardA視点）と P（boardB視点、rotate90表記）は
    // 同一の canonical セルに解決されるため重複除去され、Q と合わせて
    // ちょうど2件になる（3件になっていたら、向きを間違えて別セルとして
    // カウントしてしまっている＝バグの再発）。
    expect(pool).toHaveLength(2);

    // 更に、pool の各要素をノードAの向きへ逆変換した結果が、実際に
    // boardA上の空きマスであること（＝出鱈目な座標が混入していないこと）を
    // 直接確認する。
    const boardSize = boardA.length;
    for (const canonicalMove of pool) {
      const realOnA = inverseTransformPosition(
        parseMove(canonicalMove),
        canonicalKeyWithTransform(boardA, "white").transformName,
      );
      expect(boardA[realOnA.row]?.[realOnA.col]).toBeNull();
      expect(realOnA.row).toBeGreaterThanOrEqual(0);
      expect(realOnA.row).toBeLessThan(boardSize);
    }
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
    const expectedPoolSize = expectedEntry!.play.randomPool!.length;
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
    // hardMove(J8) とは無関係な手
    const corruptedEntry = { play: { move: "A1" }, annotation: ["A1"] };
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
      assertHardMoveInvariant(
        node,
        { play: { move: "A1" }, annotation: ["A1"] },
        "identity",
      ),
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
      assertHardMoveInvariant(
        node,
        { play: { move: "A1" }, annotation: ["A1"] },
        "identity",
      ),
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

describe("parsePatchJsonl / applyPatches（opening-book-2026-07-16.md §4 彗星ルート個別対応）", () => {
  function makePatch(
    overrides: Partial<OpeningBookPatchEntry> = {},
  ): OpeningBookPatchEntry {
    const movesUpToHere = ["H8", "I9", "I8", "J8", "H9"]; // 5手（この白6着手前）
    const { board } = createBoardFromRecord(movesUpToHere.join(" "));
    const canonicalKey = canonicalKeyWithTransform(board, "white").key;
    return {
      type: "patch",
      canonicalKey,
      route: "彗星",
      movesUpToHere,
      replacementMove: "H10",
      reason: "彗星型ply8ノードの回避（white6差し替え）",
      verifiedSubtree: [
        { black7: "K9", status: "safe-has-survivors", survivorCount: 2 },
      ],
      ...overrides,
    };
  }

  it("parsePatchJsonl: patch行をパースし空行を無視する", () => {
    const patch = makePatch();
    const text = `${JSON.stringify(patch)}\n\n`;
    const parsed = parsePatchJsonl(text);
    expect(parsed).toEqual([patch]);
  });

  it("applyPatches: 既存エントリを patch の代替手（canonical空間へ変換済み）で上書きする", () => {
    const patch = makePatch();
    const original: Record<string, OpeningBookEntry> = {
      [patch.canonicalKey]: {
        play: { move: "H9-original-placeholder" },
        annotation: ["H9-original-placeholder"],
      },
    };
    const { entries, appliedCount } = applyPatches(original, [patch]);
    expect(appliedCount).toBe(1);
    expect(entries[patch.canonicalKey]).toBeDefined();
    expect(entries[patch.canonicalKey]?.play.move).not.toBe(
      "H9-original-placeholder",
    );
    // 逆変換で実盤に戻すと replacementMove と一致する（invariant相当）はず。
    // ここでは resolveCanonicalEntry と同じ変換ロジックを経由していることを
    // nodeToCanonicalEntry 経由の結果と突き合わせて確認する。
    const syntheticNode = {
      canonicalKey: patch.canonicalKey,
      route: patch.route,
      ply: 6 as const,
      movesUpToHere: patch.movesUpToHere,
      hardMove: patch.replacementMove,
      forcedWinKind: null,
      forcedWinSequenceStr: null,
      survivorMoves: null,
    };
    expect(entries[patch.canonicalKey]).toEqual(
      nodeToCanonicalEntry(syntheticNode),
    );
  });

  it("applyPatches: 既存エントリが無い canonicalKey にも新規追加できる", () => {
    const patch = makePatch();
    const { entries, appliedCount } = applyPatches({}, [patch]);
    expect(appliedCount).toBe(1);
    expect(entries[patch.canonicalKey]).toBeDefined();
  });

  it("applyPatches: canonicalKey が盤面と矛盾する patch は例外を投げる", () => {
    const patch = makePatch({ canonicalKey: `${"B".repeat(225)}|white` });
    expect(() => applyPatches({}, [patch])).toThrow();
  });

  it("applyPatches: 複数patchをまとめて適用できる", () => {
    const patch1 = makePatch();
    const movesUpToHere2 = ["A1", "B2", "C3", "D4", "E5"];
    const { board: board2 } = createBoardFromRecord(movesUpToHere2.join(" "));
    const patch2 = makePatch({
      canonicalKey: canonicalKeyWithTransform(board2, "white").key,
      movesUpToHere: movesUpToHere2,
      replacementMove: "F6",
    });
    const { entries, appliedCount } = applyPatches({}, [patch1, patch2]);
    expect(appliedCount).toBe(2);
    expect(Object.keys(entries)).toHaveLength(2);
  });
});

describe("黒番トラップ個別対応（opening-book-2026-07-16.md 黒対応最小構成）", () => {
  function blackRawNode(
    overrides: Partial<BlackDumpRawNode> = {},
  ): BlackDumpRawNode {
    const movesUpToHere = overrides.movesUpToHere ?? [
      "H8",
      "I9",
      "F6",
      "J9",
      "F7",
      "I8",
    ];
    const { board } = createBoardFromRecord(movesUpToHere.join(" "));
    const canonicalKey =
      overrides.canonicalKey ?? canonicalKeyWithTransform(board, "black").key;
    return {
      canonicalKey,
      route: "彗星",
      ply: 7,
      movesUpToHere,
      blackMove: "I7",
      forcedWinKind: "VCT" as const,
      forcedWinSequenceStr: "K9 L9 G9 H9 K10 L11 G6",
      survivorMoves: ["F9"],
      ...overrides,
    };
  }

  it("extractBlackTrapNodes: トラップノード（生存手あり）だけを BookDumpNode 形式で抽出する", () => {
    const trap = blackRawNode();
    const nonTrap = blackRawNode({
      movesUpToHere: ["A1", "B2", "C3", "D4"],
      ply: 5,
      blackMove: "E5",
      forcedWinKind: null,
      forcedWinSequenceStr: null,
      survivorMoves: null,
    });
    const comet = blackRawNode({
      movesUpToHere: ["A1", "B2", "C3", "D4", "E5", "F6"],
      blackMove: "G7",
      survivorMoves: [],
    });

    const extracted = extractBlackTrapNodes([trap, nonTrap, comet]);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.hardMove).toBe("I7"); // blackMove → hardMove へマッピング
    expect(extracted[0]?.forcedWinKind).toBe("VCT");
    expect(extracted[0]?.survivorMoves).toEqual(["F9"]);
  });

  it("parseBlackTrapDumpJsonl: メタデータ行 + 黒ノード行をパースし、トラップのみ抽出する", () => {
    const metadata: BookDumpMetadata = {
      type: "metadata",
      timestamp: "2026-07-16T00:00:00.000Z",
      gitRev: "abc",
      wasmBuildTime: "w",
      seed: 20260716,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
    };
    const trap = blackRawNode();
    const text = `${JSON.stringify(metadata)}\n${JSON.stringify(trap)}\n`;

    const result = parseBlackTrapDumpJsonl(text);
    expect(result.metadata).toEqual(metadata);
    expect(result.trapNodes).toHaveLength(1);
    expect(result.trapNodes[0]?.canonicalKey.endsWith("|black")).toBe(true);
  });

  it("mergeBlackTrapIntoAsset: 白由来資産に黒エントリを追加し、由来をメタデータへ記録する", () => {
    const whiteMetadata: BookDumpMetadata = {
      type: "metadata",
      timestamp: "2026-07-16T00:00:00.000Z",
      gitRev: "white-rev",
      wasmBuildTime: "w",
      seed: 20260716,
      roots: null,
      b5: 12,
      b7: 20,
      hardTimeMs: null,
    };
    const whiteNode = withRealCanonicalKey(plainNode());
    const asset = buildOpeningBookAsset({
      dumpMetadata: whiteMetadata,
      nodes: [whiteNode],
      sourceDump: "white-dump.jsonl",
      buildGitRev: "rev1",
      weightGeneration: "texel-r2",
    });
    const originalEntryCount = Object.keys(asset.entries).length;

    const blackMetadata: BookDumpMetadata = {
      ...whiteMetadata,
      gitRev: "black-rev",
    };
    const trapNodes = extractBlackTrapNodes([blackRawNode()]);

    const merged = mergeBlackTrapIntoAsset(asset, {
      sourceDump: "black-dump.jsonl",
      dumpMetadata: blackMetadata,
      trapNodes,
    });

    // 白由来のエントリは維持されたまま、黒エントリが追加される（キー衝突なし）。
    expect(Object.keys(merged.entries)).toHaveLength(originalEntryCount + 1);
    expect(merged.entries[whiteNode.canonicalKey]).toBeDefined();
    const blackKey = trapNodes[0]!.canonicalKey;
    expect(merged.entries[blackKey]?.play.randomPool).toEqual(
      nodeToCanonicalEntry(trapNodes[0]!)?.play.randomPool,
    );

    expect(merged.blackTrapProvenance).toEqual({
      sourceDump: "black-dump.jsonl",
      dumpMetadata: blackMetadata,
      nodeCount: 1,
      entryCount: 1,
    });

    // stats整合（実装レビューS suggestion）: entryCount = nonTrap+trap の和が
    // 黒エントリ加算後も保たれること。ビルドログの挙動不変レポートの読み手を
    // 誤らせないための固定テスト。
    expect(merged.stats.entryCount).toBe(Object.keys(merged.entries).length);
    expect(merged.stats.entryCount).toBe(
      merged.stats.nonTrapEntryCount + merged.stats.trapEntryCount,
    );
    // 黒トラップ1件分がtrapEntryCount/trapNodesへ正しく加算されている。
    expect(merged.stats.trapEntryCount).toBe(asset.stats.trapEntryCount + 1);
    expect(merged.stats.trapNodes).toBe(asset.stats.trapNodes + 1);
    expect(merged.stats.nonTrapEntryCount).toBe(asset.stats.nonTrapEntryCount);
  });
});

describe("Rapfi 誘導化（opening-book-2026-07-16.md ★v2プラン B1〜B3）", () => {
  /** 指定した実盤座標の手ごとに強制勝ちの有無を固定するフェイク ForcedWinChecker。 */
  function fakeChecker(
    resultByMove: Record<string, "VCF" | "VCT" | null>,
  ): ForcedWinChecker & { callCount: number } {
    let callCount = 0;
    return {
      get callCount() {
        return callCount;
      },
      check(_board, _sideToMove, move) {
        callCount++;
        return resultByMove[formatMove(move)] ?? null;
      },
    };
  }

  /** node の局面（実盤）で、realMoveStr を canonical 空間の棋譜表記に変換する。 */
  function toCanonicalStr(node: BookDumpNode, realMoveStr: string): string {
    const { board } = createBoardFromRecord(node.movesUpToHere.join(" "));
    const { transformName } = canonicalKeyWithTransform(board, "white");
    return formatMove(transformPosition(parseMove(realMoveStr), transformName));
  }

  describe("parseRapfiMovesJsonl", () => {
    it("Rapfi行をパースし空行を無視する", () => {
      const entry: RapfiMoveEntry = {
        canonicalKey: "dummy|white",
        movesUpToHere: ["H8", "I9", "I8"],
        rapfiMoves: ["J8", "K9"],
      };
      const text = `${JSON.stringify(entry)}\n\n`;
      expect(parseRapfiMovesJsonl(text)).toEqual([entry]);
    });
  });

  describe("RapfiVerificationCache のシリアライズ/ロード", () => {
    it("Map → JSONL → Map の往復で内容が保たれる", () => {
      const cache = new Map<string, "VCF" | "VCT" | null>([
        ["keyA|white::J8", null],
        ["keyB|white::K9", "VCF"],
        ["keyC|black::L10", "VCT"],
      ]);
      const text = serializeRapfiVerificationCache(cache);
      const roundTripped = parseRapfiVerificationCacheJsonl(text);
      expect(roundTripped).toEqual(cache);
    });

    it("空の Map は空文字列にシリアライズされる", () => {
      expect(serializeRapfiVerificationCache(new Map())).toBe("");
    });
  });

  describe("applyRapfiGuidance", () => {
    it("先頭のRapfi候補が安全なら採用され、playがRapfi手になり注釈へ合流する", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9", "L10"],
      };
      const checker = fakeChecker({}); // 全て安全
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.adopted).toBe(1);
      expect(report.rejected).toBe(0);
      expect(report.unavailable).toBe(0);
      expect(report.adoptedKeys).toEqual([node.canonicalKey]);

      // 全候補が安全なため、K9（先頭）が play に、K9・L10 両方が注釈へ合流する。
      const canonicalK9 = toCanonicalStr(node, "K9");
      const canonicalL10 = toCanonicalStr(node, "L10");
      const canonicalJ8 = toCanonicalStr(node, "J8");
      expect(entries[node.canonicalKey]?.play).toEqual({ move: canonicalK9 });
      expect(new Set(entries[node.canonicalKey]?.annotation)).toEqual(
        new Set([canonicalJ8, canonicalK9, canonicalL10]),
      );
    });

    it("先頭候補が危険でも次点が安全なら次点が採用され、危険だった候補は注釈に含めない", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9", "L10"],
      };
      const checker = fakeChecker({ K9: "VCF" }); // K9だけ危険
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.adopted).toBe(1);
      const canonicalL10 = toCanonicalStr(node, "L10");
      const canonicalK9 = toCanonicalStr(node, "K9");
      const canonicalJ8 = toCanonicalStr(node, "J8");
      expect(entries[node.canonicalKey]?.play).toEqual({ move: canonicalL10 });
      const annotation = new Set(entries[node.canonicalKey]?.annotation);
      expect(annotation).toEqual(new Set([canonicalJ8, canonicalL10]));
      expect(annotation.has(canonicalK9)).toBe(false); // 危険だった候補は含めない
    });

    it("全候補が危険ならv1のplay/annotationを維持し、rejectedとして報告する", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9", "L10"],
      };
      const checker = fakeChecker({ K9: "VCF", L10: "VCT" }); // 全て危険
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.adopted).toBe(0);
      expect(report.rejected).toBe(1);
      expect(report.rejectedKeys).toEqual([node.canonicalKey]);
      expect(entries[node.canonicalKey]).toEqual(v1Entries[node.canonicalKey]);
    });

    it("canonicalKeyが盤面と矛盾する場合はunavailableとして扱い、既存資産を変更しない", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: `${"B".repeat(225)}|white`,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9"],
      };
      const checker = fakeChecker({});
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.unavailable).toBe(1);
      expect(report.adopted).toBe(0);
      expect(report.rejected).toBe(0);
      expect(entries).toEqual(v1Entries);
      expect(checker.callCount).toBe(0); // canonicalize失敗なら検証すら行わない
    });

    it("石数ガード（実装レビュー suggestion）: movesUpToHereがcanonicalKeyより石数不足だとrejected扱いになり検証も行わない", () => {
      // 完全な7手局面から正しいcanonicalKeyを計算した後、Rapfiエントリの
      // movesUpToHereからは最後の1手（黒7相当）を落とす（trap-mining.tsの
      // 既知の欠損パターンを模擬）。findConsistentTransformは既知の石だけで
      // 判定するため矛盾なく変換が見つかってしまう＝欠けた盤のまま検証が
      // 通ってしまうsilent holeを、石数ガードで検出できることを確認する。
      const fullMoves = ["H8", "I9", "I8", "J8", "H9", "H10", "G11"];
      const { board: fullBoard } = createBoardFromRecord(fullMoves.join(" "));
      const trueCanonicalKey = canonicalKeyWithTransform(
        fullBoard,
        "white",
      ).key;

      const node: BookDumpNode = {
        canonicalKey: trueCanonicalKey,
        route: "雲月",
        ply: 8,
        movesUpToHere: fullMoves, // 資産側は完全な7手（既存エントリを持つ）
        hardMove: "F11",
        forcedWinKind: null,
        forcedWinSequenceStr: null,
        survivorMoves: null,
      };
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: trueCanonicalKey,
        movesUpToHere: fullMoves.slice(0, 6), // 黒7(G11)を欠落させる
        rapfiMoves: ["F11"],
      };
      // checkerが呼ばれたら失敗させる（欠けた盤で検証が走ってしまうバグの検出）。
      const checker: ForcedWinChecker = {
        check() {
          throw new Error(
            "石数不一致のエントリでcheckerが呼ばれた（ガードが機能していない）",
          );
        },
      };
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.rejected).toBe(1);
      expect(report.rejectedKeys).toEqual([trueCanonicalKey]);
      expect(report.adopted).toBe(0);
      expect(report.unavailable).toBe(0);
      expect(entries).toEqual(v1Entries); // v1のplay/annotationは変更されない
    });

    it("候補が全て盤上の既存石と重複する場合はunavailableとして扱う", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["H8"], // 既に黒石がある実盤座標
      };
      const checker = fakeChecker({});
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.unavailable).toBe(1);
      expect(entries).toEqual(v1Entries);
    });

    it("v1に存在しないcanonicalKeyでも、安全なRapfi候補があれば新規エントリとして追加する", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      // v1エントリは空（このcanonicalKeyはv1ブックの対象外だった局面という想定）。
      const v1Entries: Record<string, OpeningBookEntry> = {};

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9"],
      };
      const checker = fakeChecker({});
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(report.adopted).toBe(1);
      const canonicalK9 = toCanonicalStr(node, "K9");
      expect(entries[node.canonicalKey]).toEqual({
        play: { move: canonicalK9 },
        annotation: [canonicalK9],
      });
    });

    it("キャッシュにヒットした候補はcheckerを呼ばずに再利用する（高コスト検証の再ビルド間節約）", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);
      const canonicalK9 = toCanonicalStr(node, "K9");

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9"],
      };
      // 事前にキャッシュへ「安全」を書き込んでおく。
      const cache = new Map<string, "VCF" | "VCT" | null>([
        [`${node.canonicalKey}::${canonicalK9}`, null],
      ]);
      const checker = fakeChecker({ K9: "VCF" }); // もし呼ばれたら危険と返す設定
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        [rapfi],
        checker,
        cache,
      );

      expect(checker.callCount).toBe(0); // キャッシュヒットのため checker は呼ばれない
      expect(report.adopted).toBe(1); // キャッシュの「安全」がそのまま使われる
      expect(entries[node.canonicalKey]?.play.move).toBe(canonicalK9);
    });

    it("新規に検証した候補はonVerifiedコールバックへ通知される（CLI側でキャッシュ永続化するため）", () => {
      const node = withRealCanonicalKey(
        plainNode({ movesUpToHere: ["H8", "I9", "I8"], hardMove: "J8" }),
      );
      const { entries: v1Entries } = buildOpeningBookEntries([node]);

      const rapfi: RapfiMoveEntry = {
        canonicalKey: node.canonicalKey,
        movesUpToHere: node.movesUpToHere,
        rapfiMoves: ["K9"],
      };
      const checker = fakeChecker({});
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const notified: RapfiVerificationCacheEntry[] = [];
      applyRapfiGuidance(v1Entries, [rapfi], checker, cache, (entry) => {
        notified.push(entry);
      });

      const canonicalK9 = toCanonicalStr(node, "K9");
      expect(notified).toEqual([
        {
          canonicalKey: node.canonicalKey,
          move: canonicalK9,
          forcedWinKind: null,
        },
      ]);
    });
  });

  describe("実データフィクスチャからの統合確認（ID2: rapfi-moves.jsonl）", () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fixtureDir = path.join(__dirname, "__fixtures__/opening-book");

    it("dump.jsonlの実局面を対象にしたRapfi推奨手フィクスチャを取り込み、v1資産のplay/annotationを更新できる", () => {
      const dumpText = readFileSync(
        path.join(fixtureDir, "dump.jsonl"),
        "utf-8",
      );
      const { nodes } = parseDumpJsonl(dumpText);
      const { entries: v1Entries } = buildOpeningBookEntries(nodes);

      const rapfiText = readFileSync(
        path.join(fixtureDir, "rapfi-moves.jsonl"),
        "utf-8",
      );
      const rapfiEntries = parseRapfiMovesJsonl(rapfiText);
      expect(rapfiEntries.length).toBeGreaterThan(0);

      // フィクスチャの局面は既に検証済みのハード手を Rapfi 推奨としているため、
      // 「常に安全」なフェイク checker で adopted になることを確認する
      // （実運用では checkForcedWinAfterMove を注入する）。
      const checker = fakeChecker({});
      const cache = new Map<string, "VCF" | "VCT" | null>();
      const { entries, report } = applyRapfiGuidance(
        v1Entries,
        rapfiEntries,
        checker,
        cache,
      );

      expect(report.unavailable).toBe(0);
      expect(report.adopted).toBe(rapfiEntries.length);
      for (const rapfi of rapfiEntries) {
        expect(entries[rapfi.canonicalKey]).toBeDefined();
      }
    });
  });
});
