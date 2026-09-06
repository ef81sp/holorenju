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
  /** v2: ply-check の設定（v1 は無し） */
  plyCheck?: OpeningSuitePlyCheckFilter;
  /** v2: 負側（黒有利）を含める最小比率（v1 は無し） */
  negativeRatioMin?: number;
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
  /** v2: ply-check の集計 */
  plyCheck?: OpeningSuitePlyCheckStats;
  /** v2: 採用分の根 score 符号比率 */
  sign?: OpeningSuiteSignStats;
  /** v2: 採用分の親分布 */
  parents?: OpeningSuiteParentStats;
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

/** v2 の ply-check（採用可能候補を hard 実機で N 手進める整合フィルタ）の設定 */
export interface OpeningSuitePlyCheckFilter {
  /** 進める手数（白から交互） */
  plies: number;
  /** 各 ply の |score| しきい値 */
  plyScoreAbsMax: number;
  nodes: number;
  depth: number;
  timeLimitMs: number;
}

/** ply-check の集計 */
export interface OpeningSuitePlyCheckStats {
  /** ply-check を掛けた候補数（= 根フィルタの採用可能数） */
  checked: number;
  passed: number;
  /** i 番目（0 始まり）= ply i+1 で初めて |score| を超えて棄却された数 */
  rejectedByPlyScore: number[];
  /** 途中終局（五連 / 禁手 / 着手なし）で棄却された数 */
  rejectedByTerminal: number;
  rejectedIncomplete: number;
  /** 根 |score| <= scoreAbsMax なのに N 手以内に |score| > flipScoreAbsMin になった数 */
  horizonFlips: number;
  flipScoreAbsMin: number;
}

/** 根 score の符号（白視点。負 = 黒有利）の比率 */
export interface OpeningSuiteSignStats {
  negative: number;
  nonNegative: number;
  negativeRatio: number;
}

/** 親（白 3 石構成）の分布 */
export interface OpeningSuiteParentStats {
  count: number;
  /** "親あたり件数" → その件数の親の数 */
  histogram: Record<string, number>;
}
