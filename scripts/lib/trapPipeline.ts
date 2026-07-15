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

import { applyMove } from "@/logic/cpu/core/boardUtils";
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

import { chooseHardMove } from "./forcedWinCheck";
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

function candidateRanking(
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
  },
): CheckLineTask[] {
  const tasks: CheckLineTask[] = [];
  let taskId = 0;

  for (const route of routes) {
    const [black1, white2, black3] = route.positions;
    const board0 = createEmptyBoard();
    board0[black1.row]![black1.col] = "black";
    board0[white2.row]![white2.col] = "white";
    board0[black3.row]![black3.col] = "black";

    const white4 = chooseHardMove(engine, board0, "white", opts.hardTimeMs);
    const boardAfterWhite4 = applyMove(board0, white4.position, "white");

    const candidates4 = candidateRanking(engine, boardAfterWhite4, "black");
    const black5Candidates = selectAttackerMoves({
      board: boardAfterWhite4,
      color: "black",
      candidates: candidates4,
      topK: opts.black5Budget.maxTotal,
      maxTotal: opts.black5Budget.maxTotal,
      randomSlotCount: randomSlotCountFor(opts.black5Budget.maxTotal),
      randomSeed: opts.randomSeed,
    });

    for (const black5Entry of black5Candidates) {
      const boardAfterBlack5 = applyMove(
        boardAfterWhite4,
        black5Entry.position,
        "black",
      );

      const white6 = chooseHardMove(
        engine,
        boardAfterBlack5,
        "white",
        opts.hardTimeMs,
      );
      const boardAfterWhite6 = applyMove(
        boardAfterBlack5,
        white6.position,
        "white",
      );

      const candidates6 = candidateRanking(engine, boardAfterWhite6, "black");
      const black7Candidates = selectAttackerMoves({
        board: boardAfterWhite6,
        color: "black",
        candidates: candidates6,
        topK: opts.black7Budget.maxTotal,
        maxTotal: opts.black7Budget.maxTotal,
        randomSlotCount: randomSlotCountFor(opts.black7Budget.maxTotal),
        randomSeed: opts.randomSeed,
      });

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
