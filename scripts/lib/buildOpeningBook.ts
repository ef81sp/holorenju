/**
 * --dump-book JSONL → オープニングブック資産（src/assets/opening-book-hard.json）の
 * ビルドロジック（opening-book-2026-07-16.md §2）。
 *
 * ダンプの各ノードは「実盤座標」（movesUpToHere / hardMove / survivorMoves）で
 * 記録されている。資産は canonical key（boardSymmetry.canonicalKey）をキーとし、
 * 値は canonical 空間の座標で持つ必要があるため、ノードごとに「実盤 → canonical」の
 * 変換を特定し、hardMove/survivorMoves を canonical 空間へ変換してから格納する。
 *
 * 既知の欠損（trap-mining.ts の履歴バグ）: ply8 ノードの movesUpToHere が黒7を
 * 含まない（6手）ことがある。この場合でも findConsistentTransform は「わかっている
 * 石だけが canonicalKey の対応セルと矛盾なく一致する変換」を探すため、多くの場合
 * 問題なく変換を特定できる（未知の1石は判定に使わないため）。矛盾があれば
 * 安全側で null を返しノードごと除外する。
 */
import type { BoardState, Position } from "@/types/game";

import {
  D4_TRANSFORMS,
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

// ─── ダンプ JSONL のパース ──────────────────────────────

export interface ParsedDump {
  metadata: BookDumpMetadata;
  nodes: BookDumpNode[];
}

/** --dump-book が出力した JSONL（メタデータ行 + ノード行）をパースする。 */
export function parseDumpJsonl(text: string): ParsedDump {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("ダンプが空です（メタデータ行がありません）");
  }
  const [metadataLine, ...nodeLines] = lines;
  const metadata = JSON.parse(metadataLine!) as BookDumpMetadata;
  if (metadata.type !== "metadata") {
    throw new Error(
      `先頭行がメタデータ行ではありません（type=${String((metadata as { type?: unknown }).type)}）`,
    );
  }
  const nodes = nodeLines.map((line) => JSON.parse(line) as BookDumpNode);
  return { metadata, nodes };
}

// ─── 実盤 → canonical 変換の特定 ────────────────────────

/**
 * movesUpToHere を再生し、ノードの局面（このノード自身の白着手前）を実盤座標で
 * 再構築する。movesUpToHere が1手欠けていても（既知の欠損）reconstruct 自体は
 * 問題なく行える（欠けている石は単に盤面に置かれないだけ）。
 */
export function reconstructNodeBoard(node: BookDumpNode): BoardState {
  const { board } = createBoardFromRecord(node.movesUpToHere.join(" "));
  return board;
}

/**
 * board 上の「わかっている石」だけを使って、canonicalBoardKey（canonicalKey の
 * 盤面部分、"|black"/"|white" 込みでも可）と矛盾しない D4 変換を探す。
 *
 * 石が全て揃っている場合は canonicalKeyWithTransform と等価な結果になる
 * （盤面全体が一致するため）。石が一部欠けている場合でも、既知の石が全て
 * 変換後に正しい色のセルへ写像されることだけを確認する（未知の石の位置は
 * 判定に使わない）。複数の変換が矛盾なく一致する場合（自己対称局面）は
 * D4_TRANSFORMS の先頭から見つかったものを返す（canonicalKey 本体と同じ
 * tie-break）。矛盾する変換が1つもなければ null を返す。
 */
export function findConsistentTransform(
  board: BoardState,
  canonicalKey: string,
): string | null {
  const canonicalBoardStr = canonicalKey.split("|")[0] ?? "";
  if (canonicalBoardStr.length !== board.length * board.length) {
    return null;
  }

  const knownStones: { row: number; col: number; char: string }[] = [];
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board.length; col++) {
      const cell = board[row]?.[col] ?? null;
      if (cell === null) {
        continue;
      }
      knownStones.push({ row, col, char: cell === "black" ? "B" : "W" });
    }
  }

  const n = board.length;
  for (const { name, transform } of D4_TRANSFORMS) {
    let consistent = true;
    for (const stone of knownStones) {
      const dest = transform(stone.row, stone.col);
      const idx = dest.row * n + dest.col;
      if (canonicalBoardStr[idx] !== stone.char) {
        consistent = false;
        break;
      }
    }
    if (consistent) {
      return name;
    }
  }
  return null;
}

/** 実盤の手（棋譜表記）を、指定した変換で canonical 空間の手（棋譜表記）に変換する。 */
function toCanonicalMoveStr(moveStr: string, transformName: string): string {
  const pos = parseMove(moveStr);
  const canonicalPos = transformPosition(pos, transformName);
  return formatMove(canonicalPos);
}

/** canonical 空間の盤面文字列上で、指定した座標が空きマス('.')かどうか。 */
function isEmptyOnCanonicalBoard(
  canonicalKey: string,
  pos: Position,
  boardSize: number,
): boolean {
  const canonicalBoardStr = canonicalKey.split("|")[0] ?? "";
  const idx = pos.row * boardSize + pos.col;
  return canonicalBoardStr[idx] === ".";
}

// ─── ノード → ブックエントリ ─────────────────────────────

export interface OpeningBookEntry {
  /** canonical 空間の既定手（棋譜表記）。 */
  move: string;
  /** トラップ局面の検証済み生存手（canonical 空間、棋譜表記）。ランダム選択の対象。 */
  randomPool?: string[];
}

/**
 * 1ノードをブックエントリ（canonical 空間）+ 使用した変換名に解決する。
 * - 変換が特定できない（矛盾する）場合は null（安全側フォールバック、除外）
 * - 彗星型（forcedWinKind有り・survivorMoves空配列）は null（非掲載）
 * - トラップ（survivorMoves非空）は生存手を randomPool に、move は先頭を既定値に
 * - 通常ノードは hardMove をそのまま採用
 *
 * 変換後の座標が canonical 盤面上で空きマスでない場合も安全側で除外する
 * （findConsistentTransform の矛盾検出をすり抜けた誤変換の検知）。
 */
export function resolveCanonicalEntry(
  node: BookDumpNode,
): { entry: OpeningBookEntry; transformName: string } | null {
  const board = reconstructNodeBoard(node);
  const transformName = findConsistentTransform(board, node.canonicalKey);
  if (transformName === null) {
    return null;
  }

  const boardSize = board.length;

  if (node.forcedWinKind === null) {
    const canonicalMove = toCanonicalMoveStr(node.hardMove, transformName);
    if (
      !isEmptyOnCanonicalBoard(
        node.canonicalKey,
        parseMove(canonicalMove),
        boardSize,
      )
    ) {
      return null;
    }
    return { entry: { move: canonicalMove }, transformName };
  }

  const survivors = node.survivorMoves ?? [];
  if (survivors.length === 0) {
    // 彗星型: 非掲載
    return null;
  }

  const canonicalSurvivors = survivors
    .map((s) => toCanonicalMoveStr(s, transformName))
    .filter((s) =>
      isEmptyOnCanonicalBoard(node.canonicalKey, parseMove(s), boardSize),
    );
  if (canonicalSurvivors.length === 0) {
    return null;
  }

  return {
    entry: { move: canonicalSurvivors[0]!, randomPool: canonicalSurvivors },
    transformName,
  };
}

/** {@link resolveCanonicalEntry} のエントリ部分だけを返す薄いラッパー（テスト・単体利用向け）。 */
export function nodeToCanonicalEntry(
  node: BookDumpNode,
): OpeningBookEntry | null {
  return resolveCanonicalEntry(node)?.entry ?? null;
}

/**
 * 挙動不変 invariant（opening-book-2026-07-16.md §5 ゲート3・実装レビュー B1）:
 * 非トラップ由来のエントリは、ブック手（canonical 空間）を実盤へ逆変換すると
 * 必ずダンプの hardMove と完全一致しなければならない
 * （＝非トラップ局面ではブックが挙動を一切変えないことの証明）。
 * 1件でも不一致ならビルドを失敗させる（安全側。データやコードの不整合を検出）。
 * トラップ由来（forcedWinKind !== null）のエントリは対象外（意図的に hardMove と
 * 異なる検証済み生存手を採用するため）。
 */
export function assertHardMoveInvariant(
  node: BookDumpNode,
  entry: OpeningBookEntry,
  transformName: string,
): void {
  if (node.forcedWinKind !== null) {
    return;
  }
  const recoveredReal = formatMove(
    inverseTransformPosition(parseMove(entry.move), transformName),
  );
  if (recoveredReal !== node.hardMove) {
    throw new Error(
      "オープニングブック invariant 違反: 非トラップノードのブック手が " +
        `hardMove と一致しません（canonicalKey=${node.canonicalKey}, ` +
        `hardMove=${node.hardMove}, ブック手を実盤へ逆変換した結果=${recoveredReal}）`,
    );
  }
}

// ─── 重複（transposition）のマージ ─────────────────────────
//
// 重要（実装レビューで発覚した実データ不具合の修正）: 同一 canonicalKey に
// 複数ノード（別ルートからの合流=transposition）が集まる場合、各ノードは
// 一般に「異なる実盤の向き」（別の変換で canonical 化される）で記録されている。
// 生存手などの実盤座標の文字列を先にマージしてから1つの変換をまとめて適用すると、
// 一部のノードの座標が「間違った向きの変換」で canonical 化され、検証されていない
// 出鱈目なセルがブックに混入する（ゲート1実行時に実データで発覚: 3ルートが
// 同一canonicalKeyへ合流するケースで、別ルートの生存手座標が誤って混ざり、
// その結果生成された候補手が実際には強制勝ちを許していた）。
//
// 正しい手順は「各ノードを個別に canonical 化してから、canonical 空間で
// マージする」こと（このファイルの buildOpeningBookEntries を参照）。

interface ResolvedGroupMember {
  node: BookDumpNode;
  entry: OpeningBookEntry;
}

/**
 * 同一 canonicalKey の解決済みエントリ群（canonical 空間、既に個々の向きで
 * 正しく変換済み）を1つにマージする。
 * - いずれかがトラップ由来なら、canonical 空間の生存手プールの和集合
 *   （重複除去）を採用する。
 * - トラップ由来が無ければ、先頭のエントリを採用する（同一局面なので
 *   canonical 空間の move は決定的に一致するはず）。
 */
function mergeResolvedGroup(group: ResolvedGroupMember[]): OpeningBookEntry {
  const trapGroup = group.filter((g) => g.node.forcedWinKind !== null);
  if (trapGroup.length === 0) {
    return group[0]!.entry;
  }
  const survivors = new Set<string>();
  for (const g of trapGroup) {
    for (const s of g.entry.randomPool ?? [g.entry.move]) {
      survivors.add(s);
    }
  }
  const survivorsArr = [...survivors];
  return { move: survivorsArr[0]!, randomPool: survivorsArr };
}

// ─── ノード集合 → エントリ辞書 + 統計 ───────────────────────

export interface BuildOpeningBookStats {
  /** ダンプに含まれていたノード総数（重複含む）。 */
  totalDumpNodes: number;
  /** canonicalKey でマージした後のノード数。 */
  mergedNodes: number;
  /** トラップノード数（マージ後）。 */
  trapNodes: number;
  /** 彗星型として非掲載になったノード数。 */
  cometNodesSkipped: number;
  /** 変換の矛盾により除外されたノード数。 */
  inconsistentNodesSkipped: number;
  /** 最終的なエントリ数。 */
  entryCount: number;
  /**
   * 非トラップ由来のエントリ数（= hardMove と完全一致する invariant を
   * 満たすエントリ数。ゲート3: 挙動不変の証明対象）。
   */
  nonTrapEntryCount: number;
  /** トラップ由来（検証済み生存手を採用）のエントリ数。 */
  trapEntryCount: number;
  /** トラップ由来エントリの randomPool サイズ分布（サイズ → 件数）。 */
  randomPoolSizeDistribution: Record<number, number>;
}

export function buildOpeningBookEntries(nodes: BookDumpNode[]): {
  entries: Record<string, OpeningBookEntry>;
  stats: BuildOpeningBookStats;
} {
  // 生の（実盤座標のままの）ノードを canonicalKey でグループ化する。
  // マージ（生存手プールの統合）はこの後、各ノードを個別に canonical 化してから
  // 行う（実盤座標のまま先にマージしてはいけない。このファイル冒頭のコメント参照）。
  const byKey = new Map<string, BookDumpNode[]>();
  for (const node of nodes) {
    const list = byKey.get(node.canonicalKey);
    if (list) {
      list.push(node);
    } else {
      byKey.set(node.canonicalKey, [node]);
    }
  }

  const entries: Record<string, OpeningBookEntry> = {};
  let trapNodes = 0;
  let cometNodesSkipped = 0;
  let inconsistentNodesSkipped = 0;
  let nonTrapEntryCount = 0;
  let trapEntryCount = 0;
  const randomPoolSizeDistribution: Record<number, number> = {};

  for (const [canonicalKey, group] of byKey) {
    // distinct 局面数で数える（transposition で複数ルートが同一 canonicalKey に
    // 合流していても1件とカウントする。生のノード出現回数ではない）。
    if (group.some((n) => n.forcedWinKind !== null)) {
      trapNodes++;
    }

    // グループ内の各ノードを「自身の向き」で個別に canonical 化する。
    const resolvedGroup: ResolvedGroupMember[] = [];
    for (const node of group) {
      const resolved = resolveCanonicalEntry(node);
      if (resolved === null) {
        continue;
      }
      // ゲート3（実装レビュー B1）: 非トラップ由来は hardMove と完全一致するはず。
      // 1件でも違えばビルドを失敗させる（挙動不変の静的保証）。
      assertHardMoveInvariant(node, resolved.entry, resolved.transformName);
      resolvedGroup.push({ node, entry: resolved.entry });
    }

    const trapResolved = resolvedGroup.filter(
      (r) => r.node.forcedWinKind !== null,
    );

    if (trapResolved.length > 0) {
      // resolveCanonicalEntry のトラップ分岐は randomPool を必ず非空で返すため
      // （空なら null を返す）、ここでの和集合が空になることはない。
      const entry = mergeResolvedGroup(trapResolved);
      entries[canonicalKey] = entry;
      trapEntryCount++;
      const poolSize = entry.randomPool?.length ?? 1;
      randomPoolSizeDistribution[poolSize] =
        (randomPoolSizeDistribution[poolSize] ?? 0) + 1;
      continue;
    }

    if (group.some((n) => n.forcedWinKind !== null)) {
      // トラップノードは存在したが、誰も生存手を解決できなかった
      // （彗星型、または全滅）。非掲載。
      cometNodesSkipped++;
      continue;
    }

    const [nonTrapResolved] = resolvedGroup;
    if (!nonTrapResolved) {
      // 非トラップノードのみのグループで、誰も変換を解決できなかった。
      inconsistentNodesSkipped++;
      continue;
    }
    entries[canonicalKey] = nonTrapResolved.entry;
    nonTrapEntryCount++;
  }

  return {
    entries,
    stats: {
      totalDumpNodes: nodes.length,
      mergedNodes: byKey.size,
      trapNodes,
      cometNodesSkipped,
      inconsistentNodesSkipped,
      entryCount: Object.keys(entries).length,
      nonTrapEntryCount,
      trapEntryCount,
      randomPoolSizeDistribution,
    },
  };
}

// ─── 資産全体の構築 ────────────────────────────────────

export interface OpeningBookAsset {
  version: 1;
  generatedAt: string;
  sourceDump: string;
  buildGitRev: string;
  weightGeneration: string;
  dumpMetadata: BookDumpMetadata;
  stats: BuildOpeningBookStats;
  entries: Record<string, OpeningBookEntry>;
  /**
   * 黒番トラップの個別対応（opening-book-2026-07-16.md 黒対応・最小構成）の由来記録。
   * 黒ダンプ全体は焼き込まず、severity-A のトラップノードだけを個別抽出して
   * マージしているため、その由来をここに残す。黒対応が無い資産では省略される。
   */
  blackTrapProvenance?: {
    sourceDump: string;
    dumpMetadata: BookDumpMetadata;
    /** 抽出元の黒トラップノード数（= 個別対応した severity-A 局面数）。 */
    nodeCount: number;
    /** 実際に資産へ追加されたエントリ数。 */
    entryCount: number;
  };
}

export function buildOpeningBookAsset(params: {
  dumpMetadata: BookDumpMetadata;
  nodes: BookDumpNode[];
  sourceDump: string;
  buildGitRev: string;
  weightGeneration: string;
  now?: Date;
}): OpeningBookAsset {
  const { entries, stats } = buildOpeningBookEntries(params.nodes);
  return {
    version: 1,
    generatedAt: (params.now ?? new Date()).toISOString(),
    sourceDump: params.sourceDump,
    buildGitRev: params.buildGitRev,
    weightGeneration: params.weightGeneration,
    dumpMetadata: params.dumpMetadata,
    stats,
    entries,
  };
}

// ─── 彗星ルート個別対応（§4）: パッチ（white6差し替え）の適用 ────────────────

/**
 * 彗星型 ply8 ノード（生存手ゼロ）の回避策として、white6 を代替手へ差し替える
 * パッチ1件（opening-book-2026-07-16.md §4）。
 *
 * white6 自体は直接の VCF/VCT トラップではない（forcedWinKind を持たない）ため、
 * 通常の BookDumpNode の invariant 検証だけでは安全性を証明できない。代わりに
 * 「配下の黒7（攻め側フィルタ ≤20本）×white8 チェックのいずれにも生存手ゼロの
 * ply8（彗星）が無い」ことをミニ採掘（comet-mini-mining.ts）で確認し、
 * その検証記録を verifiedSubtree に残す。
 */
export interface OpeningBookPatchEntry {
  type: "patch";
  /** パッチ対象局面（白番）の canonicalKey。 */
  canonicalKey: string;
  route: string;
  /** この白番手番の着手前の手順（実盤座標）。 */
  movesUpToHere: string[];
  /** 代替手（実盤座標、棋譜表記）。 */
  replacementMove: string;
  reason: string;
  /** ミニ採掘での検証記録（invariant相当）。 */
  verifiedSubtree: {
    black7: string;
    status: "safe-no-forced-win" | "safe-has-survivors";
    forcedWinKind?: "VCF" | "VCT";
    survivorCount?: number;
  }[];
}

/** comet-mini-mining.ts が出力した patch JSONL をパースする。 */
export function parsePatchJsonl(text: string): OpeningBookPatchEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OpeningBookPatchEntry);
}

/**
 * patch エントリを既存のエントリ辞書へ適用する。
 *
 * 各 patch を「非トラップの通常ノード」（forcedWinKind: null, hardMove:
 * replacementMove）として表現し、既存の resolveCanonicalEntry /
 * assertHardMoveInvariant をそのまま再利用する（§4: 新しい変換ロジックを
 * 持たず、既存パイプラインに乗せることで invariant 相当の検証を維持する）。
 * canonicalKey が盤面と矛盾する patch は例外を投げる（安全側フォールバック）。
 */
export function applyPatches(
  entries: Record<string, OpeningBookEntry>,
  patches: OpeningBookPatchEntry[],
): { entries: Record<string, OpeningBookEntry>; appliedCount: number } {
  const result = { ...entries };
  let appliedCount = 0;

  for (const patch of patches) {
    const syntheticNode: BookDumpNode = {
      canonicalKey: patch.canonicalKey,
      route: patch.route,
      ply: 6,
      movesUpToHere: patch.movesUpToHere,
      hardMove: patch.replacementMove,
      forcedWinKind: null,
      forcedWinSequenceStr: null,
      survivorMoves: null,
    };

    const resolved = resolveCanonicalEntry(syntheticNode);
    if (!resolved) {
      throw new Error(
        `patch適用失敗: canonicalKeyが盤面と矛盾します（route=${patch.route}, ` +
          `canonicalKey=${patch.canonicalKey}）`,
      );
    }
    assertHardMoveInvariant(
      syntheticNode,
      resolved.entry,
      resolved.transformName,
    );

    result[patch.canonicalKey] = resolved.entry;
    appliedCount++;
  }

  return { entries: result, appliedCount };
}

// ─── 黒番トラップ個別対応（opening-book-2026-07-16.md 黒対応・最小構成） ──────
//
// 黒番採掘（--dump-book --side=black 相当）は白番と役割が反転する
// （黒がhard・白が攻め側フィルタ）ため、ダンプの生スキーマは `hardMove` ではなく
// `blackMove` を持つ。事前登録の判定基準（severity-A 1〜4件=個別対応）に従い、
// 黒ダンプ全体は資産へ焼き込まず、トラップノード（forcedWinKind有り・
// survivorMoves非空）だけを抽出して既存資産へマージする。

/** 黒ダンプの生ノード（blackMoveスキーマ）。 */
export interface BlackDumpRawNode {
  canonicalKey: string;
  route: string;
  ply: number;
  movesUpToHere: string[];
  blackMove: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequenceStr: string | null;
  survivorMoves: string[] | null;
}

/**
 * 黒ダンプの生ノードから「トラップノード（forcedWinKind!==null かつ
 * survivorMoves非空）」だけを BookDumpNode 形式（`blackMove` → `hardMove`
 * へマッピング）に変換して抽出する。彗星型（survivorMoves空）・非トラップ
 * ノードは対象外（黒ダンプ全体は焼き込まない方針）。
 */
export function extractBlackTrapNodes(
  rawNodes: BlackDumpRawNode[],
): BookDumpNode[] {
  return rawNodes
    .filter(
      (n) => n.forcedWinKind !== null && (n.survivorMoves?.length ?? 0) > 0,
    )
    .map((n) => ({
      canonicalKey: n.canonicalKey,
      route: n.route,
      ply: n.ply as BookDumpNode["ply"],
      movesUpToHere: n.movesUpToHere,
      hardMove: n.blackMove,
      forcedWinKind: n.forcedWinKind,
      forcedWinSequenceStr: n.forcedWinSequenceStr,
      survivorMoves: n.survivorMoves,
    }));
}

/**
 * 黒ダンプ JSONL（メタデータ行 + blackMoveスキーマのノード行）をパースし、
 * トラップノードのみを抽出する。
 */
export function parseBlackTrapDumpJsonl(text: string): {
  metadata: BookDumpMetadata;
  trapNodes: BookDumpNode[];
} {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error("黒ダンプが空です（メタデータ行がありません）");
  }
  const [metadataLine, ...nodeLines] = lines;
  const metadata = JSON.parse(metadataLine!) as BookDumpMetadata;
  if (metadata.type !== "metadata") {
    throw new Error(
      `先頭行がメタデータ行ではありません（type=${String((metadata as { type?: unknown }).type)}）`,
    );
  }
  const rawNodes = nodeLines.map(
    (line) => JSON.parse(line) as BlackDumpRawNode,
  );
  return { metadata, trapNodes: extractBlackTrapNodes(rawNodes) };
}

/**
 * 既存資産（通常は白由来）に、黒トラップ抽出済みノードから構築したエントリを
 * マージする。白由来の canonicalKey は必ず "|white"、黒由来は必ず "|black" で
 * 終わるため、キー衝突は構造的に起きない。
 */
export function mergeBlackTrapIntoAsset(
  asset: OpeningBookAsset,
  params: {
    sourceDump: string;
    dumpMetadata: BookDumpMetadata;
    trapNodes: BookDumpNode[];
  },
): OpeningBookAsset {
  const { entries: blackEntries, stats: blackStats } = buildOpeningBookEntries(
    params.trapNodes,
  );

  // randomPoolサイズ分布はキー単位で件数を加算する（プールサイズごとの内訳統計）。
  const randomPoolSizeDistribution: Record<number, number> = {
    ...asset.stats.randomPoolSizeDistribution,
  };
  for (const [sizeStr, count] of Object.entries(
    blackStats.randomPoolSizeDistribution,
  )) {
    const size = Number(sizeStr);
    randomPoolSizeDistribution[size] =
      (randomPoolSizeDistribution[size] ?? 0) + count;
  }

  return {
    ...asset,
    entries: { ...asset.entries, ...blackEntries },
    stats: {
      // 挙動不変レポートの読み手を誤らせないよう、全フィールドを黒分と合算する
      // （entryCount = nonTrapEntryCount + trapEntryCount の整合を維持する）。
      totalDumpNodes: asset.stats.totalDumpNodes + blackStats.totalDumpNodes,
      mergedNodes: asset.stats.mergedNodes + blackStats.mergedNodes,
      trapNodes: asset.stats.trapNodes + blackStats.trapNodes,
      cometNodesSkipped:
        asset.stats.cometNodesSkipped + blackStats.cometNodesSkipped,
      inconsistentNodesSkipped:
        asset.stats.inconsistentNodesSkipped +
        blackStats.inconsistentNodesSkipped,
      entryCount: asset.stats.entryCount + blackStats.entryCount,
      nonTrapEntryCount:
        asset.stats.nonTrapEntryCount + blackStats.nonTrapEntryCount,
      trapEntryCount: asset.stats.trapEntryCount + blackStats.trapEntryCount,
      randomPoolSizeDistribution,
    },
    blackTrapProvenance: {
      sourceDump: params.sourceDump,
      dumpMetadata: params.dumpMetadata,
      nodeCount: params.trapNodes.length,
      entryCount: blackStats.entryCount,
    },
  };
}
