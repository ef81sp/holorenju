<script setup lang="ts">
/**
 * 振り返り評価パネルの「候補手」セクション
 *
 * 候補手をコンパクトなカードグリッドで表示。
 * 各カードのホバーで盤面に該当位置を 1 マークだけプレビューする
 * （hoverCandidate emit / leaveCandidate emit）。
 */

import { computed } from "vue";

import type { EvaluatedMove, ReviewCandidate } from "@/types/review";
import type { Position } from "@/types/game";
import { SHORT_LABELS } from "@/logic/forcedTypeLabels";
import { formatMove } from "@/logic/gameRecordParser";

const props = defineProps<{
  evaluation: EvaluatedMove;
}>();

const emit = defineEmits<{
  hoverCandidate: [position: Position];
  leaveCandidate: [];
}>();

interface CandidateView {
  rank: number;
  position: Position;
  coord: string;
  delta: number;
  kind: "best" | "actual" | "alt";
  isFukumi: boolean;
  fukumiDepth?: number;
  opponentForcedWinShort?: string;
}

const bestCandidate = computed<ReviewCandidate | null>(() => {
  const eval_ = props.evaluation;
  if (eval_.candidates.length === 0) {
    return null;
  }
  return (
    eval_.candidates.find(
      (c) =>
        c.position.row === eval_.bestMove.row &&
        c.position.col === eval_.bestMove.col,
    ) ??
    eval_.candidates[0] ??
    null
  );
});

const candidateViews = computed<CandidateView[]>(() => {
  const eval_ = props.evaluation;
  if (eval_.candidates.length === 0) {
    return [];
  }
  const bestSearchScore =
    bestCandidate.value?.searchScore ?? eval_.candidates[0]?.searchScore ?? 0;
  return eval_.candidates.map((c, idx) => {
    const isBest =
      c.position.row === eval_.bestMove.row &&
      c.position.col === eval_.bestMove.col;
    const isPlayed =
      c.position.row === eval_.position.row &&
      c.position.col === eval_.position.col;
    let kind: "best" | "actual" | "alt" = "alt";
    if (isBest) {
      kind = "best";
    } else if (isPlayed) {
      kind = "actual";
    }
    return {
      rank: idx + 1,
      position: c.position,
      coord: formatMove(c.position),
      delta: c.searchScore - bestSearchScore,
      kind,
      isFukumi: c.isFukumi ?? false,
      fukumiDepth: c.fukumiDepth,
      opponentForcedWinShort: c.opponentForcedWin
        ? SHORT_LABELS[c.opponentForcedWin]
        : undefined,
    };
  });
});

function formatDelta(delta: number): string {
  if (delta === 0) {
    return "±0";
  }
  return delta.toLocaleString("en");
}

function handleEnter(position: Position): void {
  emit("hoverCandidate", position);
}

function handleLeave(): void {
  emit("leaveCandidate");
}
</script>

<template>
  <section
    v-if="candidateViews.length > 0"
    class="panel-section cand-section"
  >
    <div class="panel-label">
      <span>候補手</span>
      <span class="panel-label-count">{{ candidateViews.length }}件</span>
    </div>
    <div class="cand-scroll">
      <div class="cand-grid">
        <button
          v-for="c in candidateViews"
          :key="`${c.position.row},${c.position.col}`"
          type="button"
          class="cand-card"
          :class="{
            'is-best': c.kind === 'best',
            'is-actual': c.kind === 'actual',
            'is-danger': c.opponentForcedWinShort,
            'is-fukumi': c.isFukumi,
          }"
          @mouseenter="handleEnter(c.position)"
          @mouseleave="handleLeave"
          @focus="handleEnter(c.position)"
          @blur="handleLeave"
        >
          <span
            class="cand-rank"
            :class="c.kind"
          >
            {{ c.rank }}
          </span>
          <span class="cand-coord">{{ c.coord }}</span>
          <span
            class="cand-delta"
            :class="c.delta === 0 ? 'zero' : 'neg'"
          >
            {{ formatDelta(c.delta) }}
          </span>
          <span
            v-if="c.opponentForcedWinShort"
            class="cand-flag danger"
          >
            危{{ c.opponentForcedWinShort }}
          </span>
          <span
            v-else-if="c.isFukumi"
            class="cand-flag fukumi"
          >
            フクミ{{ c.fukumiDepth ? c.fukumiDepth : "" }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel-section {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.panel-label {
  display: flex;
  align-items: center;
  gap: var(--size-6);
  font-size: var(--font-size-11);
  font-weight: 500;
  color: var(--color-text-secondary);
  letter-spacing: 0.05em;
}

.panel-label::before {
  content: "";
  width: var(--size-3);
  height: var(--size-10);
  background: var(--color-fubuki-primary);
  border-radius: var(--size-2);
}

.panel-label-count {
  font-weight: var(--font-weight-normal);
  color: var(--color-text-secondary);
  margin-left: auto;
}

.cand-section {
  flex-shrink: 0;
}

.cand-scroll {
  max-height: var(--size-150);
  overflow-y: auto;
  padding-right: var(--size-2);
  margin-right: calc(var(--size-2) * -1);
}

.cand-scroll::-webkit-scrollbar {
  width: 6px;
}

.cand-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.cand-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.cand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--size-56), 1fr));
  gap: var(--size-4);
}

.cand-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-12) var(--size-4) var(--size-4);
  border-radius: var(--size-8);
  border: 1px solid var(--color-border);
  background: #fff;
  cursor: pointer;
  font-family: inherit;
  font-feature-settings: "tnum";
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
  border-color: hsl(0, 65%, 50%);
}

.cand-card.is-best::after,
.cand-card.is-actual::after {
  content: "";
  position: absolute;
  top: var(--size-3);
  right: var(--size-3);
  width: var(--size-6);
  height: var(--size-6);
  border-radius: 50%;
}

.cand-card.is-best::after {
  background: var(--color-blue-500);
}

.cand-card.is-actual::after {
  background: var(--color-miko-primary);
}

.cand-rank {
  position: absolute;
  top: var(--size-2);
  left: var(--size-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-12);
  height: var(--size-12);
  border-radius: 50%;
  background: var(--color-text-light);
  color: #fff;
  font-size: var(--font-size-9);
  font-weight: 500;
}

.cand-rank.best {
  background: var(--color-blue-500);
}

.cand-rank.actual {
  background: var(--color-miko-primary);
}

.cand-coord {
  font-size: var(--font-size-13);
  font-weight: 500;
  color: var(--color-text-primary);
  line-height: 1.1;
}

.cand-delta {
  font-size: var(--font-size-9);
  line-height: 1.1;
  white-space: nowrap;
}

.cand-delta.zero {
  color: var(--color-blue-500);
}

.cand-delta.neg {
  color: var(--color-miko-primary);
}

.cand-flag {
  font-size: var(--font-size-8);
  line-height: 1.1;
  margin-top: var(--size-1);
  padding: 0 var(--size-3);
  border-radius: var(--size-2);
  white-space: nowrap;
}

.cand-flag.danger {
  background: hsl(0, 65%, 95%);
  color: hsl(0, 65%, 45%);
}

.cand-flag.fukumi {
  background: hsl(270, 50%, 95%);
  color: hsl(270, 50%, 45%);
}
</style>
