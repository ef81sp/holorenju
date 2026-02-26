<script setup lang="ts">
/**
 * 振り返り再生コントロール
 *
 * ナビゲーションボタン・スライダー・手一覧を提供
 */

import { computed } from "vue";

import type { EvaluatedMove } from "@/types/review";
import { getQualityColor, getQualityLabel } from "@/logic/reviewLogic";

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

/** 品質から下線の本数を取得（最善手=0、程度に応じて1〜3） */
function getUnderlineCount(
  quality: EvaluatedMove["quality"] | undefined,
): number {
  switch (quality) {
    case "good":
      return 1;
    case "inaccuracy":
      return 2;
    case "mistake":
    case "blunder":
      return 3;
    default:
      return 0;
  }
}

/** 強制勝ちの種別ラベル */
function getForcedWinLabel(
  type: EvaluatedMove["forcedWinType"],
): string | undefined {
  switch (type) {
    case "double-mise":
      return "両ミセ";
    case "vcf":
      return "四追い";
    case "vct":
      return "追い詰め";
    case "forbidden-trap":
      return "禁手追い込み";
    case "mise-vcf":
      return "ミセ四追い";
    default:
      return undefined;
  }
}

/** 負け確定の種別ラベル */
function getForcedLossLabel(
  type: EvaluatedMove["forcedLossType"],
): string | undefined {
  switch (type) {
    case "double-mise":
      return "被両ミセ";
    case "vcf":
      return "被四追い";
    case "vct":
      return "被追い詰め";
    case "forbidden-trap":
      return "被禁手追い込み";
    case "mise-vcf":
      return "被ミセ四追い";
    default:
      return undefined;
  }
}

/** 各手の品質ドット表示データ */
const moveDots = computed(() =>
  Array.from({ length: props.totalMoves }, (_, i) => {
    const evaluated = props.evaluatedMoves.find((e) => e.moveIndex === i);
    const moveNum = String(i + 1);
    const qualityLabel =
      evaluated && !evaluated.isLightEval && evaluated.quality !== "excellent"
        ? getQualityLabel(evaluated.quality)
        : undefined;
    const forcedWinLabel = getForcedWinLabel(evaluated?.forcedWinType);
    const forcedLossLabel = getForcedLossLabel(evaluated?.forcedLossType);
    return {
      index: i + 1,
      color:
        evaluated && !evaluated.isLightEval
          ? getQualityColor(evaluated.quality)
          : undefined,
      isCurrent: i + 1 === props.currentMoveIndex,
      underlines: evaluated?.isLightEval
        ? 0
        : getUnderlineCount(evaluated?.quality),
      hasForcedWin: forcedWinLabel !== undefined,
      hasForcedLoss: forcedLossLabel !== undefined,
      ariaLabel: [moveNum, qualityLabel, forcedWinLabel, forcedLossLabel]
        .filter(Boolean)
        .join(" "),
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
        :class="{
          current: dot.isCurrent,
          [`underlines-${dot.underlines}`]: dot.underlines > 0,
          'has-forced-win': dot.hasForcedWin,
          'has-forced-loss': dot.hasForcedLoss,
        }"
        :style="dot.color ? { backgroundColor: dot.color } : {}"
        :aria-label="dot.ariaLabel"
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: var(--size-36);
  min-height: var(--size-32);
  padding: 0 var(--size-6);
  background: var(--color-background-secondary);
  border: 2px solid var(--color-border-light);
  border-radius: var(--size-6);
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
  box-sizing: border-box;
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
  min-width: var(--size-48);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.move-slider {
  width: 100%;
  accent-color: var(--color-fubuki-primary);
}

.move-dots {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--size-24));
  justify-content: space-between;
  gap: var(--size-2);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding: var(--size-4);
}

.move-dot {
  width: var(--size-24);
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
  position: relative;

  /* 品質色の背景がある場合、白文字にしてコントラスト確保 */
  &[style*="background"] {
    color: white;
    border-color: transparent;
  }
}

.move-dot:hover,
.move-dot:focus-visible {
  border-color: var(--color-miko-primary);
  outline: 2px solid var(--color-miko-primary);
  outline-offset: 1px;
}

.move-dot.current {
  border-color: var(--color-miko-primary);
  box-shadow: 0 0 0 1px var(--color-miko-primary);
  font-weight: 500;
}

/* 下線インジケーター（最善手以外、程度に応じて本数が増える） */
.underlines-1 {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: var(--size-1);
}

.underlines-2 {
  text-decoration: underline double;
  text-decoration-thickness: 1px;
  text-underline-offset: var(--size-1);
}

.underlines-3 {
  text-decoration: underline wavy;
  text-decoration-thickness: 1px;
  text-underline-offset: var(--size-1);
}

/* 四追い・追詰・禁手追い込みバッジ */
.has-forced-win::before {
  content: "";
  position: absolute;
  top: -2px;
  right: -2px;
  width: var(--size-6);
  height: var(--size-6);
  border-radius: 50%;
  background: var(--color-miko-primary);
  box-shadow: 0 0 0 1px var(--color-bg-white);
  pointer-events: none;
}

/* 負け確定バッジ（赤系） */
.has-forced-loss::after {
  content: "";
  position: absolute;
  top: -2px;
  left: -2px;
  width: var(--size-6);
  height: var(--size-6);
  border-radius: 50%;
  background: hsl(0, 65%, 50%);
  box-shadow: 0 0 0 1px var(--color-bg-white);
  pointer-events: none;
}
</style>
