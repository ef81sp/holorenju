<script setup lang="ts">
/**
 * 振り返り評価パネル（オーケストレータ）
 *
 * 「結論＋スコア」「候補手」「最善の進行＋分岐」の 3 セクションを組み合わせる。
 * 各セクションは独立コンポーネントに切り出されており、本ファイルは
 * - 表示モードの分岐
 * - 子コンポーネントの emit を親へ転送
 * のみを担う。
 */

import { computed } from "vue";

import type { EvaluatedMove } from "@/types/review";
import type { Position } from "@/types/game";
import ReviewVerdict from "./ReviewVerdict.vue";
import ReviewCandidateGrid from "./ReviewCandidateGrid.vue";
import ReviewProgression from "./ReviewProgression.vue";

const props = defineProps<{
  evaluation: EvaluatedMove | null;
  moveIndex: number;
  currentPosition: Position | null;
  isEvaluating?: boolean;
  isLosingMove?: boolean;
}>();

const emit = defineEmits<{
  hoverCandidate: [position: Position];
  leaveCandidate: [];
  hoverPvMove: [
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ];
  leavePvMove: [];
}>();

/** 候補手・進行セクションを表示するか（プレイヤーのフル評価時のみ） */
const showSections = computed<boolean>(() => {
  if (props.moveIndex === 0) {
    return false;
  }
  if (!props.evaluation) {
    return false;
  }
  return !props.evaluation.isLightEval;
});
</script>

<template>
  <div class="review-eval-panel">
    <ReviewVerdict
      :evaluation="evaluation"
      :move-index="moveIndex"
      :current-position="currentPosition"
      :is-evaluating="isEvaluating"
      :is-losing-move="isLosingMove"
    />

    <template v-if="showSections && evaluation">
      <ReviewCandidateGrid
        :evaluation="evaluation"
        @hover-candidate="(p) => emit('hoverCandidate', p)"
        @leave-candidate="() => emit('leaveCandidate')"
      />
      <ReviewProgression
        :evaluation="evaluation"
        :move-index="moveIndex"
        @hover-pv-move="(items, type) => emit('hoverPvMove', items, type)"
        @leave-pv-move="() => emit('leavePvMove')"
      />
    </template>
  </div>
</template>

<style scoped>
.review-eval-panel {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--size-10);
  padding: var(--size-10);
  background: var(--color-bg-white);
  border-radius: var(--size-12);
  box-shadow: 0 var(--size-2) var(--size-8) rgba(0, 0, 0, 0.08);
  overflow: hidden;
  min-height: 0;
}

/* セクション間の罫線（最初のセクション以外） */
.review-eval-panel > :deep(* + *:not(:empty)) {
  padding-top: var(--size-10);
  border-top: 1px solid var(--color-border-light);
}
</style>
