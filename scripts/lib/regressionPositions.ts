/**
 * 回帰ゲート局面のレジストリ（scripts/regression-positions.ts の実行部から分離）。
 *
 * 実戦・振り返りで「CPU が強制負けにつながる手を選んだ」ことが判明するたびに
 * ここへ追加していく（拡張前提のレジストリ）。
 *
 * 消費側:
 * - scripts/regression-positions.ts: 各局面で hard 実機経路の手を検証する。
 * - scripts/prospect-corpus.ts: 学習コーパスから同一局面を除外する
 *   （テスト衛生。docs/plans/eval-r4-2026-09-11.md §1）。
 */

import type { BoardState, StoneColor } from "@/types/game";

import { createBoardFromRecord } from "@/logic/gameRecordParser";

export type RegressionSide = Exclude<StoneColor, null>;

export interface RegressionPosition {
  /** 一意なID（ログ・--only フィルタで使用） */
  id: string;
  /** 局面までの棋譜（開始局面からの手順、スペース区切り） */
  kifuPrefix: string;
  /** kifuPrefix 終了時点の手番（kifuPrefix の手数と矛盾していないか実行時に検証する） */
  sideToMove: RegressionSide;
  /** どういう局面で何が問題だったか */
  description: string;
  /** 出典（実戦棋譜全体・発覚日など） */
  source: string;
}

export const REGRESSION_POSITIONS: readonly RegressionPosition[] = [
  {
    id: "p6-white-j6-collapse",
    kifuPrefix: "H8 I9 I8 G8 H7 G6 I7",
    sideToMove: "white",
    description:
      "白8手目 J6 が敗着。J6 を打った後、黒に11手の VCT（強制勝ち手順）が生じる。" +
      "現状はこの局面がブックに未収録（book miss）のため、hard 生探索経路" +
      "（texel-r2 の eval 挙動）を検証している。将来ブックがこの局面をカバーすると、" +
      "検証対象がブック手に切り替わる。",
    source:
      "2026-07-15 ボス実戦棋譜（黒=人間の勝ち）: " +
      "H8 I9 I8 G8 H7 G6 I7 J6 G7 J7 H6 H9 G5 F4 H4 H5 E7 F7 F6 I3 D8",
  },
  {
    id: "p7-black-i7-collapse",
    kifuPrefix: "H8 I9 F6 J9 F7 I8",
    sideToMove: "black",
    description:
      "黒7手目 I7 が敗着（黒番採掘 severity-A）。I7 を打った後、白に7手の VCT" +
      "（強制勝ち手順 K9 L9 G9 H9 K10 L11 G6）が生じる。オープニングブックに" +
      "個別対応済み（生存手 F9・annotation収録）で、この回帰チェックはブック" +
      "経由で強制勝ちを許さない手が選ばれ PASS することを固定する（v2: Rapfi" +
      "誘導化により play は安全検証済みの F5 へ切り替わっているが、F9 も" +
      "annotation には残っている）。",
    source:
      "2026-07-16 黒番採掘 run1（route=彗星）: " +
      "bench-results/opening-traps-black-run1.jsonl",
  },
];

/**
 * kifuPrefix を再生して局面を返す。棋譜から算出した手番が sideToMove と
 * 矛盾していれば例外（レジストリの記載ミス検出）。
 */
export function regressionPositionBoard(pos: RegressionPosition): {
  board: BoardState;
  sideToMove: RegressionSide;
} {
  const { board, nextColor } = createBoardFromRecord(pos.kifuPrefix);
  if (nextColor !== pos.sideToMove) {
    throw new Error(
      `${pos.id}: kifuPrefix の手数と sideToMove が矛盾しています` +
        `（棋譜から算出した手番=${nextColor}, 指定=${pos.sideToMove}）`,
    );
  }
  return { board, sideToMove: pos.sideToMove };
}
