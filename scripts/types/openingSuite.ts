/**
 * 開局スイート（bench-precision-2026-09-04.md §2.2）の JSON 型。
 *
 * 生成側は scripts/gen-opening-suite.ts、消費側は commit-bench / weight-bench の
 * `--openings=<file>`（scripts/lib/openingSuiteLoader.ts でパース）。
 */

/** スイート内の 1 開局。moves は黒から交互の擬似手順（棋譜表記、空白区切り）。 */
export interface OpeningSuiteEntry {
  id: string;
  /** 根珠型名（復元できなければ null） */
  root: string | null;
  /** 親キー（白 3 石の表記をソートして空白連結） */
  parent: string;
  /** 例: "H8 I9 G7 H9 I7 G9 J8"（パースは src/logic/gameRecordParser.ts の parseMove） */
  moves: string;
  /** 生成時の白番 root スコア */
  score: number;
}

/** スイート JSON の消費側が依存する最小形（生成側はこれに加えてメタを持つ）。 */
export interface OpeningSuiteFile {
  version: number;
  openings: OpeningSuiteEntry[];
}

/** ベンチ結果 JSON の config.openings に記録する開局スイート情報。 */
export interface OpeningSuiteConfig {
  /** CLI に渡されたパス（相対ならリポジトリルート基準） */
  file: string;
  version: number;
  /** スイート内の開局数（offset 適用前） */
  count: number;
  /** `--opening-offset` の値 */
  offset: number;
}

/** 生成時の均衡フィルタ設定（gen-opening-suite.ts の CLI オプションに対応） */
export interface OpeningSuiteFilter {
  /** 白番 root スコアの |score| しきい値 */
  scoreAbsMax: number;
  /** root スコア探索の maxNodes */
  nodes: number;
  /** root スコア探索の depth */
  depth: number;
  /** 親（白 3 石構成）ごとの上限件数 */
  parentCap: number;
  /** 層化順序のシャッフル seed */
  seed: number;
}

/** 生成時の候補数・棄却数の集計 */
export interface OpeningSuiteStats {
  /** 7 石・白番の候補総数 */
  candidates: number;
  /** しきい値で分類した候補数（--from-raw では全候補） */
  evaluated: number;
  rejectedByScore: number;
  rejectedByWhiteWin: number;
  rejectedByBlackWin: number;
  /** 採用可能数（層化・target 前）。worker モードでは null */
  eligible: number | null;
  /** 最終採用数（openings.length） */
  accepted: number;
}

/** 生成側が書き出す完全形（消費側は OpeningSuiteFile だけに依存する）。 */
export interface GeneratedOpeningSuiteFile extends OpeningSuiteFile {
  generatedAt: string;
  gitRev: string;
  /** opening-book-hard.json の weightGeneration */
  weightGeneration: string | null;
  filter: OpeningSuiteFilter;
  stats: OpeningSuiteStats;
}
