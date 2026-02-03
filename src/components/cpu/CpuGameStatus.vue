<script setup lang="ts">
/**
 * CPU対戦ステータス表示
 *
 * 手数、ターン、思考中状態を表示
 */

import { computed, ref } from "vue";

import { useCpuGameStore } from "@/stores/cpuGameStore";

// 座標を棋譜形式に変換
function formatPosition(row: number, col: number): string {
  const colLetter = String.fromCharCode("A".charCodeAt(0) + col);
  const rowNumber = 15 - row;
  return `${colLetter}${rowNumber}`;
}

const cpuGameStore = useCpuGameStore();

// Props
interface Props {
  isThinking?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isThinking: false,
});

// 難易度のラベル
const difficultyLabels: Record<string, string> = {
  beginner: "かんたん",
  easy: "やさしい",
  medium: "ふつう",
  hard: "むずかしい",
};

const difficultyLabel = computed(
  () => difficultyLabels[cpuGameStore.difficulty] ?? cpuGameStore.difficulty,
);

const turnLabel = computed(() => {
  if (cpuGameStore.isPlayerTurn) {
    return "あなたの番";
  }
  return "CPUの番";
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
  <div class="cpu-game-status">
    <div class="status-row">
      <span class="status-label">難易度</span>
      <span class="status-value">{{ difficultyLabel }}</span>
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
    <div class="thinking-indicator">
      <span
        v-show="props.isThinking"
        class="thinking-dots"
      >
        考え中...
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
  flex: 1;
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

.thinking-indicator {
  display: flex;
  justify-content: center;
  padding-top: var(--size-8);
  border-top: 1px solid var(--color-border-light);
  min-height: var(--size-16);
}

.thinking-dots {
  font-size: var(--size-12);
  color: var(--color-primary);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
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
