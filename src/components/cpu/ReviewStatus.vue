<script setup lang="ts">
/**
 * 振り返り評価ステータス表示
 *
 * 評価中はプログレスバー、完了後は精度とミス数サマリー
 */

import { ref } from "vue";
import { usePreferencesStore } from "@/stores/preferencesStore";
import IconButton from "@/components/common/IconButton.vue";
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
  failedCount: number;
  accuracy: number | null;
  criticalErrors: number;
  difficulty?: CpuDifficulty;
  moveCount: number;
  playerFirst: boolean;
  moveHistory: string | null;
}

const props = defineProps<Props>();
const preferencesStore = usePreferencesStore();

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
        v-if="props.difficulty"
        class="info-item"
        :aria-label="DIFFICULTY_ARIA_LABELS[props.difficulty]"
      >
        {{ DIFFICULTY_LABELS[props.difficulty] }}
      </span>
      <span class="info-item">{{ props.playerFirst ? "先手" : "後手" }}</span>
      <span class="info-item">{{ props.moveCount }}手</span>
      <IconButton
        v-if="props.moveHistory"
        class="copy-button-position"
        size="xs"
        variant="ghost"
        :tone="copied ? 'accent' : 'default'"
        aria-label="棋譜をコピー"
        @click.stop="copyMoveHistory"
      >
        <ContentCopyIcon v-if="!copied" />
        <CheckIcon v-else />
      </IconButton>
    </div>

    <!-- 評価中 -->
    <div
      v-if="props.isEvaluating"
      class="evaluating"
    >
      <div class="progress-bar">
        <div
          class="progress-fill"
          :class="{ 'no-animation': !preferencesStore.animationEnabled }"
          :style="{
            width: `${props.totalCount > 0 ? (props.completedCount / props.totalCount) * 100 : 0}%`,
          }"
        />
      </div>
      <span class="progress-text">
        <span
          class="analyzing-dots"
          :class="{ 'no-animation': !preferencesStore.animationEnabled }"
        >
          解析中
        </span>
        ({{ props.completedCount }}/{{ props.totalCount }})
        <span
          v-if="props.failedCount > 0"
          class="failed-inline"
        >
          / 失敗 {{ props.failedCount }}
        </span>
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
      <div
        v-if="props.failedCount > 0"
        class="failed"
        role="status"
      >
        解析失敗 {{ props.failedCount }}手
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

.copy-button-position {
  margin-left: auto;
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
  background: linear-gradient(
    90deg,
    var(--color-fubuki-primary) 0%,
    color-mix(in srgb, var(--color-fubuki-primary) 60%, white) 50%,
    var(--color-fubuki-primary) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 5s ease-in-out infinite;
  transition: width 0.3s ease;
  border-radius: var(--size-4);
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.progress-text {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
  text-align: center;
}

.analyzing-dots::after {
  content: "";
  display: inline-block;
  width: 1.5em;
  text-align: left;
  animation: dots 1.5s step-end infinite;
}

@keyframes dots {
  0% {
    content: "";
  }
  25% {
    content: ".";
  }
  50% {
    content: "..";
  }
  75% {
    content: "...";
  }
}

.no-animation {
  animation: none !important;
}

.analyzing-dots.no-animation::after {
  content: "...";
  animation: none;
}

.progress-fill.no-animation {
  background: var(--color-fubuki-primary);
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

.failed {
  font-size: var(--size-12);
  color: var(--color-miko-primary);
  padding: var(--size-2) var(--size-6);
  background: var(--color-background-secondary);
  border-radius: var(--size-4);
}

.failed-inline {
  color: var(--color-miko-primary);
}
</style>
