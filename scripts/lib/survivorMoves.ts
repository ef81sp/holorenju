/**
 * トラップ検出時の生存手導出（opening-book-2026-07-16.md §1）。
 *
 * run1 の帰属分析（project_trap_mining 帰属分類）で使った手法をプロダクション化した
 * 共有ヘルパー。防御側（color）の局面で、実際に選ばれた手（actualMove）を除いた
 * PRECISE 候補上位から代替手を評価し、相手に強制勝ちを許さない手（生存手）を返す。
 *
 * aspirationMode=1（REVIEW_PROFILE_PRECISE 相当）を使う: mode=0 だと Zig 側
 * search.zig の preSearch 即決ロジック（params.aspiration_mode==0 のときのみ効く
 * 「唯一の緊急手」検出）に引っかかり、候補が1件しか返らないことがある
 * （trap-mining 帰属分析で発見）。
 */
import type { BoardState, Position } from "@/types/game";

import { applyMove, getOppositeColor } from "@/logic/cpu/core/boardUtils";
import {
  REVIEW_PROFILE_PRECISE,
  REVIEW_SEARCH_PARAMS,
} from "@/logic/cpu/review/reviewConstants";
import {
  encodeEvalOptions,
  WasmSearchEngine,
} from "@/logic/cpu/wasm/searchEngine";
import { formatMove } from "@/logic/gameRecordParser";

import {
  VCF_MAX_DEPTH,
  VCF_MAX_NODES,
  VCF_TIME_LIMIT_MS,
  VCT_MAX_DEPTH,
  VCT_MAX_NODES,
  VCT_TIME_LIMIT_MS,
} from "./forcedWinCheck";

const REVIEW_EVAL_FLAGS = encodeEvalOptions(
  REVIEW_SEARCH_PARAMS.evaluationOptions,
);

/** 代替手として評価する候補件数の既定値（プランの「白8候補 PRECISE 上位4〜5」）。 */
export const DEFAULT_SURVIVOR_ALT_COUNT = 5;

export interface SurvivorMovesResult {
  /** 検証した代替手（実際に選ばれた手を除く、PRECISE 候補上位）。 */
  candidatesChecked: string[];
  /** 強制勝ちが生じなかった手（生存手）。空配列なら全滅（彗星型）。 */
  survivors: string[];
}

/**
 * 候補ランキング（PRECISEプロファイル・aspirationMode=1）。
 * 彗星ルート個別対応（comet-mini-mining.ts）で white6 の代替候補取得にも
 * 再利用するため export する。
 */
export function candidateRankingPrecise(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
): Position[] {
  const result = engine.findBestMoveForReview(
    board,
    color,
    REVIEW_SEARCH_PARAMS.depth,
    REVIEW_PROFILE_PRECISE.timeLimit ?? 0,
    REVIEW_PROFILE_PRECISE.maxNodes,
    REVIEW_PROFILE_PRECISE.absoluteTimeLimit ?? 0,
    1, // aspirationMode=1: preSearch 即決回避（帰属分析で発見した必須設定）
    REVIEW_EVAL_FLAGS,
  );
  return result.candidates.map((c) => c.position);
}

function posKey(p: Position): string {
  return `${p.row},${p.col}`;
}

/**
 * board（color の手番）で actualMove 以外の代替手を評価し、相手（getOppositeColor(color)）
 * に強制勝ち（VCF∪VCT）を許さない生存手を返す。
 */
export function findSurvivorMoves(
  engine: WasmSearchEngine,
  board: BoardState,
  color: "black" | "white",
  actualMove: Position,
  altCount: number = DEFAULT_SURVIVOR_ALT_COUNT,
): SurvivorMovesResult {
  const ranked = candidateRankingPrecise(engine, board, color);
  const actualKey = posKey(actualMove);
  const altMoves = ranked
    .filter((p) => posKey(p) !== actualKey)
    .slice(0, altCount);

  const opponent = getOppositeColor(color);
  const candidatesChecked: string[] = [];
  const survivors: string[] = [];
  for (const alt of altMoves) {
    const altStr = formatMove(alt);
    candidatesChecked.push(altStr);
    const afterAlt = applyMove(board, alt, color);
    const vcf = engine.findVCFSequence(
      afterAlt,
      opponent,
      VCF_MAX_DEPTH,
      VCF_TIME_LIMIT_MS,
      VCF_MAX_NODES,
    );
    const forcedWin =
      vcf ??
      engine.findVCTSequence(
        afterAlt,
        opponent,
        VCT_MAX_DEPTH,
        VCT_TIME_LIMIT_MS,
        VCT_MAX_NODES,
        false,
      );
    if (!forcedWin) {
      survivors.push(altStr);
    }
  }
  return { candidatesChecked, survivors };
}
