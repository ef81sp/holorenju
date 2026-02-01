<script setup lang="ts">
/**
 * AIデバッグ情報表示コンポーネント
 *
 * CPU対戦画面でAIの判断を可視化するためのデバッグ用パネル
 */

import { computed } from "vue";

import type { AIResponse, CandidateMove, DepthResult } from "@/types/cpu";

const props = defineProps<{
  /** 最後のAIレスポンス */
  response: AIResponse | null;
}>();

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

// 候補手リスト（上位5手）
const candidates = computed<CandidateMove[]>(() => props.response?.candidates ?? []);

// 選択された手の順位
const selectedRank = computed(() => {
  if (!props.response?.randomSelection) {
    return 1;
  }
  return props.response.randomSelection.originalRank;
});

// ランダム選択かどうか
const wasRandom = computed(() => props.response?.randomSelection?.wasRandom ?? false);

// ランダム選択時の候補数
const randomCandidateCount = computed(() => props.response?.randomSelection?.candidateCount ?? 0);

// 深度履歴
const depthHistory = computed<DepthResult[]>(() => props.response?.depthHistory ?? []);

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
          :class="{ selected: candidate.rank === selectedRank }"
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

.candidate-item.selected {
  background: rgba(102, 126, 234, 0.15);
  border-radius: var(--size-4);
  padding: var(--size-2) var(--size-4);
  margin: 0 calc(var(--size-4) * -1);
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
</style>
