/**
 * 序盤定石ブック v1（opening-book-2026-07-16.md §2）。
 *
 * `src/assets/opening-book-hard.json`（scripts/build-opening-book.ts が
 * trap-mining.ts --dump-book のダンプから生成）を遅延ロードし、
 * canonical 化 → ルックアップ → 逆変換の同期 API を提供する。
 *
 * API を用途別に分離している（cpu.worker.ts と review.worker.ts の import が
 * 混じらないようにするため。振り返りは着手選択にブックを使わない構造を保つ）:
 * - {@link getBookMove}: 着手API。cpu.worker.ts 専用。
 * - {@link isBookMove}: 注釈専用API。review.worker.ts 専用（着手選択には使わない）。
 *
 * `opening.ts`（珠型ロジック）には手を入れない。別モジュールとして独立させる。
 */
import type { BoardState, Position } from "@/types/game";

import {
  canonicalKeyWithTransform,
  inverseTransformPosition,
  transformPosition,
} from "@/logic/boardSymmetry";
import { formatMove, parseMove } from "@/logic/gameRecordParser";

/** 1エントリ（canonical 空間の座標を棋譜表記で保持）。 */
export interface OpeningBookEntry {
  /**
   * 着手用の手。cpu.worker.ts の実際の着手選択に使う。
   * 単一手、またはトラップ局面の検証済み生存手プール（ランダム選択の対象）。
   */
  play: {
    /** 既定の手（randomPool が無い、または rng 未使用時に使う）。 */
    move: string;
    /** トラップ局面の検証済み生存手。存在する場合はこの中から選ぶ。 */
    randomPool?: string[];
  };
  /**
   * 注釈用プール（重複除去済み）。振り返りの isBookMove はこのプールとの
   * 一致で判定する（v2: 注釈側の top-N 許容。opening-book-2026-07-16.md
   * ★v2プラン B1/B2）。play より広くなり得る（例: Rapfi 誘導の未検証候補）。
   */
  annotation: string[];
}

export interface OpeningBookAsset {
  entries: Record<string, OpeningBookEntry>;
}

/** 未試行: undefined、試行済み（未生成 or ロード失敗）: null、成功: Asset。 */
let cachedAsset: OpeningBookAsset | null | undefined = undefined;
let loadPromise: Promise<OpeningBookAsset | null> | null = null;

async function loadAsset(): Promise<OpeningBookAsset | null> {
  if (cachedAsset !== undefined) {
    return cachedAsset;
  }
  loadPromise ??= import("@/assets/opening-book-hard.json")
    .then(
      (mod): OpeningBookAsset | null =>
        (mod.default as OpeningBookAsset | undefined) ?? null,
    )
    .catch((error: unknown): null => {
      // ロード失敗を握りつぶさない（実装レビューで発覚: サイレントに null
      // フォールバックすると「ブックが常にヒットしない」状態が検知できないまま
      // 本番運用されるリスクがある）。cpu.worker.ts / review.worker.ts は
      // これを try/catch で包んでおり、ここで throw すると探索フォールバックの
      // 前に処理全体が失敗しうるため、throw ではなく明示的なログに留める。
      console.error(
        "[openingBook] 資産のロードに失敗しました。ブックなしで探索へ" +
          "フォールバックします（Node生スクリプトからは preloadOpeningBook ではなく" +
          " setOpeningBookAsset を使ってください）:",
        error,
      );
      return null;
    });
  cachedAsset = await loadPromise;
  return cachedAsset;
}

/**
 * 資産を事前ロードする。getBookMove/isBookMove は同期APIのため、
 * 呼び出し側は最初の1回だけこれを await しておく必要がある
 * （2回目以降はキャッシュ済みなので即時解決する）。
 */
export async function preloadOpeningBook(): Promise<void> {
  await loadAsset();
}

/** テスト専用フック: モジュールのキャッシュ状態を直接差し替える。 */
export function __setOpeningBookAssetForTesting(
  asset: OpeningBookAsset | null | undefined,
): void {
  cachedAsset = asset;
  loadPromise = asset === undefined ? null : Promise.resolve(asset ?? null);
}

/**
 * 既に何らかの方法（fetch/fs等）で読み込み済みの資産を直接セットする。
 *
 * Node CLI スクリプト（例: verify-book-blocks-traps.ts）向け。ブラウザでは
 * Vite が `.json` を透過的に扱うため {@link preloadOpeningBook} の動的 import で
 * 問題ないが、素の Node ESM ローダーは JSON モジュールに import attribute
 * （`with { type: "json" }`）を要求するため、CLI 側では `readFileSync` +
 * `JSON.parse` で読み込んだ結果をここでセットする方が単純で確実。
 */
export function setOpeningBookAsset(asset: OpeningBookAsset | null): void {
  cachedAsset = asset;
  loadPromise = Promise.resolve(asset);
}

function lookup(
  board: BoardState,
  color: "black" | "white",
): { entry: OpeningBookEntry; transformName: string } | null {
  if (!cachedAsset) {
    return null;
  }
  const { key, transformName } = canonicalKeyWithTransform(board, color);
  const entry = cachedAsset.entries[key];
  if (!entry) {
    return null;
  }
  return { entry, transformName };
}

/**
 * 着手API（cpu.worker.ts 専用）。ロード済み・ヒット時のみ実盤座標を返す。
 * randomPool があれば rng（既定 Math.random。対局用途のため決定性は不要だが、
 * テストでは固定関数を注入できる）で候補から1つ選ぶ。
 */
export function getBookMove(
  board: BoardState,
  color: "black" | "white",
  rng: () => number = Math.random,
): Position | null {
  const found = lookup(board, color);
  if (!found) {
    return null;
  }
  const { entry, transformName } = found;
  const pool = entry.play.randomPool;
  const canonicalMoveStr =
    pool && pool.length > 0
      ? pool[Math.floor(rng() * pool.length) % pool.length]!
      : entry.play.move;
  return inverseTransformPosition(parseMove(canonicalMoveStr), transformName);
}

/**
 * ヒット時のブック候補（実盤座標、着手用の手のみ）を全列挙する。
 * play.randomPool があれば全件、なければ play.move のみを1件返す。
 * ヒットしなければ null。
 *
 * cpu.worker.ts / review.worker.ts の対局用途では使わない
 * （getBookMove/isBookMove で十分）。ゲート検証スクリプト
 * （scripts/verify-book-blocks-traps.ts）が「着手候補はプール全手を
 * 決定的に列挙して検証する」ために使う。注釈プール（annotation）は
 * 対象外（未検証の候補を含み得るため、着手安全性ゲートの対象は play のみ）。
 */
export function getBookMoveCandidates(
  board: BoardState,
  color: "black" | "white",
): Position[] | null {
  const found = lookup(board, color);
  if (!found) {
    return null;
  }
  const { entry, transformName } = found;
  const canonicalMoveStrs =
    entry.play.randomPool && entry.play.randomPool.length > 0
      ? entry.play.randomPool
      : [entry.play.move];
  return canonicalMoveStrs.map((s) =>
    inverseTransformPosition(parseMove(s), transformName),
  );
}

/**
 * 注釈専用API（review.worker.ts 専用。着手選択には使わない）。
 * 打たれた手が、この局面の注釈プール（annotation）に含まれるかどうかだけを
 * 判定する（opening-book-2026-07-16.md §3、v2: ★v2プラン B1/B2で
 * annotation プール判定に変更。同一局面の複数の有力定石を劣手表示しない）。
 */
export function isBookMove(
  board: BoardState,
  color: "black" | "white",
  played: Position,
): boolean {
  const found = lookup(board, color);
  if (!found) {
    return false;
  }
  const { entry, transformName } = found;
  const playedCanonicalStr = formatMove(
    transformPosition(played, transformName),
  );
  return entry.annotation.includes(playedCanonicalStr);
}
