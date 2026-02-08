<script setup lang="ts">
/**
 * CPU対戦記録ダイアログ
 *
 * 難易度別統計と直近の対戦記録を表示
 */

import { computed, ref } from "vue";

import { useAppStore } from "@/stores/appStore";
import { useCpuRecordStore } from "@/stores/cpuRecordStore";
import type { BattleResult, CpuDifficulty } from "@/types/cpu";

const appStore = useAppStore();
const cpuRecordStore = useCpuRecordStore();

const dialogRef = ref<HTMLDialogElement | null>(null);

// 難易度ラベル
const difficultyLabels: Record<CpuDifficulty, string> = {
  beginner: "かんたん",
  easy: "やさしい",
  medium: "ふつう",
  hard: "むずかしい",
};

// 結果ラベル
const resultLabels: Record<BattleResult, string> = {
  win: "勝ち",
  lose: "負け",
  draw: "引分",
};

// 結果クラス
const resultClasses: Record<BattleResult, string> = {
  win: "result-win",
  lose: "result-lose",
  draw: "result-draw",
};

// 日付フォーマット
function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// 統計を1行4列で表示
const allStats = computed(() => cpuRecordStore.allStats);

// 振り返りを開く
function handleOpenReview(recordId: string): void {
  dialogRef.value?.close();
  appStore.openCpuReview(recordId);
}

// 閉じる
function handleClose(): void {
  dialogRef.value?.close();
}

// メソッドをexpose
defineExpose({
  showModal: () => dialogRef.value?.showModal(),
  close: () => dialogRef.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="record-dialog"
  >
    <div class="dialog-content">
      <header class="dialog-header">
        <h2 class="dialog-title">対戦記録</h2>
        <button
          type="button"
          class="close-button"
          @click="handleClose"
        >
          ×
        </button>
      </header>

      <section class="stats-section">
        <h3 class="section-title">難易度別成績</h3>
        <div class="stats-grid">
          <div
            v-for="stat in allStats"
            :key="stat.difficulty"
            class="stats-card"
          >
            <div class="stats-label">
              {{ difficultyLabels[stat.difficulty] }}
            </div>
            <div class="stats-value">
              <span class="wins">{{ stat.wins }}勝</span>
              <span class="losses">{{ stat.losses }}敗</span>
              <span
                v-if="stat.draws > 0"
                class="draws"
              >
                {{ stat.draws }}分
              </span>
            </div>
          </div>
        </div>
      </section>

      <section class="recent-section">
        <h3 class="section-title">直近の対戦</h3>
        <div
          v-if="cpuRecordStore.recentRecords.length === 0"
          class="no-records"
        >
          対戦記録がありません
        </div>
        <ul
          v-else
          class="recent-list"
        >
          <li
            v-for="record in cpuRecordStore.recentRecords"
            :key="record.id"
            class="recent-item"
          >
            <span class="record-date">{{ formatDate(record.timestamp) }}</span>
            <span class="record-difficulty">
              {{ difficultyLabels[record.difficulty] }}
            </span>
            <span
              class="record-result"
              :class="resultClasses[record.result]"
            >
              {{ resultLabels[record.result] }}
            </span>
            <span class="record-moves">{{ record.moves }}手</span>
            <button
              v-if="record.moveHistory"
              class="review-button"
              @click="handleOpenReview(record.id)"
            >
              振り返り
            </button>
          </li>
        </ul>
      </section>
    </div>
  </dialog>
</template>

<style scoped>
.record-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: var(--size-24);
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-500);
  height: var(--size-350);
  overflow: hidden;

  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out,
    overlay 0.15s ease-out allow-discrete,
    display 0.15s ease-out allow-discrete;

  &[open] {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }

  &::backdrop {
    background: rgba(0, 0, 0, 0.5);
    transition:
      opacity 0.15s ease-out,
      overlay 0.15s ease-out allow-discrete,
      display 0.15s ease-out allow-discrete;
  }

  &[open]::backdrop {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }
}

.dialog-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
  overflow-y: auto;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-title {
  margin: 0;
  font-size: var(--size-20);
  font-weight: 500;
  color: var(--color-text-primary);
}

.close-button {
  background: none;
  border: none;
  font-size: var(--size-24);
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: var(--size-4);
  line-height: 1;
  transition: color 0.2s;

  &:hover {
    color: var(--color-text-primary);
  }
}

.section-title {
  margin: 0 0 var(--size-10) 0;
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.stats-section {
  display: flex;
  flex-direction: column;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--size-6);
}

.stats-card {
  background: var(--color-background-secondary);
  border-radius: var(--size-8);
  padding: var(--size-6);
  text-align: center;
}

.stats-label {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
  margin-bottom: var(--size-4);
}

.stats-value {
  font-size: var(--size-12);
  font-weight: 500;
  display: flex;
  justify-content: center;
  gap: var(--size-6);
}

.wins {
  color: var(--color-fubuki-primary);
}

.losses {
  color: var(--color-miko-primary);
}

.draws {
  color: var(--color-text-secondary);
}

.recent-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.no-records {
  text-align: center;
  color: var(--color-text-secondary);
  font-size: var(--size-14);
  padding: var(--size-16);
}

.recent-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
  overflow-y: auto;
  max-height: var(--size-150);
}

.recent-item {
  display: flex;
  align-items: center;
  gap: var(--size-10);
  padding: var(--size-8);
  background: var(--color-background-secondary);
  border-radius: var(--size-6);
  font-size: var(--size-12);
}

.record-date {
  color: var(--color-text-secondary);
  min-width: var(--size-40);
}

.record-difficulty {
  flex: 1;
  color: var(--color-text-primary);
}

.record-result {
  font-weight: 500;
  min-width: var(--size-40);
  text-align: center;
}

.result-win {
  color: var(--color-fubuki-primary);
}

.result-lose {
  color: var(--color-miko-primary);
}

.result-draw {
  color: var(--color-text-secondary);
}

.record-moves {
  color: var(--color-text-secondary);
  min-width: var(--size-40);
  text-align: right;
}

.review-button {
  padding: var(--size-2) var(--size-6);
  background: var(--color-fubuki-primary);
  border: none;
  border-radius: var(--size-4);
  font-size: var(--size-10);
  font-weight: 500;
  color: white;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
}
</style>
