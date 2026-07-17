/**
 * 黒番採掘パイプライン（opening-trap-mining-2026-07-16.md ★第2段、簡素化後）。
 *
 * ルートは白版と完全に同一（26珠型、trapRoutes.buildJushuRoots）。珠型外ルートは
 * 不要（cpuGameStore.startGame は珠型指定時に3手すべて自動配置するため、
 * 「白2自由・黒3のCPU開局ロジック列挙」という対局モードには存在しない状況を
 * 想定していた旧設計は破棄した）。
 *
 * 白版と役割が反転する: ルート（黒1・白2・黒3） × 白4（攻め側フィルタ ≤12）×
 * 黒5（CPU実機・一本道）× 白6（攻め側フィルタ ≤20）× 黒7（CPU実機・一本道）。
 * 各黒手番ノード（黒5・黒7）で強制勝ちチェック（白への VCF∪VCT）+ トラップ検出時は
 * 生存手導出まで実行する（--dump-book モード相当を最初から）。
 *
 * 並列化は白版と同じ思想: black5 は木構築（Phase1/2 相当）内で直列に
 * dumpBook 判定（resolveBlackNode/recordBlackBookDumpNode）を行い、black7 は
 * 着手決定を後回しにして「white6 着手後・黒番の局面」をタスクとして保持し、
 * trap-mining.ts 側のチェック粒度ワークスティール並列（white版の white8 と同じ
 * 役割）に渡す。
 *
 * 対称重複の一般則（ボス指摘 2026-07-16）: 全列挙段階（white4・white6）で
 * 候補適用後の局面 canonical key による dedup を一律適用する
 * （trapPipeline.ts の dedupByResultingCanonicalKey を再利用）。
 *
 * 再利用: 候補ランキング/攻め側フィルタ = trapPipeline.ts の candidateRanking・
 * dedupByResultingCanonicalKey（color パラメータ化済み）。強制勝ち判定 =
 * forcedWinCheck.ts の checkForcedWin/chooseHardMove（白版と共有 SSoT）。
 * 生存手導出 = survivorMoves.ts の findSurvivorMoves（color パラメータ化済み）。
 */
import type { BoardState, Position } from "@/types/game";

import { canonicalKey } from "@/logic/boardSymmetry";
import { applyMove } from "@/logic/cpu/core/boardUtils";
import { WasmSearchEngine } from "@/logic/cpu/wasm/searchEngine";
import { formatMove } from "@/logic/gameRecordParser";
import { createEmptyBoard } from "@/logic/renjuRules";

import type { RouteRoot } from "./trapRoutes";

import { checkForcedWin, chooseHardMove } from "./forcedWinCheck";
import { findSurvivorMoves } from "./survivorMoves";
import {
  type AttackerMoveProvenance,
  selectAttackerMoves,
} from "./trapFilters";
import {
  candidateRanking,
  dedupByResultingCanonicalKey,
  type AttackerFilterBudget,
} from "./trapPipeline";

/** 攻め側フィルタのランダム枠比率（白版 trapPipeline.ts と同じ値）。 */
const RANDOM_SLOT_RATIO = 0.25;

function randomSlotCountFor(maxTotal: number): number {
  return Math.max(1, Math.round(maxTotal * RANDOM_SLOT_RATIO));
}

export interface BlackCheckLineTask {
  taskId: number;
  route: RouteRoot;
  /** ルート3手 + white4/black5/white6 の棋譜表記（black7は未決定）。 */
  moveStrs: [string, string, string, string, string, string];
  white4Provenance: AttackerMoveProvenance;
  white6Provenance: AttackerMoveProvenance;
  /** white6 着手後・黒番の局面（= black7 を選び白への強制勝ちを判定する対象）。 */
  boardAfterWhite6: BoardState;
}

/**
 * ブックダンプ用の1ノード（黒版）。black5/black7 いずれかの手番ノードに対応する
 * （black7 は trap-mining.ts 側で Phase3 の結果から構築する）。
 */
export interface BlackBookDumpNode {
  canonicalKey: string;
  route: string;
  ply: 5 | 7;
  /** このノードの局面に至るまでの手順（このノードの黒の着手は含まない）。 */
  movesUpToHere: string[];
  blackMove: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequenceStr: string | null;
  /** トラップ検出時のみ非null。空配列なら生存手ゼロ（彗星型）。 */
  survivorMoves: string[] | null;
}

interface BlackNodeResolution {
  position: Position;
  positionStr: string;
  forcedWinKind: "VCF" | "VCT" | null;
  forcedWinSequenceStr: string | null;
}

/**
 * black5/black7 ノードの hard 選択を解決する（white版 resolveWhiteNode の
 * 色反転版）。dumpBook でなければ chooseHardMove のみ（軽量）。
 */
function resolveBlackNode(
  engine: WasmSearchEngine,
  board: BoardState,
  hardTimeMs: number | undefined,
  needsForcedWinCheck: boolean,
): BlackNodeResolution {
  if (!needsForcedWinCheck) {
    const choice = chooseHardMove(engine, board, "black", hardTimeMs);
    return {
      position: choice.position,
      positionStr: choice.positionStr,
      forcedWinKind: null,
      forcedWinSequenceStr: null,
    };
  }
  const result = checkForcedWin(engine, board, "black", hardTimeMs);
  return {
    position: result.chosenMove,
    positionStr: result.chosenMoveStr,
    forcedWinKind: result.forcedWinKind,
    forcedWinSequenceStr: result.forcedWinSequenceStr,
  };
}

/** dumpBookSink が渡されていれば、black ノードの情報を1件記録する。 */
function recordBlackBookDumpNode(
  sink: BlackBookDumpNode[] | undefined,
  engine: WasmSearchEngine,
  board: BoardState,
  route: string,
  ply: 5 | 7,
  movesUpToHere: string[],
  resolution: BlackNodeResolution,
): void {
  if (!sink) {
    return;
  }
  const survivorMoves =
    resolution.forcedWinKind === null
      ? null
      : findSurvivorMoves(engine, board, "black", resolution.position)
          .survivors;
  sink.push({
    canonicalKey: canonicalKey(board, "black"),
    route,
    ply,
    movesUpToHere,
    blackMove: resolution.positionStr,
    forcedWinKind: resolution.forcedWinKind,
    forcedWinSequenceStr: resolution.forcedWinSequenceStr,
    survivorMoves,
  });
}

/**
 * ルート集合（26珠型）から「チェック粒度」タスク（white6着手後・黒番の局面）を
 * すべて構築する。ルートごとに white4 の攻め側フィルタ候補ごとに black5 を1回、
 * その黒5候補ごとに white6 の攻め側フィルタ候補を展開する（Phase1/2 は直列実行。
 * 並列化は black7 のチェック粒度=Phase3 側で行う設計）。
 */
export function buildBlackCheckTasks(
  engine: WasmSearchEngine,
  routes: RouteRoot[],
  opts: {
    white4Budget: AttackerFilterBudget;
    white6Budget: AttackerFilterBudget;
    hardTimeMs?: number;
    randomSeed: number;
    /**
     * 指定すると black5 ノードについても強制勝ちチェック（VCF/VCT）を行い、
     * トラップ検出時は生存手導出まで実行して収集する。
     * 未指定時は従来どおり chooseHardMove のみ（軽量）。
     */
    dumpBookSink?: BlackBookDumpNode[];
  },
): BlackCheckLineTask[] {
  const tasks: BlackCheckLineTask[] = [];
  let taskId = 0;
  const dumpBook = opts.dumpBookSink !== undefined;

  for (const route of routes) {
    const [black1, white2, black3] = route.positions;
    const board0 = createEmptyBoard();
    board0[black1.row]![black1.col] = "black";
    board0[white2.row]![white2.col] = "white";
    board0[black3.row]![black3.col] = "black";

    const candidates4 = candidateRanking(engine, board0, "white");
    const white4Candidates = dedupByResultingCanonicalKey(
      board0,
      "white",
      selectAttackerMoves({
        board: board0,
        color: "white",
        candidates: candidates4,
        topK: opts.white4Budget.maxTotal,
        maxTotal: opts.white4Budget.maxTotal,
        randomSlotCount: randomSlotCountFor(opts.white4Budget.maxTotal),
        randomSeed: opts.randomSeed,
      }),
    );

    for (const white4Entry of white4Candidates) {
      const white4Str = formatMove(white4Entry.position);
      const boardAfterWhite4 = applyMove(board0, white4Entry.position, "white");

      const black5 = resolveBlackNode(
        engine,
        boardAfterWhite4,
        opts.hardTimeMs,
        dumpBook,
      );
      recordBlackBookDumpNode(
        opts.dumpBookSink,
        engine,
        boardAfterWhite4,
        route.name,
        5,
        [formatMove(black1), formatMove(white2), formatMove(black3), white4Str],
        black5,
      );
      const boardAfterBlack5 = applyMove(
        boardAfterWhite4,
        black5.position,
        "black",
      );

      const candidates6 = candidateRanking(engine, boardAfterBlack5, "white");
      const white6Candidates = dedupByResultingCanonicalKey(
        boardAfterBlack5,
        "white",
        selectAttackerMoves({
          board: boardAfterBlack5,
          color: "white",
          candidates: candidates6,
          topK: opts.white6Budget.maxTotal,
          maxTotal: opts.white6Budget.maxTotal,
          randomSlotCount: randomSlotCountFor(opts.white6Budget.maxTotal),
          randomSeed: opts.randomSeed,
        }),
      );

      for (const white6Entry of white6Candidates) {
        const white6Str = formatMove(white6Entry.position);
        const boardAfterWhite6 = applyMove(
          boardAfterBlack5,
          white6Entry.position,
          "white",
        );

        tasks.push({
          taskId: taskId++,
          route,
          moveStrs: [
            formatMove(black1),
            formatMove(white2),
            formatMove(black3),
            white4Str,
            black5.positionStr,
            white6Str,
          ],
          white4Provenance: white4Entry.provenance,
          white6Provenance: white6Entry.provenance,
          boardAfterWhite6,
        });
      }
    }
  }

  return tasks;
}
