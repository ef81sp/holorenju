<script setup lang="ts">
/**
 * 振り返り評価パネルの「候補手」セクション
 *
 * 候補手をコンパクトなカードで最大 3 件表示する（最善手・自分の手は必ず含む）。
 * 各カードは最善からの距離を下端のゲージで示す（長さ＝差、色＝4 段階の区切り）。
 * 数値差は aria-label / title に残す。
 * ホバー・フォーカスで盤面に該当位置を 1 マークだけプレビューする
 * （reviewBoardPreviewStore を直接更新）。
 *
 * @see docs/plans/review-right-panel-redesign-2026-11-19.md
 */

import { computed } from "vue";

import type { EvaluatedMove } from "@/types/review";
import type { Position } from "@/types/game";
import { useReviewBoardPreviewStore } from "@/stores/reviewBoardPreviewStore";
import {
  type CandidateView,
  buildCandidateViews,
  candidateAriaLabel,
  candidateTitle,
} from "./composables/candidateViewModel";

const props = defineProps<{
  evaluation: EvaluatedMove;
}>();

const previewStore = useReviewBoardPreviewStore();

const candidateViews = computed<CandidateView[]>(() =>
  buildCandidateViews(props.evaluation),
);

/** 底打ちした手もバーの存在が見えるよう、最低 4% は残す */
const GAUGE_MIN_PERCENT = 4;

function gaugeWidth(c: CandidateView): string {
  return `${Math.max(GAUGE_MIN_PERCENT, c.gaugeRatio * 100)}%`;
}

function handleEnter(position: Position): void {
  previewStore.setHoveredCandidate(position);
}

function handleLeave(): void {
  previewStore.clearHoveredCandidate();
}
</script>

<template>
  <hr
    v-if="candidateViews.length > 0"
    class="panel-divider"
  />
  <section
    v-if="candidateViews.length > 0"
    class="panel-section cand-section"
    aria-labelledby="review-cand-heading"
  >
    <h3
      id="review-cand-heading"
      class="panel-label"
    >
      候補手
    </h3>
    <ul class="cand-grid">
      <li
        v-for="c in candidateViews"
        :key="`${c.position.row},${c.position.col}`"
        class="cand-item"
      >
        <button
          type="button"
          class="cand-card"
          :class="{
            'is-best': c.kind === 'best',
            'is-actual': c.kind === 'actual',
            'is-danger': c.opponentForcedWinShort,
          }"
          :aria-label="candidateAriaLabel(c)"
          :title="candidateTitle(c)"
          @mouseenter="handleEnter(c.position)"
          @mouseleave="handleLeave"
          @focus="handleEnter(c.position)"
          @blur="handleLeave"
        >
          <span
            class="cand-rank"
            :class="c.kind"
            aria-hidden="true"
          >
            <span class="num-glyph">{{ c.rank }}</span>
          </span>
          <span
            class="cand-coord"
            aria-hidden="true"
          >
            {{ c.coord }}
          </span>
          <span
            class="cand-gauge"
            aria-hidden="true"
          >
            <span
              class="cand-gauge-fill"
              :class="`grade-${c.grade}`"
              :style="{ width: gaugeWidth(c) }"
            />
          </span>
          <span
            v-if="c.opponentForcedWinShort"
            class="cand-flag danger"
            aria-hidden="true"
          >
            危{{ c.opponentForcedWinShort }}
          </span>
          <span
            v-else-if="c.isFukumi"
            class="cand-flag fukumi"
            aria-hidden="true"
          >
            フクミ{{ c.fukumiDepth ? c.fukumiDepth : "" }}
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.panel-label {
  display: flex;
  align-items: center;
  gap: var(--size-8);
  margin: 0;
  font-size: var(--font-size-11);
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.05em;
}

.panel-label::before {
  content: "";
  width: var(--size-4);
  height: var(--size-12);
  background: var(--color-fubuki-primary);
  border-radius: var(--size-4);
}

.cand-section {
  flex-shrink: 0;
}

/*
 * 順位丸（左上）と危/フクミ（右下）がカードの角からはみ出すため、
 * グリッドの外周に余白を取る。
 */
.cand-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--size-4);
  margin: 0;
  padding: var(--size-4) var(--size-4) var(--size-12) var(--size-4);
  list-style: none;
}

/*
 * li を矩形のグリッドセルとして配置し、内側のボタンを li いっぱいに
 * 広げる。display: contents は一部ブラウザでアクセシビリティツリーから
 * 消えるため使わない。
 */
.cand-item {
  display: flex;
  min-width: 0;
}

.cand-item > .cand-card {
  width: 100%;
}

.cand-card {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--size-36);
  /* 下端のゲージの分、座標を上に寄せる */
  padding: var(--size-4) var(--size-4) var(--size-12);
  box-sizing: border-box;
  border-radius: var(--size-8);
  border: 1px solid var(--color-border);
  background: var(--color-bg-white);
  font-family: inherit;
  font-feature-settings: "tnum";
  cursor: pointer;
  transition:
    transform 0.12s,
    border-color 0.12s,
    box-shadow 0.12s;
}

.cand-card:hover,
.cand-card:focus-visible {
  border-color: var(--color-fubuki-primary);
  transform: translateY(-1px);
  box-shadow: 0 var(--size-2) var(--size-6) rgba(0, 0, 0, 0.08);
  outline: none;
}

/* 最善・実際のカードは枠色が上書きされるため、フォーカスはアウトラインで示す */
.cand-card:focus-visible {
  outline: var(--size-2) solid var(--color-fubuki-primary);
  outline-offset: var(--size-1);
}

.cand-card.is-best {
  border-color: var(--color-blue-400);
  background: var(--color-blue-100);
}

.cand-card.is-actual {
  border-color: var(--color-miko-primary);
  background: var(--color-miko-bg-light);
}

.cand-card.is-danger {
  border-color: var(--color-error);
}

.cand-card.is-best::after,
.cand-card.is-actual::after {
  content: "";
  position: absolute;
  top: var(--size-4);
  right: var(--size-4);
  width: var(--size-8);
  height: var(--size-8);
  border-radius: 50%;
}

.cand-card.is-best::after {
  background: var(--color-blue-500);
}

.cand-card.is-actual::after {
  background: var(--color-miko-primary);
}

/* 順位丸: 左上の角に重ねる。数字は字面の上下余白を切って真円の中央へ */
.cand-rank {
  position: absolute;
  top: calc(var(--size-4) * -1);
  left: calc(var(--size-4) * -1);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-12);
  height: var(--size-12);
  box-sizing: border-box;
  border-radius: 50%;
  background: var(--color-text-light);
  color: var(--color-bg-white);
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  /* 丸は固定サイズなので、文字倍率をかけない固定値にしてはみ出しを防ぐ */
  font-size: var(--size-9);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.cand-rank.best {
  background: var(--color-blue-500);
}

.cand-rank.actual {
  background: var(--color-miko-primary);
}

.cand-coord {
  /* カード下端のゲージに文字がかからないよう上限を付ける（文字サイズ「大」対策） */
  font-size: min(var(--font-size-13), var(--size-16));
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.1;
}

/*
 * 最善からの距離ゲージ: カード下端の細いバー。最善で満タン、差400で底。
 * 色は品質判定と同じ 4 段階の区切り（最善／好手／疑問手／悪手）。
 */
.cand-gauge {
  position: absolute;
  left: var(--size-8);
  right: var(--size-8);
  bottom: var(--size-4);
  height: var(--size-4);
  border-radius: var(--size-4);
  background: var(--color-border);
  overflow: hidden;
}

.cand-gauge-fill {
  display: block;
  height: 100%;
  border-radius: var(--size-4);
}

.cand-gauge-fill.grade-S {
  background: var(--color-cyan-600);
}

.cand-gauge-fill.grade-A {
  background: var(--color-success);
}

.cand-gauge-fill.grade-B {
  background: var(--color-warning);
}

.cand-gauge-fill.grade-C {
  background: var(--color-error);
}

/* 危〜 / フクミ: 右下の角からぶら下げる（ゲージと重ならないよう下端の外側） */
.cand-flag {
  position: absolute;
  right: calc(var(--size-4) * -1);
  bottom: calc(var(--size-12) * -1);
  padding: 0 var(--size-4);
  border-radius: var(--size-4);
  font-size: var(--font-size-8);
  line-height: var(--size-12);
  white-space: nowrap;
}

.cand-flag.danger {
  background: var(--color-error-light);
  color: var(--color-error);
}

.cand-flag.fukumi {
  background: var(--color-violet-light);
  color: var(--color-violet-dark);
}

/*
 * 丸の中の数字: 字面の上下余白（ascent/descent）を切り、数字の見た目の高さで中央に置く。
 * text-box は flex コンテナ自身には効かないため、内側のブロックに付ける。
 */
.num-glyph {
  display: block;
  line-height: 1;
  text-box: trim-both cap alphabetic;
}
</style>
