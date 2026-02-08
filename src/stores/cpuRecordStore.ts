/**
 * CPU対戦記録ストア
 *
 * localStorage永続化で対戦記録を管理
 */

import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

import {
  CPU_DIFFICULTIES,
  type BattleResult,
  type CpuBattleRecord,
  type CpuBattleStats,
  type CpuDifficulty,
} from "@/types/cpu";

/** localStorageのキー */
const STORAGE_KEY = "holorenju-cpu-records";
/** 最大記録数 */
const MAX_RECORDS = 100;

/**
 * 一意なIDを生成
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * localStorageから記録を読み込み
 */
function loadRecordsFromStorage(): CpuBattleRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as CpuBattleRecord[];
    }
  } catch {
    console.warn("Failed to load CPU battle records from localStorage");
  }
  return [];
}

/**
 * localStorageに記録を保存
 */
function saveRecordsToStorage(records: CpuBattleRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    console.warn("Failed to save CPU battle records to localStorage");
  }
}

export const useCpuRecordStore = defineStore("cpuRecord", () => {
  // ========== State ==========
  /** 対戦記録 */
  const records = ref<CpuBattleRecord[]>(loadRecordsFromStorage());

  // ========== Computed ==========
  /** 直近10件の記録 */
  const recentRecords = computed(() => records.value.slice(0, 10));

  /** 全難易度の統計 */
  const allStats = computed<CpuBattleStats[]>(() =>
    CPU_DIFFICULTIES.map((diff) => getStatsByDifficulty(diff)),
  );

  /** 振り返り可能なレコード（moveHistoryが存在するもの） */
  const reviewableRecords = computed(() =>
    records.value.filter((r) => r.moveHistory),
  );

  // ========== Watch ==========
  // 記録変更時にlocalStorageへ保存
  watch(
    records,
    (newRecords) => {
      saveRecordsToStorage(newRecords);
    },
    { deep: true },
  );

  // ========== Actions ==========

  /** 棋譜を保持する最大件数 */
  const MAX_MOVE_HISTORY_RECORDS = 50;

  /**
   * 記録を追加
   */
  function addRecord(
    difficulty: CpuDifficulty,
    playerFirst: boolean,
    result: BattleResult,
    moves: number,
    moveHistory?: string,
  ): void {
    const record: CpuBattleRecord = {
      id: generateId(),
      timestamp: Date.now(),
      difficulty,
      playerFirst,
      result,
      moves,
      moveHistory,
    };

    // 先頭に追加
    records.value.unshift(record);

    // 最大数を超えたら古い記録を削除
    if (records.value.length > MAX_RECORDS) {
      records.value = records.value.slice(0, MAX_RECORDS);
    }

    // 51件目以降のmoveHistoryを削除して容量節約
    for (let i = MAX_MOVE_HISTORY_RECORDS; i < records.value.length; i++) {
      const rec = records.value[i];
      if (rec?.moveHistory) {
        rec.moveHistory = undefined;
      }
    }
  }

  /**
   * 難易度別の統計を取得
   */
  function getStatsByDifficulty(difficulty: CpuDifficulty): CpuBattleStats {
    const filtered = records.value.filter((r) => r.difficulty === difficulty);

    const wins = filtered.filter((r) => r.result === "win").length;
    const losses = filtered.filter((r) => r.result === "lose").length;
    const draws = filtered.filter((r) => r.result === "draw").length;
    const totalGames = filtered.length;
    const winRate = totalGames > 0 ? wins / totalGames : 0;

    return {
      difficulty,
      wins,
      losses,
      draws,
      totalGames,
      winRate,
    };
  }

  /**
   * 記録をクリア
   */
  function clearRecords(): void {
    records.value = [];
  }

  return {
    // State
    records,
    // Computed
    recentRecords,
    reviewableRecords,
    allStats,
    // Actions
    addRecord,
    getStatsByDifficulty,
    clearRecords,
  };
});
