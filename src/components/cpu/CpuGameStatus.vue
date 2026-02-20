<script setup lang="ts">
/**
 * CPU対戦ステータス表示
 *
 * 手数、ターン、思考中状態を表示
 */

import { computed, ref } from "vue";

import { useCpuGameStore } from "@/stores/cpuGameStore";
import { DIFFICULTY_ARIA_LABELS, DIFFICULTY_LABELS } from "@/types/cpu";

// 座標を棋譜形式に変換
function formatPosition(row: number, col: number): string {
  const colLetter = String.fromCharCode("A".charCodeAt(0) + col);
  const rowNumber = 15 - row;
  return `${colLetter}${rowNumber}`;
}

const cpuGameStore = useCpuGameStore();

// Props
interface Props {
  compact?: boolean;
}

withDefaults(defineProps<Props>(), {
  compact: false,
});

const difficultyLabel = computed(
  () => DIFFICULTY_LABELS[cpuGameStore.difficulty] ?? cpuGameStore.difficulty,
);

const difficultyAriaLabel = computed(
  () =>
    DIFFICULTY_ARIA_LABELS[cpuGameStore.difficulty] ?? cpuGameStore.difficulty,
);

const turnLabel = computed(() => {
  if (cpuGameStore.isPlayerTurn) {
    return "あなたの番";
  }
  return "相手の番";
});

const turnColor = computed(() =>
  cpuGameStore.currentTurn === "black" ? "●" : "○",
);

// 棋譜表示用
const formattedMoves = computed(() =>
  cpuGameStore.moveHistory.map((pos) => formatPosition(pos.row, pos.col)),
);

// コピー機能
const isCopied = ref(false);

async function handleCopy(): Promise<void> {
  if (cpuGameStore.moveHistory.length === 0) {
    return;
  }
  const notation = formattedMoves.value.join(" ");
  await navigator.clipboard.writeText(notation);
  isCopied.value = true;
  setTimeout(() => {
    isCopied.value = false;
  }, 1500);
}
</script>

<template>
  <div :class="['cpu-game-status', { compact }]">
    <div class="status-row">
      <span class="status-label">難易度</span>
      <span
        class="status-value"
        :aria-label="difficultyAriaLabel"
      >
        {{ difficultyLabel }}
      </span>
    </div>
    <div class="status-row">
      <span class="status-label">手数</span>
      <span class="status-value">{{ cpuGameStore.moveCount }}</span>
    </div>
    <div class="status-row turn-row">
      <span class="status-label">ターン</span>
      <span class="status-value">
        <span
          class="turn-stone"
          :class="{ white: cpuGameStore.currentTurn === 'white' }"
        >
          {{ turnColor }}
        </span>
        {{ turnLabel }}
      </span>
    </div>
  </div>

  <!-- 棋譜カード -->
  <div class="move-history-card">
    <div class="section-header">
      <h4 class="section-title">棋譜</h4>
      <button
        v-if="cpuGameStore.moveHistory.length > 0"
        class="copy-button"
        @click="handleCopy"
      >
        {{ isCopied ? "✓" : "コピー" }}
      </button>
    </div>
    <div
      v-if="cpuGameStore.moveHistory.length === 0"
      class="empty-history"
    >
      まだ着手がありません
    </div>
    <ol
      v-else
      class="move-history-list"
    >
      <li
        v-for="(move, index) in formattedMoves"
        :key="index"
        class="move-item"
        :class="{ black: index % 2 === 0, white: index % 2 === 1 }"
      >
        {{ move }}
      </li>
    </ol>
  </div>
</template>

<style scoped>
.cpu-game-status {
  display: flex;
  flex-direction: column;
  gap: var(--size-10);
  padding: var(--size-12);
  background: var(--color-background-secondary);
  border-radius: var(--size-8);
}

.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--size-8);
}

.status-label {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.status-value {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
}

.turn-row .status-value {
  display: flex;
  align-items: center;
  gap: var(--size-4);
}

.turn-stone {
  font-size: var(--size-16);
}

.turn-stone.white {
  color: #888;
}

/* コンパクトモード: 横並びテーブル */
.compact {
  flex-direction: row;
  gap: 0;
  padding: var(--size-8);
}

.compact .status-row {
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2);
}

.compact .status-row:not(:last-of-type) {
  border-right: 1px solid var(--color-border-light);
}

.compact .status-label {
  font-size: var(--size-10);
}

.compact .status-value {
  font-size: var(--size-12);
}

.move-history-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: var(--size-12);
  background: var(--color-background-secondary);
  border-radius: var(--size-8);
  min-height: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--size-8);
}

.section-title {
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-secondary);
  margin: 0;
}

.copy-button {
  font-size: var(--size-10);
  padding: var(--size-2) var(--size-6);
  background: var(--color-background-tertiary);
  border: 1px solid var(--color-border-light);
  border-radius: var(--size-4);
  cursor: pointer;
  transition: background 0.2s;
}

.copy-button:hover {
  background: var(--color-background-hover);
}

.empty-history {
  font-size: var(--size-11);
  color: var(--color-text-tertiary);
  text-align: center;
}

.move-history-list {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: var(--size-2) var(--size-6);
  overflow-y: auto;
  margin: 0;
  padding-left: var(--size-20);
  font-size: var(--size-10);
  min-height: 0;
}

.move-item {
  padding: var(--size-1) var(--size-4);
  border-radius: var(--size-2);
}

.move-item.black {
  background: var(--color-stone-black);
  color: var(--color-stone-white);
}

.move-item.white {
  background: var(--color-stone-white);
  color: var(--color-stone-black);
  border: 1px solid var(--color-border-light);
}
</style>
