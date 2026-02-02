<script setup lang="ts">
/**
 * AIデバッグ情報表示コンポーネント
 *
 * CPU対戦画面でAIの判断を可視化するためのデバッグ用パネル
 */

import { computed, ref } from "vue";

import type { AIResponse, CandidateMove, DepthResult } from "@/types/cpu";
import { useBoardStore } from "@/stores/boardStore";

const props = defineProps<{
  /** 最後のAIレスポンス */
  response: AIResponse | null;
}>();

const boardStore = useBoardStore();

// デバッグマーク用の特殊なdialogueIndex
const DEBUG_MARK_INDEX = -999;

// ホバー中の候補手
const hoveredCandidate = ref<CandidateMove | null>(null);

// ポップオーバー要素のref（各候補手ごと）
const popoverRefs = ref<Map<number, HTMLElement>>(new Map());

/**
 * 座標を人間が読みやすい形式に変換 (例: H8)
 */
function formatPosition(row: number, col: number): string {
  const colLetter = String.fromCharCode("A".charCodeAt(0) + col);
  const rowNumber = 15 - row; // 盤面は上から1～15
  return `${colLetter}${rowNumber}`;
}

/**
 * スコアを符号付きで表示
 */
function formatScore(score: number): string {
  if (score >= 0) {
    return `+${score}`;
  }
  return String(score);
}

/**
 * スコアの評価を文字列で返す
 */
function getScoreEvaluation(score: number): string {
  if (score >= 900000) {
    return "勝ち確定";
  }
  if (score >= 10000) {
    return "大優勢";
  }
  if (score >= 1000) {
    return "優勢";
  }
  if (score >= 100) {
    return "やや有利";
  }
  if (score >= -100) {
    return "互角";
  }
  if (score >= -1000) {
    return "やや不利";
  }
  if (score >= -10000) {
    return "劣勢";
  }
  if (score >= -900000) {
    return "大劣勢";
  }
  return "負け確定";
}

/**
 * ポップオーバーのrefを設定
 */
function setPopoverRef(rank: number, el: HTMLElement | null): void {
  if (el) {
    popoverRefs.value.set(rank, el);
  } else {
    popoverRefs.value.delete(rank);
  }
}

/**
 * 候補手のホバー開始
 */
function handleCandidateEnter(candidate: CandidateMove): void {
  hoveredCandidate.value = candidate;

  // 盤面にマークを追加
  boardStore.addMarks(
    [{ positions: [candidate.position], markType: "circle" }],
    DEBUG_MARK_INDEX,
  );

  // ポップオーバーを表示
  const popover = popoverRefs.value.get(candidate.rank);
  popover?.showPopover();
}

/**
 * 候補手のホバー終了
 */
function handleCandidateLeave(): void {
  if (hoveredCandidate.value) {
    // マークを削除
    boardStore.removeMarks([
      { positions: [hoveredCandidate.value.position], markType: "circle" },
    ]);

    // ポップオーバーを非表示
    const popover = popoverRefs.value.get(hoveredCandidate.value.rank);
    popover?.hidePopover();
  }
  hoveredCandidate.value = null;
}

// 候補手リスト（上位5手）
const candidates = computed<CandidateMove[]>(
  () => props.response?.candidates ?? [],
);

// 選択された手の順位
const selectedRank = computed(() => {
  if (!props.response?.randomSelection) {
    return 1;
  }
  return props.response.randomSelection.originalRank;
});

// ランダム選択かどうか
const wasRandom = computed(
  () => props.response?.randomSelection?.wasRandom ?? false,
);

// ランダム選択時の候補数
const randomCandidateCount = computed(
  () => props.response?.randomSelection?.candidateCount ?? 0,
);

// 深度履歴
const depthHistory = computed<DepthResult[]>(
  () => props.response?.depthHistory ?? [],
);

// 手が変わった深度を判定
function isDepthChanged(index: number): boolean {
  if (index === 0) {
    return false;
  }
  const history = depthHistory.value;
  if (index >= history.length) {
    return false;
  }
  const current = history[index];
  const previous = history[index - 1];
  if (!current || !previous) {
    return false;
  }
  return (
    current.position.row !== previous.position.row ||
    current.position.col !== previous.position.col
  );
}
</script>

<template>
  <div
    v-if="response && response.depth > 0"
    class="ai-debug-info"
  >
    <div class="debug-header">
      <span class="debug-title">AI分析</span>
      <span class="debug-stats">
        {{ response.depth }}手読み / {{ response.thinkingTime }}ms
      </span>
    </div>

    <div class="debug-divider" />

    <!-- 候補手リスト -->
    <div
      v-if="candidates.length > 0"
      class="debug-section"
    >
      <div class="section-label">候補手:</div>
      <ul class="candidate-list">
        <li
          v-for="candidate in candidates"
          :key="`${candidate.position.row}-${candidate.position.col}`"
          class="candidate-item"
          :class="{
            selected: candidate.rank === selectedRank,
            hovered: hoveredCandidate?.rank === candidate.rank,
          }"
          :style="{ anchorName: `--candidate-anchor-${candidate.rank}` }"
          @mouseenter="handleCandidateEnter(candidate)"
          @mouseleave="handleCandidateLeave"
        >
          <span class="candidate-rank">#{{ candidate.rank }}</span>
          <span class="candidate-pos">
            {{ formatPosition(candidate.position.row, candidate.position.col) }}
          </span>
          <span class="candidate-score">
            {{ formatScore(candidate.score) }}
          </span>
          <span
            v-if="candidate.rank === selectedRank"
            class="selected-marker"
          >
            {{ wasRandom ? "選択" : "" }}
          </span>

          <!-- ポップオーバー (Popover API + Anchor Positioning API) -->
          <div
            :ref="(el) => setPopoverRef(candidate.rank, el as HTMLElement)"
            popover="manual"
            class="candidate-popover"
            :style="{ positionAnchor: `--candidate-anchor-${candidate.rank}` }"
          >
            <div class="popover-row">
              <span class="popover-label">位置:</span>
              <span class="popover-value">
                {{
                  formatPosition(candidate.position.row, candidate.position.col)
                }}
              </span>
            </div>
            <div class="popover-row">
              <span class="popover-label">スコア:</span>
              <span class="popover-value">
                {{ formatScore(candidate.score) }}
              </span>
            </div>
            <div class="popover-row">
              <span class="popover-label">評価:</span>
              <span class="popover-value popover-eval">
                {{ getScoreEvaluation(candidate.score) }}
              </span>
            </div>
            <div
              v-if="candidate.rank === selectedRank"
              class="popover-row popover-selected"
            >
              {{ wasRandom ? "ランダム選択された手" : "最善手として選択" }}
            </div>
          </div>
        </li>
      </ul>
      <div
        v-if="wasRandom"
        class="random-info"
      >
        ランダム選択: #{{ selectedRank }} (上位{{ randomCandidateCount }}手)
      </div>
    </div>

    <!-- 深度分岐 -->
    <div
      v-if="depthHistory.length > 1"
      class="debug-section"
    >
      <div class="debug-divider" />
      <div class="section-label">深度分岐:</div>
      <ul class="depth-list">
        <li
          v-for="(entry, index) in depthHistory"
          :key="entry.depth"
          class="depth-item"
          :class="{ changed: isDepthChanged(index) }"
        >
          <span class="depth-label">d{{ entry.depth }}:</span>
          <span class="depth-pos">
            {{ formatPosition(entry.position.row, entry.position.col) }}
          </span>
          <span class="depth-score">({{ formatScore(entry.score) }})</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.ai-debug-info {
  padding: var(--size-12);
  background: var(--color-background-secondary);
  border-radius: var(--size-8);
  font-size: var(--size-12);
  font-family: monospace;
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.debug-title {
  font-weight: 500;
  color: var(--color-text-primary);
}

.debug-stats {
  color: var(--color-text-secondary);
}

.debug-divider {
  height: 1px;
  background: var(--color-border-light);
  margin: var(--size-8) 0;
}

.debug-section {
  margin-top: var(--size-4);
}

.section-label {
  color: var(--color-text-secondary);
  margin-bottom: var(--size-4);
}

.candidate-list,
.depth-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.candidate-item,
.depth-item {
  display: flex;
  align-items: center;
  gap: var(--size-8);
  padding: var(--size-2) 0;
  color: var(--color-text-primary);
}

.candidate-item {
  position: relative;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.candidate-item:hover {
  background: rgba(102, 126, 234, 0.1);
  border-radius: var(--size-4);
  padding: var(--size-2) var(--size-4);
  margin: 0 calc(var(--size-4) * -1);
}

.candidate-item.selected {
  background: rgba(102, 126, 234, 0.15);
  border-radius: var(--size-4);
  padding: var(--size-2) var(--size-4);
  margin: 0 calc(var(--size-4) * -1);
}

.candidate-item.hovered {
  background: rgba(102, 126, 234, 0.2);
}

.candidate-rank {
  width: var(--size-24);
  color: var(--color-text-secondary);
}

.candidate-pos,
.depth-pos {
  width: var(--size-32);
  font-weight: 500;
}

.candidate-score,
.depth-score {
  color: var(--color-text-secondary);
}

.selected-marker {
  color: var(--color-primary);
  font-size: var(--size-10);
}

.random-info {
  margin-top: var(--size-8);
  color: var(--color-primary);
  font-size: var(--size-11);
}

.depth-item.changed {
  color: var(--color-primary);
}

.depth-item.changed .depth-pos {
  font-weight: 700;
}

.depth-label {
  width: var(--size-28);
  color: var(--color-text-secondary);
}

.depth-item.changed .depth-label {
  color: var(--color-primary);
}

/* ポップオーバー (Popover API + Anchor Positioning API) */
.candidate-popover {
  /* Popover のデフォルトスタイルをリセット */
  margin: 0;
  inset: auto;

  /* Anchor Positioning */
  position: fixed;
  position-area: block-end;
  position-try-fallbacks: flip-block;

  /* スタイル */
  padding: var(--size-10);
  background: var(--color-bg-white, #fff);
  border: 1px solid var(--color-border-light);
  border-radius: var(--size-8);
  box-shadow: 0 var(--size-4) var(--size-12) rgba(0, 0, 0, 0.15);
  min-width: var(--size-140, 140px);
  font-family: sans-serif;
}

.popover-row {
  display: flex;
  justify-content: space-between;
  gap: var(--size-12);
  padding: var(--size-2) 0;
  font-size: var(--size-11);
}

.popover-label {
  color: var(--color-text-secondary);
}

.popover-value {
  color: var(--color-text-primary);
  font-weight: 500;
}

.popover-eval {
  color: var(--color-primary);
}

.popover-selected {
  margin-top: var(--size-4);
  padding-top: var(--size-6);
  border-top: 1px solid var(--color-border-light);
  color: var(--color-primary);
  font-size: var(--size-10);
  text-align: center;
}
</style>
