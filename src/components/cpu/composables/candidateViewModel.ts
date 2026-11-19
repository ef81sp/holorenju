/**
 * 振り返り評価パネル「候補手」カードの表示用データ
 *
 * - 最大 3 件（最善手・自分の手は必ず含む）。順位番号は探索結果の並び順のまま
 * - 最善との差を S/A/B/C ランクにする。数値差は読み上げ・ツールチップ用に残す
 *
 * @see docs/plans/review-right-panel-redesign-2026-11-19.md
 */

import type { Position } from "@/types/game";
import type { EvaluatedMove } from "@/types/review";

import { SHORT_LABELS } from "@/logic/forcedTypeLabels";
import { formatMove } from "@/logic/gameRecordParser";
import { formatCandidateDelta } from "@/logic/reviewCandidateDelta";
import {
  type CandidateGrade,
  gradeFromDelta,
  selectDisplayCandidates,
} from "@/logic/reviewCandidateDisplay";

export interface CandidateView {
  rank: number;
  position: Position;
  coord: string;
  /** 整形済み delta（境界値なら「≤」付き）。aria-label / title 用 */
  deltaLabel: string;
  /** searchScore が境界値（上限）か。基準候補は常に false */
  isBound: boolean;
  grade: CandidateGrade;
  kind: "best" | "actual" | "alt";
  isFukumi: boolean;
  fukumiDepth?: number;
  opponentForcedWinShort?: string;
}

const samePos = (a: Position, b: Position): boolean =>
  a.row === b.row && a.col === b.col;

/** 表示する候補カード（最大 3 件、元の順位順） */
export function buildCandidateViews(eval_: EvaluatedMove): CandidateView[] {
  const { candidates } = eval_;
  if (candidates.length === 0) {
    return [];
  }
  const best =
    candidates.find((c) => samePos(c.position, eval_.bestMove)) ??
    candidates[0];
  const bestSearchScore = best?.searchScore ?? 0;
  const views = candidates.map((c, idx): CandidateView => {
    let kind: CandidateView["kind"] = "alt";
    if (samePos(c.position, eval_.bestMove)) {
      kind = "best";
    } else if (samePos(c.position, eval_.position)) {
      kind = "actual";
    }
    const delta = c.searchScore - bestSearchScore;
    // 基準（最善）自身の delta は定義上 0 なので「≤」は付けない
    const isBound = c !== best && !c.scoreExact;
    return {
      rank: idx + 1,
      position: c.position,
      coord: formatMove(c.position),
      deltaLabel: formatCandidateDelta(delta, !isBound),
      isBound,
      grade: gradeFromDelta(delta),
      kind,
      isFukumi: c.isFukumi ?? false,
      fukumiDepth: c.fukumiDepth,
      opponentForcedWinShort: c.opponentForcedWin
        ? SHORT_LABELS[c.opponentForcedWin]
        : undefined,
    };
  });
  return selectDisplayCandidates(views, (v) => v.kind !== "alt");
}

function roleLabelOf(kind: CandidateView["kind"]): string {
  switch (kind) {
    case "best":
      return "最善手";
    case "actual":
      return "実際の手";
    case "alt":
      return "";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** 危〜 / フクミ の読み上げ（表示と同じく危が優先） */
function flagLabelOf(c: CandidateView): string {
  if (c.opponentForcedWinShort) {
    return `危${c.opponentForcedWinShort}`;
  }
  if (c.isFukumi) {
    return `フクミ${c.fukumiDepth ?? ""}`;
  }
  return "";
}

/** カードの読み上げ（順位・座標・役割・ランク・数値差・フラグ） */
export function candidateAriaLabel(c: CandidateView): string {
  return [
    `${c.rank}位`,
    c.coord,
    roleLabelOf(c.kind),
    `ランク${c.grade}`,
    `（最善比 ${c.deltaLabel}${c.isBound ? "・上限値" : ""}）`,
    flagLabelOf(c),
  ]
    .filter(Boolean)
    .join(" ");
}

/** カードのツールチップ（数値差） */
export function candidateTitle(c: CandidateView): string {
  return `最善比 ${c.deltaLabel}${c.isBound ? "（上限値・未確定）" : ""}`;
}
