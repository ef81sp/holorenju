/**
 * Transposition Table（置換表）
 *
 * 同一局面の重複計算を回避するためのキャッシュ。
 * Alpha-Beta探索において、異なる手順で同じ局面に到達した場合に
 * 以前の計算結果を再利用できる。
 */

import type { Position } from "@/types/game";

/**
 * TTエントリのスコアタイプ
 *
 * - EXACT: 正確な評価値（Alpha < score < Beta）
 * - LOWER_BOUND: 下限値（Beta cutoff発生）
 * - UPPER_BOUND: 上限値（Alpha cutoff発生）
 */
export type ScoreType = "EXACT" | "LOWER_BOUND" | "UPPER_BOUND";

/**
 * Transposition Tableエントリ
 */
export interface TTEntry {
  /** 盤面ハッシュ（衝突検出用） */
  hash: bigint;
  /** 評価スコア */
  score: number;
  /** 探索深度 */
  depth: number;
  /** スコアタイプ */
  type: ScoreType;
  /** この局面での最善手（Move Ordering用） */
  bestMove: Position | null;
  /** 世代番号（古いエントリ置換用） */
  generation: number;
}

/**
 * Transposition Table
 *
 * MapベースのLRU的実装。
 * エントリ数が上限を超えた場合、古い世代のエントリを優先的に置換。
 */
export class TranspositionTable {
  private table: Map<bigint, TTEntry>;
  private maxSize: number;
  private currentGeneration: number;

  /**
   * @param maxSize 最大エントリ数（デフォルト: 2000000）
   */
  constructor(maxSize = 2000000) {
    this.table = new Map();
    this.maxSize = maxSize;
    this.currentGeneration = 0;
  }

  /**
   * 世代を進める（新しい探索開始時に呼び出し）
   */
  newGeneration(): void {
    this.currentGeneration++;
  }

  /**
   * エントリを検索
   *
   * @param hash 盤面ハッシュ
   * @returns エントリ（存在しない場合はnull）
   */
  probe(hash: bigint): TTEntry | null {
    const entry = this.table.get(hash);
    if (!entry) {
      return null;
    }

    // ハッシュ衝突チェック（追加の検証）
    if (entry.hash !== hash) {
      return null;
    }

    return entry;
  }

  /**
   * エントリを保存
   *
   * 置換戦略:
   * 1. 同じハッシュのエントリがない場合は常に保存
   * 2. 既存エントリがある場合:
   *    - 新しいエントリの深度が深い場合は置換
   *    - 既存エントリが古い世代の場合は置換
   *    - それ以外は既存エントリを維持
   *
   * @param hash 盤面ハッシュ
   * @param score 評価スコア
   * @param depth 探索深度
   * @param type スコアタイプ
   * @param bestMove 最善手
   */
  store(
    hash: bigint,
    score: number,
    depth: number,
    type: ScoreType,
    bestMove: Position | null,
  ): void {
    const existing = this.table.get(hash);

    if (existing) {
      // 置換判定（改良版）
      // - EXACT型は最も信頼性が高いので優先的に保存
      // - より深い探索結果を優先
      // - 同深度ならLOWER_BOUND/EXACTをUPPER_BOUNDより優先
      // - 2世代以上前のエントリは置換
      const shouldReplace =
        type === "EXACT" ||
        depth > existing.depth ||
        (depth === existing.depth && type !== "UPPER_BOUND") ||
        existing.generation < this.currentGeneration - 1;

      if (!shouldReplace) {
        return;
      }
    }

    // サイズ上限チェック
    if (this.table.size >= this.maxSize && !existing) {
      this.evictOldEntries();
    }

    const entry: TTEntry = {
      hash,
      score,
      depth,
      type,
      bestMove,
      generation: this.currentGeneration,
    };

    this.table.set(hash, entry);
  }

  /**
   * 古いエントリを削除
   *
   * 世代が古いエントリを優先的に削除する
   */
  private evictOldEntries(): void {
    const targetSize = Math.floor(this.maxSize * 0.75);
    const entriesToRemove: bigint[] = [];

    // 古い世代のエントリを収集
    for (const [hash, entry] of this.table) {
      if (entry.generation < this.currentGeneration) {
        entriesToRemove.push(hash);
        if (this.table.size - entriesToRemove.length <= targetSize) {
          break;
        }
      }
    }

    // 削除
    for (const hash of entriesToRemove) {
      this.table.delete(hash);
    }

    // それでも足りない場合は古い順に削除
    if (this.table.size > targetSize) {
      const iterator = this.table.keys();
      while (this.table.size > targetSize) {
        const result = iterator.next();
        if (result.done) {
          break;
        }
        this.table.delete(result.value);
      }
    }
  }

  /**
   * テーブルをクリア
   */
  clear(): void {
    this.table.clear();
    this.currentGeneration = 0;
  }

  /**
   * 現在のエントリ数を取得
   */
  get size(): number {
    return this.table.size;
  }

  /**
   * 統計情報を取得（デバッグ用）
   */
  getStats(): { size: number; generation: number; maxSize: number } {
    return {
      size: this.table.size,
      generation: this.currentGeneration,
      maxSize: this.maxSize,
    };
  }
}

/**
 * グローバルTransposition Tableインスタンス
 *
 * Worker内で使用するためシングルトンとして提供
 */
export const globalTT = new TranspositionTable();
