<script setup lang="ts">
/**
 * 振り返り評価ステータス表示
 *
 * 評価中はプログレスバー、完了後は精度とミス数サマリー
 */

import { ref } from "vue";
import ContentCopyIcon from "@/assets/icons/content_copy.svg?component";
import CheckIcon from "@/assets/icons/check.svg?component";
import {
  DIFFICULTY_ARIA_LABELS,
  DIFFICULTY_LABELS,
  type CpuDifficulty,
} from "@/types/cpu";

interface Props {
  isEvaluating: boolean;
  completedCount: number;
  totalCount: number;
  accuracy: number | null;
  criticalErrors: number;
  difficulty: CpuDifficulty;
  moveCount: number;
  playerFirst: boolean;
  moveHistory: string | null;
}

const props = defineProps<Props>();

/** コピー済みフィードバック */
const copied = ref(false);

async function copyMoveHistory(): Promise<void> {
  if (!props.moveHistory) {
    return;
  }
  await navigator.clipboard.writeText(props.moveHistory);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 1500);
}
</script>

<template>
  <div class="review-status">
    <!-- 対局情報 -->
    <div class="game-info">
      <span
        class="info-item"
        :aria-label="DIFFICULTY_ARIA_LABELS[props.difficulty]"
      >
        {{ DIFFICULTY_LABELS[props.difficulty] }}
      </span>
      <span class="info-item">{{ props.playerFirst ? "先手" : "後手" }}</span>
      <span class="info-item">{{ props.moveCount }}手</span>
      <button
        v-if="props.moveHistory"
        class="copy-button"
        :class="{ copied }"
        aria-label="棋譜をコピー"
        @click="copyMoveHistory"
      >
        <ContentCopyIcon v-if="!copied" />
        <CheckIcon v-else />
      </button>
    </div>

    <!-- 評価中 -->
    <div
      v-if="props.isEvaluating"
      class="evaluating"
    >
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{
            width: `${props.totalCount > 0 ? (props.completedCount / props.totalCount) * 100 : 0}%`,
          }"
        />
      </div>
      <span class="progress-text">
        解析中... ({{ props.completedCount }}/{{ props.totalCount }})
      </span>
    </div>

    <!-- 評価完了 -->
    <div
      v-else-if="props.accuracy !== null"
      class="completed"
    >
      <div class="accuracy">
        <span class="accuracy-label">精度</span>
        <span class="accuracy-value">{{ props.accuracy }}%</span>
      </div>
      <div
        v-if="props.criticalErrors > 0"
        class="errors"
      >
        ミス {{ props.criticalErrors }}回
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-status {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.game-info {
  display: flex;
  gap: var(--size-8);
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.info-item {
  padding: var(--size-2) var(--size-6);
  background: var(--color-background-secondary);
  border-radius: var(--size-4);
}

.copy-button {
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-24);
  height: var(--size-24);
  padding: var(--size-4);
  background: transparent;
  border: none;
  border-radius: var(--size-4);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all 0.15s ease;
  box-sizing: border-box;

  &:hover {
    background: var(--color-background-secondary);
    color: var(--color-text-primary);
  }

  &.copied {
    color: var(--color-fubuki-primary);
  }

  svg {
    width: 100%;
    height: 100%;
  }
}

.evaluating {
  display: flex;
  flex-direction: column;
  gap: var(--size-4);
}

.progress-bar {
  height: var(--size-6);
  background: var(--color-background-secondary);
  border-radius: var(--size-4);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--color-fubuki-primary);
  transition: width 0.3s ease;
  border-radius: var(--size-4);
}

.progress-text {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
  text-align: center;
}

.completed {
  display: flex;
  align-items: center;
  gap: var(--size-12);
}

.accuracy {
  display: flex;
  align-items: baseline;
  gap: var(--size-4);
}

.accuracy-label {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.accuracy-value {
  font-size: var(--size-20);
  font-weight: 500;
  color: var(--color-fubuki-primary);
}

.errors {
  font-size: var(--size-12);
  color: var(--color-miko-primary);
  padding: var(--size-2) var(--size-6);
  background: var(--color-background-secondary);
  border-radius: var(--size-4);
}
</style>
