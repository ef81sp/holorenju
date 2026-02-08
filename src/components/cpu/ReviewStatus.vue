<script setup lang="ts">
/**
 * 振り返り評価ステータス表示
 *
 * 評価中はプログレスバー、完了後は精度とミス数サマリー
 */

interface Props {
  isEvaluating: boolean;
  completedCount: number;
  totalCount: number;
  accuracy: number | null;
  criticalErrors: number;
  difficulty: string;
  moveCount: number;
  playerFirst: boolean;
}

const props = defineProps<Props>();

/** 難易度ラベル */
const difficultyLabels: Record<string, string> = {
  beginner: "かんたん",
  easy: "やさしい",
  medium: "ふつう",
  hard: "むずかしい",
};
</script>

<template>
  <div class="review-status">
    <!-- 対局情報 -->
    <div class="game-info">
      <span class="info-item">
        {{ difficultyLabels[props.difficulty] ?? props.difficulty }}
      </span>
      <span class="info-item">{{ props.playerFirst ? "先手" : "後手" }}</span>
      <span class="info-item">{{ props.moveCount }}手</span>
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
