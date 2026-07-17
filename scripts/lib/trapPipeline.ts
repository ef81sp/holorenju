/**
 * 序盤トラップ採掘パイプラインの Phase1/2（opening-trap-mining-2026-07-16.md §4）。
 *
 * ルート（黒1・白2・黒3）ごとに hard 白4 → 攻め側フィルタで黒5候補 → hard 白6 →
 * 攻め側フィルタで黒7候補、を進め、「チェック粒度」（白8+VCF/VCT判定、trap-mining-worker.ts
 * が担当）に渡すタスク（black7着手後・白番の局面）を組み立てる。
 *
 * 再利用（solid S1）: 候補ランキング = searchEngine.ts の findBestMoveForReview()
 * （candidates[] を1親1回の探索で取得）。
 */
import type { BoardState, Position } from "@/types/game";

import { canonicalKey } from "@/logic/boardSymmetry";
import { applyMove, getOppositeColor } from "@/logic/cpu/core/boardUtils";
import {
  REVIEW_PROFILE_FAST,
  REVIEW_SEARCH_PARAMS,
} from "@/logic/cpu/review/reviewConstants";
import {
  encodeEvalOptions,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { formatMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import type { RouteRoot } from "./trapRoutes";

import { checkForcedWin, chooseHardMove } from "./forcedWinCheck";
import { findSurvivorMoves } from "./survivorMoves";
import {
  type AttackerMoveProvenance,
  selectAttackerMoves,
} from "./trapFilters";

/** レビュー探索（候補ランキング取得用）の評価オプションフラグ（hard 相当）。 */
const REVIEW_EVAL_FLAGS = encodeEvalOptions(
  REVIEW_SEARCH_PARAMS.evaluationOptions,
);

/** 攻め側フィルタのランダム枠比率（maxTotal に対する割合、最低1件）。 */
const RANDOM_SLOT_RATIO = 0.25;

export interface AttackerFilterBudget {
  /** 出力する手の総数上限（プランの b5/b7）。 */
  maxTotal: number;
}

export interface CheckLineTask {
  taskId: number;
  route: RouteRoot;
  /** ルート3手 + white4/black5/white6/black7 の棋譜表記（この順）。 */
  moveStrs: [string, string, string, string, string, string, string];
  black5Provenance: AttackerMoveProvenance;
  black7Provenance: AttackerMoveProvenance;
  /** black7 着手後・白番の局面（= hard が敗着を打つ直前の局面）。 */
  boardAfterBlack7: BoardState;
}

/**
 * ブックダンプ用の1ノード（opening-book-2026-07-16.md §1）。
 * white4/white6/white8 いずれかの手番ノードに対応する
 * （white8 は trap-mining.ts 側で Phase3 の結果から構築する）。
 *
 * ply 5/7 は黒番トラップ個別対応（opening-book-2026-07-16.md 黒対応）用。
 * 黒ダンプ（opening-book-dump-black.jsonl）の生スキーマは `blackMove` フィールドを
 * 持つが、buildOpeningBook.ts の抽出時に `hardMove` へマッピングして
 * この型に揃える（変換ロジック自体は着手した色に依存しないため）。
 */
export interface BookDumpNode {
  canonicalKey: string;
  route: string;
  ply: 4 | 5 | 6 | 7 | 8;
  /** このノードの局面に至るまでの手順（このノード自身の着手は含まない）。 */
  movesUpToHere: string[];
  hardMove: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequenceStr: string | null;
  /** トラップ検出時のみ非null。空配列なら生存手ゼロ（彗星型）。 */
  survivorMoves: string[] | null;
}

interface WhiteNodeResolution {
  position: Position;
  positionStr: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequenceStr: string | null;
}

/**
 * white4/white6 ノードの hard 選択を解決する。
 * dumpBook（強制勝ちチェックが必要）でなければ chooseHardMove のみ（軽量・従来挙動）。
 * dumpBook 時は checkForcedWin で選択と同時に VCF/VCT 判定まで行う。
 */
function resolveWhiteNode(
  engine: WasmSearchEngine,
  board: BoardState,
  hardTimeMs: number | undefined,
  needsForcedWinCheck: boolean,
): WhiteNodeResolution {
  if (!needsForcedWinCheck) {
    const choice = chooseHardMove(engine, board, "white", hardTimeMs);
    return {
      position: choice.position,
      positionStr: choice.positionStr,
      forcedWinKind: null,
      forcedWinSequenceStr: null,
    };
  }
  const result = checkForcedWin(engine, board, "white", hardTimeMs);
  return {
    position: result.chosenMove,
    positionStr: result.chosenMoveStr,
    forcedWinKind: result.forcedWinKind,
    forcedWinSequenceStr: result.forcedWinSequenceStr,
  };
}

/** dumpBookSink が渡されていれば、white ノードの情報を1件記録する。 */
function recordBookDumpNode(
  sink: BookDumpNode[] | undefined,
  engine: WasmSearchEngine,
  board: BoardState,
  route: string,
  ply: 4 | 6 | 8,
  movesUpToHere: string[],
  resolution: WhiteNodeResolution,
): void {
  if (!sink) {
    return;
  }
  const survivorMoves =
    resolution.forcedWinKind === null
      ? null
      : findSurvivorMoves(engine, board, "white", resolution.position)
          .survivors;
  sink.push({
    canonicalKey: canonicalKey(board, "white"),
    route,
    ply,
    movesUpToHere,
    hardMove: resolution.positionStr,
    forcedWinKind: resolution.forcedWinKind,
    forcedWinSequenceStr: resolution.forcedWinSequenceStr,
    survivorMoves,
  });
}

/**
 * 候補ランキング（FASTプロファイル）。彗星ルート個別対応（comet-mini-mining.ts）でも
 * 黒7の攻め側フィルタ入力として再利用するため export する。
 */
export function candidateRanking(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const result = engine.findBestMoveForReview(
    board,
    color,
    REVIEW_SEARCH_PARAMS.depth,
    REVIEW_PROFILE_FAST.timeLimit ?? 0,
    REVIEW_PROFILE_FAST.maxNodes,
    REVIEW_PROFILE_FAST.absoluteTimeLimit ?? 0,
    0, // aspirationMode（トラップ採掘の候補ランキング取得では不要）
    REVIEW_EVAL_FLAGS,
  );
  return result.candidates.map((c) => c.position);
}

function randomSlotCountFor(maxTotal: number): number {
  return Math.max(1, Math.round(maxTotal * RANDOM_SLOT_RATIO));
}

/**
 * 候補適用後の局面の canonical key で dedup する（ボス指摘 2026-07-16、
 * opening-trap-mining-2026-07-16.md ★第2段:「白2の代表固定後も残存対称がある限り
 * どの列挙段階でも対称ペアの枝が生じ得るため、全列挙段階（黒3・白4・白6）で
 * 候補適用後の局面 canonical key による dedup を一律適用する」という一般則を
 * 白番パイプライン（黒5/黒7列挙）にも適用する）。
 * 残存対称が無ければ全候補が異なる key を持つため自然に no-op になる。
 * trapPipelineBlack.ts でも再利用する共通ヘルパー。
 */
export function dedupByResultingCanonicalKey<T extends { position: Position }>(
  board: BoardState,
  moverColor: "black" | "white",
  candidates: T[],
): T[] {
  const opponent = getOppositeColor(moverColor);
  const seen = new Set<string>();
  const result: T[] = [];
  for (const c of candidates) {
    const afterBoard = applyMove(board, c.position, moverColor);
    const key = canonicalKey(afterBoard, opponent);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(c);
  }
  return result;
}

/**
 * ルート集合から「チェック粒度」タスク（black7着手後・白番の局面）をすべて構築する。
 * ルートごとに white4 を1回、黒5候補ごとに white6 を1回進める（Phase1/2 は直列実行。
 * 並列化はチェック粒度=Phase3 側で行う設計）。
 */
export function buildCheckTasks(
  engine: WasmSearchEngine,
  routes: RouteRoot[],
  opts: {
    black5Budget: AttackerFilterBudget;
    black7Budget: AttackerFilterBudget;
    hardTimeMs?: number;
    randomSeed: number;
    /**
     * 指定すると white4/white6 ノードについても強制勝ちチェック（VCF/VCT）を行い、
     * トラップ検出時は生存手導出まで実行して収集する（opening-book §1）。
     * 未指定時は従来どおり chooseHardMove のみ（軽量）。
     */
    dumpBookSink?: BookDumpNode[];
  },
): CheckLineTask[] {
  const tasks: CheckLineTask[] = [];
  let taskId = 0;
  const dumpBook = opts.dumpBookSink !== undefined;

  for (const route of routes) {
    const [black1, white2, black3] = route.positions;
    const board0 = createEmptyBoard();
    board0[black1.row]![black1.col] = "black";
    board0[white2.row]![white2.col] = "white";
    board0[black3.row]![black3.col] = "black";

    const white4 = resolveWhiteNode(engine, board0, opts.hardTimeMs, dumpBook);
    recordBookDumpNode(
      opts.dumpBookSink,
      engine,
      board0,
      route.name,
      4,
      [formatMove(black1), formatMove(white2), formatMove(black3)],
      white4,
    );
    const boardAfterWhite4 = applyMove(board0, white4.position, "white");

    const candidates4 = candidateRanking(engine, boardAfterWhite4, "black");
    const black5Candidates = dedupByResultingCanonicalKey(
      boardAfterWhite4,
      "black",
      selectAttackerMoves({
        board: boardAfterWhite4,
        color: "black",
        candidates: candidates4,
        topK: opts.black5Budget.maxTotal,
        maxTotal: opts.black5Budget.maxTotal,
        randomSlotCount: randomSlotCountFor(opts.black5Budget.maxTotal),
        randomSeed: opts.randomSeed,
      }),
    );

    for (const black5Entry of black5Candidates) {
      const boardAfterBlack5 = applyMove(
        boardAfterWhite4,
        black5Entry.position,
        "black",
      );

      const white6 = resolveWhiteNode(
        engine,
        boardAfterBlack5,
        opts.hardTimeMs,
        dumpBook,
      );
      recordBookDumpNode(
        opts.dumpBookSink,
        engine,
        boardAfterBlack5,
        route.name,
        6,
        [
          formatMove(black1),
          formatMove(white2),
          formatMove(black3),
          white4.positionStr,
          formatMove(black5Entry.position),
        ],
        white6,
      );
      const boardAfterWhite6 = applyMove(
        boardAfterBlack5,
        white6.position,
        "white",
      );

      const candidates6 = candidateRanking(engine, boardAfterWhite6, "black");
      const black7Candidates = dedupByResultingCanonicalKey(
        boardAfterWhite6,
        "black",
        selectAttackerMoves({
          board: boardAfterWhite6,
          color: "black",
          candidates: candidates6,
          topK: opts.black7Budget.maxTotal,
          maxTotal: opts.black7Budget.maxTotal,
          randomSlotCount: randomSlotCountFor(opts.black7Budget.maxTotal),
          randomSeed: opts.randomSeed,
        }),
      );

      for (const black7Entry of black7Candidates) {
        const boardAfterBlack7 = applyMove(
          boardAfterWhite6,
          black7Entry.position,
          "black",
        );

        tasks.push({
          taskId: taskId++,
          route,
          moveStrs: [
            formatMove(black1),
            formatMove(white2),
            formatMove(black3),
            white4.positionStr,
            formatMove(black5Entry.position),
            white6.positionStr,
            formatMove(black7Entry.position),
          ],
          black5Provenance: black5Entry.provenance,
          black7Provenance: black7Entry.provenance,
          boardAfterBlack7,
        });
      }
    }
  }

  return tasks;
}
