/**
 * prospect コーパス（quiet 局面 + 空点プロスペクト特徴 + ラベル）の JSONL 行型。
 *
 * 生成: scripts/prospect-corpus.ts（scripts/lib/prospectCorpus.ts）
 * ラベル付与: scripts/rapfi/labelCorpus.ts（gitignore 対象。rapfiEval / dropped を足す）
 * 消費: scripts/prospect-texel.ts / scripts/prospect-anchor.ts
 *
 * docs/plans/eval-r4-2026-09-11.md §1〜§2（CorpusRow の一本化、source.kind 追加）。
 */

import type { Position } from "@/types/game";

/** 局面の出どころ。kifu=ベンチ棋譜、book=オープニングブック entries、prefix=開局スイートの先頭 n 手。 */
export type CorpusSourceKind = "kifu" | "book" | "prefix";

export type CorpusSide = "black" | "white";

export interface CorpusSource {
  kind: CorpusSourceKind;
  /** kifu: 棋譜 JSON のファイル名（日付を含む）。book/prefix: 入力 JSON のファイル名。 */
  file: string;
  /**
   * kifu: games 配列の index（`file#gameIdx` が k-fold のグループキー）。
   * book/prefix: 行ごとに一意な連番（1 局面 1 グループ）。
   */
  gameIdx: number;
  /** 局面の石数（= 手番までに置かれた手数）。 */
  ply: number;
  /** kifu: 珠型名 / 開局 id。prefix: 開局 id。book: 空文字。 */
  jushu: string;
}

export interface CorpusRow {
  /** 盤面キー `${boardToString(board)}|${stm}`（ブックと同形式。dedup・resume 用）。 */
  key: string;
  source: CorpusSource;
  /** 手番側の色。特徴・ラベルはすべてこの視点。 */
  stm: CorpusSide;
  black: Position[];
  white: Position[];
  /** extractProspectFeatures(stm, stmIsPerspective=1) の i32×34。 */
  features: number[];
  /** 勝敗ラベル（stm 視点 1 / 0.5 / 0）。book/prefix は 0.5 固定。 */
  outcome: number;
  /** ラベラーが付与する Rapfi 評価値（stm 視点）。 */
  rapfiEval?: number;
  /** ラベラー側の破棄行マーカー（存在すれば学習対象から除外）。 */
  dropped?: string;
}
