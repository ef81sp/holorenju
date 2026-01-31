<script setup lang="ts">
/**
 * CPU対戦ステータス表示
 *
 * 手数、ターン、思考中状態を表示
 */

import { computed } from "vue";

import { useCpuGameStore } from "@/stores/cpuGameStore";

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
</style>
