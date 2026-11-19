<script setup lang="ts">
/**
 * 振り返り評価パネルの「候補手」セクション
 *
 * 候補手をコンパクトなカードで最大 3 件表示する（最善手・自分の手は必ず含む）。
 * 各カードは最善との差を S/A/B/C ランクで示し、数値差は aria-label / title に残す。
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
            {{ c.rank }}
          </span>
          <span
            class="cand-body"
            aria-hidden="true"
          >
            <span class="cand-coord">{{ c.coord }}</span>
            <span
              class="cand-grade"
              :class="`grade-${c.grade}`"
            >
              {{ c.grade }}
            </span>
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
  padding: var(--size-4) var(--size-4) var(--size-8) var(--size-4);
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
  padding: var(--size-4);
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
  font-size: var(--font-size-9);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-box: trim-both cap alphabetic;
}

.cand-rank.best {
  background: var(--color-blue-500);
}

.cand-rank.actual {
  background: var(--color-miko-primary);
}

/* 座標とランクを 1 グループにして下揃え・中央配置 */
.cand-body {
  display: flex;
  align-items: flex-end;
  gap: var(--size-4);
  margin: 0 auto;
}

.cand-coord {
  font-size: var(--font-size-13);
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.cand-grade {
  font-size: var(--font-size-9);
  font-weight: 500;
  line-height: 1.2;
}

.cand-grade.grade-S {
  color: var(--color-cyan-700);
}

.cand-grade.grade-A {
  color: var(--color-success-dark);
}

.cand-grade.grade-B {
  color: var(--color-warning-dark);
}

.cand-grade.grade-C {
  color: var(--color-error-dark);
}

/* 危〜 / フクミ: 右下の角に重ねる */
.cand-flag {
  position: absolute;
  right: calc(var(--size-4) * -1);
  bottom: calc(var(--size-8) * -1);
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
</style>
