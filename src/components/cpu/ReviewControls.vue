<script setup lang="ts">
/**
 * 振り返り再生コントロール
 *
 * ナビゲーションボタン・スライダー・手一覧を提供
 */

import { computed } from "vue";

import type { EvaluatedMove } from "@/types/review";
import { getQualityColor } from "@/logic/reviewLogic";

interface Props {
  currentMoveIndex: number;
  totalMoves: number;
  evaluatedMoves: EvaluatedMove[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  goToMove: [index: number];
  goToStart: [];
  goToEnd: [];
  prevMove: [];
  nextMove: [];
}>();

/** スライダー値 */
const sliderValue = computed({
  get: () => props.currentMoveIndex,
  set: (value: number) => emit("goToMove", value),
});

/** 各手の品質ドット表示データ */
const moveDots = computed(() =>
  Array.from({ length: props.totalMoves }, (_, i) => {
    const evaluated = props.evaluatedMoves.find((e) => e.moveIndex === i);
    return {
      index: i + 1,
      color: evaluated ? getQualityColor(evaluated.quality) : undefined,
      isCurrent: i + 1 === props.currentMoveIndex,
    };
  }),
);
</script>

<template>
  <div class="review-controls">
    <!-- ナビゲーションボタン -->
    <div class="nav-buttons">
      <button
        class="nav-button"
        aria-label="最初の手へ"
        :disabled="props.currentMoveIndex === 0"
        @click="emit('goToStart')"
      >
        |&lt;
      </button>
      <button
        class="nav-button"
        aria-label="前の手へ"
        :disabled="props.currentMoveIndex === 0"
        @click="emit('prevMove')"
      >
        &lt;
      </button>
      <span class="move-counter">
        {{ props.currentMoveIndex }} / {{ props.totalMoves }}
      </span>
      <button
        class="nav-button"
        aria-label="次の手へ"
        :disabled="props.currentMoveIndex >= props.totalMoves"
        @click="emit('nextMove')"
      >
        &gt;
      </button>
      <button
        class="nav-button"
        aria-label="最後の手へ"
        :disabled="props.currentMoveIndex >= props.totalMoves"
        @click="emit('goToEnd')"
      >
        &gt;|
      </button>
    </div>

    <!-- スライダー -->
    <input
      v-model.number="sliderValue"
      type="range"
      class="move-slider"
      :min="0"
      :max="props.totalMoves"
      :step="1"
    />

    <!-- 手一覧（品質ドット） -->
    <div class="move-dots">
      <button
        v-for="dot in moveDots"
        :key="dot.index"
        class="move-dot"
        :class="{ current: dot.isCurrent }"
        :style="dot.color ? { backgroundColor: dot.color } : {}"
        @click="emit('goToMove', dot.index)"
      >
        {{ dot.index }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.review-controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
  min-height: 0;
}

.nav-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-6);
}

.nav-button {
  display: inline-block;
  height: var(--size-36);
  aspect-ratio: 1;
  background: var(--color-background-secondary);
  border: 2px solid var(--color-border-light);
  border-radius: var(--size-6);
  font-size: var(--size-14);
  font-weight: 500;
  line-height: var(--size-36);
  text-align: center;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
  box-sizing: border-box;
  width: 2rem;
}

.nav-button:hover:not(:disabled) {
  background: var(--color-background-hover);
  border-color: var(--color-primary);
}

.nav-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.move-counter {
  font-size: var(--size-14);
  color: var(--color-text-secondary);
  min-width: var(--size-64);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.move-slider {
  width: 100%;
  accent-color: var(--color-fubuki-primary);
}

.move-dots {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  align-content: flex-start;
}

.move-dot {
  width: var(--size-20);
  height: var(--size-20);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--size-10);
  border: 1px solid var(--color-border-light);
  border-radius: var(--size-4);
  background: var(--color-background-secondary);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  padding: 0;

  /* 品質色の背景がある場合、白文字にしてコントラスト確保 */
  &[style*="background"] {
    color: white;
    border-color: transparent;
  }
}

.move-dot:hover {
  border-color: var(--color-primary);
}

.move-dot.current {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
  font-weight: 500;
}
</style>
