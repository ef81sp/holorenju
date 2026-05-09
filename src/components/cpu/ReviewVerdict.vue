<script setup lang="ts">
/**
 * 振り返り評価パネルの「結論＋スコア」セクション
 *
 * 表示モード（優先順）:
 *   1. moveIndex === 0: 「手を選択してください」
 *   2. evaluation 未到着 + 評価中: 「解析中...」
 *   3. evaluation 未到着 / 軽量評価: 「相手の手」（CPU 手バッジ付き）
 *   4. プレイヤー手のフル評価: 手数バッジ・座標・品質タグ・スコアブロック
 */

import { computed, useId } from "vue";

import type { EvaluatedMove } from "@/types/review";
import type { Position } from "@/types/game";
import { CPU_WIN_LABELS, SHORT_LABELS } from "@/logic/forcedTypeLabels";
import { formatMove } from "@/logic/gameRecordParser";
import { getQualityLabel, getQualityColor } from "@/logic/reviewLogic";
import { formatScore as formatScoreUtil } from "@/logic/cpu/evaluation/breakdownUtils";

const verdictHeadingId = `${useId()}-verdict`;

const props = defineProps<{
  evaluation: EvaluatedMove | null;
  moveIndex: number;
  currentPosition: Position | null;
  isEvaluating?: boolean;
  isLosingMove?: boolean;
}>();

const formatScore = formatScoreUtil;

const qualityColor = computed(() => {
  if (!props.evaluation) {
    return undefined;
  }
  return getQualityColor(props.evaluation.quality);
});

const qualityLabel = computed(() => {
  if (!props.evaluation) {
    return "";
  }
  return getQualityLabel(props.evaluation.quality);
});

const forcedWinLabel = computed(() => {
  const type = props.evaluation?.forcedWinType;
  if (!type) {
    return null;
  }
  if (type === "double-mise") {
    const missed = props.evaluation?.missedDoubleMise;
    return missed && missed.length > 0 ? null : SHORT_LABELS[type];
  }
  return SHORT_LABELS[type];
});

const forcedLossLabel = computed(() => {
  const type = props.evaluation?.forcedLossType;
  return type ? `被${SHORT_LABELS[type]}` : null;
});

const missedDoubleMiseLabel = computed(() => {
  const moves = props.evaluation?.missedDoubleMise;
  if (!moves || moves.length === 0) {
    return null;
  }
  return "両ミセ見逃";
});

const cpuForcedWinLabel = computed(() => {
  const type = props.evaluation?.forcedWinType;
  return type ? CPU_WIN_LABELS[type] : null;
});

const moveCoord = computed(() => {
  if (props.evaluation) {
    return formatMove(props.evaluation.position);
  }
  if (props.currentPosition) {
    return formatMove(props.currentPosition);
  }
  return "";
});

const isBlackMove = computed(
  () => props.moveIndex > 0 && props.moveIndex % 2 === 1,
);

const mode = computed<"empty" | "analyzing" | "cpu" | "player">(() => {
  if (props.moveIndex === 0) {
    return "empty";
  }
  if (!props.evaluation && props.isEvaluating) {
    return "analyzing";
  }
  if (!props.evaluation || props.evaluation.isLightEval) {
    return "cpu";
  }
  return "player";
});
</script>

<template>
  <p
    v-if="mode === 'empty'"
    class="empty"
  >
    手を選択してください
  </p>

  <section
    v-else
    class="panel-section verdict-section"
    :aria-labelledby="verdictHeadingId"
    :aria-busy="mode === 'analyzing' ? true : undefined"
  >
    <div class="verdict-head">
      <h2
        :id="verdictHeadingId"
        class="verdict-num"
      >
        <span
          class="n"
          :class="{ 'is-white': !isBlackMove }"
          aria-hidden="true"
        >
          {{ moveIndex }}
        </span>
        <span class="visually-hidden">{{ moveIndex }} 手目</span>
        <span class="coord">{{ moveCoord }}</span>
      </h2>
      <template v-if="mode === 'cpu' && cpuForcedWinLabel">
        <span class="tag forced">{{ cpuForcedWinLabel }}</span>
      </template>
      <template v-if="mode === 'player' && evaluation">
        <span
          v-if="props.isLosingMove"
          class="tag losing"
        >
          敗着
        </span>
        <span
          v-else
          class="tag quality"
          :style="{ backgroundColor: qualityColor }"
        >
          {{ qualityLabel }}
        </span>
        <span
          v-if="forcedWinLabel"
          class="tag forced"
        >
          {{ forcedWinLabel }}
        </span>
        <span
          v-if="forcedLossLabel && !props.isLosingMove"
          class="tag loss"
        >
          {{ forcedLossLabel }}
        </span>
        <span
          v-if="missedDoubleMiseLabel"
          class="tag miss"
        >
          {{ missedDoubleMiseLabel }}
        </span>
      </template>
    </div>

    <p
      v-if="mode === 'analyzing'"
      class="status-text status-analyzing"
      role="status"
    >
      解析中...
    </p>
    <p
      v-else-if="mode === 'cpu'"
      class="status-text"
    >
      相手の手
    </p>
    <div
      v-else-if="mode === 'player' && evaluation"
      class="score-block"
    >
      <div class="score-cell">
        <div class="label">実際</div>
        <div class="v actual">{{ formatScore(evaluation.playedScore) }}</div>
      </div>
      <div class="score-cell">
        <div class="label">最善</div>
        <div class="v best">{{ formatScore(evaluation.bestScore) }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-13);
}

.status-text {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-13);
}

.status-analyzing {
  animation: analyzing-pulse 1.5s ease-in-out infinite;
}

@keyframes analyzing-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.verdict-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.verdict-head {
  display: flex;
  align-items: center;
  gap: var(--size-6);
  flex-wrap: wrap;
}

.verdict-num {
  display: inline-flex;
  align-items: center;
  gap: var(--size-6);
  margin: 0;
  font-size: var(--font-size-16);
  font-weight: 500;
  font-feature-settings: "tnum";
}

.verdict-num .n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-24);
  height: var(--size-24);
  border-radius: 50%;
  background: var(--color-stone-black);
  color: var(--color-stone-white);
  font-size: var(--font-size-11);
  font-weight: 500;
}

.verdict-num .n.is-white {
  background: var(--color-stone-white);
  color: var(--color-stone-black);
  border: 1px solid var(--color-border-heavy);
}

.verdict-num .coord {
  font-size: var(--font-size-16);
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: var(--size-2) var(--size-8);
  border-radius: 999px;
  font-size: var(--font-size-10);
  font-weight: 500;
  white-space: nowrap;
  color: var(--color-bg-white);
}

.tag.quality {
  background: var(--color-fubuki-primary);
}

.tag.forced {
  background: var(--color-violet);
}

.tag.loss {
  background: var(--color-error);
}

.tag.miss {
  background: var(--color-fubuki-primary);
}

.tag.losing {
  background: var(--color-error-dark);
}

.score-block {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--size-2) var(--size-12);
}

.score-cell {
  display: flex;
  flex-direction: column;
  gap: var(--size-1);
}

.score-cell .label {
  font-size: var(--font-size-10);
  color: var(--color-text-secondary);
}

.score-cell .v {
  font-size: var(--font-size-14);
  font-weight: 500;
  font-feature-settings: "tnum";
}

.score-cell .v.actual {
  color: var(--color-miko-primary);
}

.score-cell .v.best {
  color: var(--color-blue-500);
}
</style>
