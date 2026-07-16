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

/**
 * 同一 canonicalKey の複数ノード（別ルートからの合流=transposition）をマージする。
 * - いずれかがトラップ検出（forcedWinKind !== null）ならトラップとして扱い、
 *   生存手は全行の和集合（重複除去）を取る。
 * - トラップなし行のみなら最初の行を採用する（同一局面なので hardMove は
 *   決定的に一致するはず）。
 */
export function mergeNodesByCanonicalKey(
  nodes: BookDumpNode[],
): BookDumpNode[] {
  const byKey = new Map<string, BookDumpNode[]>();
  for (const node of nodes) {
    const list = byKey.get(node.canonicalKey);
    if (list) {
      list.push(node);
    } else {
      byKey.set(node.canonicalKey, [node]);
    }
  }

  const merged: BookDumpNode[] = [];
  for (const group of byKey.values()) {
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }
    const trapNodes = group.filter((n) => n.forcedWinKind !== null);
    if (trapNodes.length === 0) {
      merged.push(group[0]!);
      continue;
    }
    const survivors = new Set<string>();
    for (const n of trapNodes) {
      for (const s of n.survivorMoves ?? []) {
        survivors.add(s);
      }
    }
    merged.push({ ...trapNodes[0]!, survivorMoves: [...survivors] });
  }
  return merged;
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
  const merged = mergeNodesByCanonicalKey(nodes);
  const entries: Record<string, OpeningBookEntry> = {};
  let trapNodes = 0;
  let cometNodesSkipped = 0;
  let inconsistentNodesSkipped = 0;
  let nonTrapEntryCount = 0;
  let trapEntryCount = 0;
  const randomPoolSizeDistribution: Record<number, number> = {};

  for (const node of merged) {
    const isTrap = node.forcedWinKind !== null;
    if (isTrap) {
      trapNodes++;
    }
    const resolved = resolveCanonicalEntry(node);
    if (resolved === null) {
      if (isTrap && (node.survivorMoves?.length ?? 0) === 0) {
        cometNodesSkipped++;
      } else {
        inconsistentNodesSkipped++;
      }
      continue;
    }
    const { entry, transformName } = resolved;

    // ゲート3（実装レビュー B1）: 非トラップ由来は hardMove と完全一致するはず。
    // 1件でも違えばビルドを失敗させる（挙動不変の静的保証）。
    assertHardMoveInvariant(node, entry, transformName);

    if (isTrap) {
      trapEntryCount++;
      const poolSize = entry.randomPool?.length ?? 1;
      randomPoolSizeDistribution[poolSize] =
        (randomPoolSizeDistribution[poolSize] ?? 0) + 1;
    } else {
      nonTrapEntryCount++;
    }

    entries[node.canonicalKey] = entry;
  }

  return {
    entries,
    stats: {
      totalDumpNodes: nodes.length,
      mergedNodes: merged.length,
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
