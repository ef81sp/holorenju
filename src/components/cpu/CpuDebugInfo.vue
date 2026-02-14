<script setup lang="ts">
/**
 * CPUデバッグ情報表示コンポーネント
 *
 * CPU対戦画面でコンピュータの判断を可視化するためのデバッグ用パネル
 */

import { computed, ref } from "vue";

import type {
  CpuResponse,
  CandidateMove,
  DepthResult,
  SearchStats,
} from "@/types/cpu";
import { useBoardStore } from "@/stores/boardStore";
import {
  getNonZeroBreakdown as getNonZeroBreakdownFromBreakdown,
  formatScore,
  formatPatternScore,
  getLeafBreakdownItems,
} from "@/logic/cpu/evaluation/breakdownUtils";

const props = defineProps<{
  /** 最後のCPUレスポンス */
  response: CpuResponse | null;
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
 * PV（予想手順）をフォーマット
 * 各手を番号付きで表示（1. H8 2. G9 ...）
 */
function formatPV(
  pv: Array<{ row: number; col: number }> | undefined,
): string[] {
  if (!pv || pv.length === 0) {
    return [];
  }
  return pv.map(
    (pos, idx) => `${idx + 1}. ${formatPosition(pos.row, pos.col)}`,
  );
}

/**
 * CandidateMove用のgetNonZeroBreakdownラッパー
 */
function getNonZeroBreakdown(
  candidate: CandidateMove,
): ReturnType<typeof getNonZeroBreakdownFromBreakdown> {
  if (!candidate.breakdown) {
    return { patterns: [], defense: [], bonuses: [] };
  }
  return getNonZeroBreakdownFromBreakdown(candidate.breakdown);
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

// タイブレーク選択かどうか
const wasTieBreak = computed(
  () => props.response?.randomSelection?.wasTieBreak ?? false,
);

// ランダム選択時の候補数
const randomCandidateCount = computed(
  () => props.response?.randomSelection?.candidateCount ?? 0,
);

// 深度履歴
const depthHistory = computed<DepthResult[]>(
  () => props.response?.depthHistory ?? [],
);

// 探索統計
const searchStats = computed<SearchStats | null>(
  () => props.response?.searchStats ?? null,
);

/**
 * 数値をK/M単位でフォーマット
 */
function formatNumber(n: number): string {
  if (n >= 1000000) {
    return `${(n / 1000000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

/**
 * パーセンテージをフォーマット
 */
function formatPercent(value: number, total: number): string {
  if (total === 0) {
    return "0%";
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}

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
      <span class="debug-title">コンピュータ分析</span>
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
            {{ formatScore(candidate.searchScore) }}
          </span>
          <span
            v-if="candidate.rank === selectedRank"
            class="selected-marker"
          >
            {{ wasRandom ? "選択" : wasTieBreak ? "同スコア" : "" }}
          </span>

          <!-- ポップオーバー (Popover API + Anchor Positioning API) -->
          <div
            :ref="(el) => setPopoverRef(candidate.rank, el as HTMLElement)"
            popover="manual"
            class="candidate-popover"
            :style="{ positionAnchor: `--candidate-anchor-${candidate.rank}` }"
          >
            <div class="popover-header">
              <span class="popover-pos">
                {{
                  formatPosition(candidate.position.row, candidate.position.col)
                }}
              </span>
              <span class="popover-search-score">
                探索: {{ formatScore(candidate.searchScore) }}
              </span>
            </div>
            <div class="popover-eval-score">
              即時評価: {{ formatScore(candidate.score) }}
            </div>

            <!-- スコア内訳 -->
            <div
              v-if="candidate.breakdown"
              class="popover-breakdown"
            >
              <!-- 攻撃パターン内訳 -->
              <template
                v-if="getNonZeroBreakdown(candidate).patterns.length > 0"
              >
                <div class="popover-section-label">攻撃</div>
                <div
                  v-for="item in getNonZeroBreakdown(candidate).patterns"
                  :key="`attack-${item.key}`"
                  class="popover-row"
                >
                  <span class="popover-label">{{ item.label }}:</span>
                  <span class="popover-value">
                    {{ formatPatternScore(item.detail) }}
                  </span>
                </div>
              </template>

              <!-- 防御パターン内訳 -->
              <template
                v-if="getNonZeroBreakdown(candidate).defense.length > 0"
              >
                <div class="popover-section-label">防御</div>
                <div
                  v-for="item in getNonZeroBreakdown(candidate).defense"
                  :key="`defense-${item.key}`"
                  class="popover-row"
                >
                  <span class="popover-label">{{ item.label }}:</span>
                  <span class="popover-value">
                    {{ formatPatternScore(item.detail) }}
                  </span>
                </div>
              </template>

              <!-- ボーナス内訳 -->
              <template
                v-if="getNonZeroBreakdown(candidate).bonuses.length > 0"
              >
                <div class="popover-section-label">ボーナス</div>
                <div
                  v-for="item in getNonZeroBreakdown(candidate).bonuses"
                  :key="`bonus-${item.key}`"
                  class="popover-row"
                >
                  <span class="popover-label">{{ item.label }}:</span>
                  <span class="popover-value">
                    {{ formatScore(item.value) }}
                  </span>
                </div>
              </template>
            </div>

            <!-- 予想手順 (PV) -->
            <div
              v-if="
                candidate.principalVariation &&
                candidate.principalVariation.length > 1
              "
              class="popover-pv"
            >
              <div class="popover-section-label">予想手順</div>
              <div class="pv-sequence">
                <span
                  v-for="(move, idx) in formatPV(candidate.principalVariation)"
                  :key="idx"
                  class="pv-move"
                  :class="{
                    'pv-self': idx % 2 === 0,
                    'pv-opponent': idx % 2 === 1,
                  }"
                >
                  {{ move }}
                </span>
              </div>
            </div>

            <!-- 探索末端の評価 -->
            <div
              v-if="candidate.leafEvaluation"
              class="popover-leaf"
            >
              <div class="popover-section-label">末端評価</div>
              <div class="leaf-summary">
                <span class="leaf-total">
                  {{ formatScore(candidate.leafEvaluation.total) }}
                </span>
                <span class="leaf-calc">
                  (自{{ formatScore(candidate.leafEvaluation.myScore) }} - 相{{
                    formatScore(candidate.leafEvaluation.opponentScore)
                  }})
                </span>
              </div>

              <!-- 自分の内訳 -->
              <div
                v-if="
                  getLeafBreakdownItems(candidate.leafEvaluation.myBreakdown)
                    .length > 0
                "
                class="leaf-breakdown-section"
              >
                <div class="leaf-breakdown-header">自分</div>
                <div
                  v-for="item in getLeafBreakdownItems(
                    candidate.leafEvaluation.myBreakdown,
                  )"
                  :key="`my-${item.key}`"
                  class="leaf-breakdown-row"
                >
                  <span class="leaf-breakdown-label">{{ item.label }}:</span>
                  <span class="leaf-breakdown-value">
                    {{ formatScore(item.score) }}
                  </span>
                </div>
              </div>

              <!-- 相手の内訳 -->
              <div
                v-if="
                  getLeafBreakdownItems(
                    candidate.leafEvaluation.opponentBreakdown,
                  ).length > 0
                "
                class="leaf-breakdown-section"
              >
                <div class="leaf-breakdown-header">相手</div>
                <div
                  v-for="item in getLeafBreakdownItems(
                    candidate.leafEvaluation.opponentBreakdown,
                  )"
                  :key="`opp-${item.key}`"
                  class="leaf-breakdown-row"
                >
                  <span class="leaf-breakdown-label">{{ item.label }}:</span>
                  <span class="leaf-breakdown-value">
                    {{ formatScore(item.score) }}
                  </span>
                </div>
              </div>
            </div>

            <div
              v-if="
                candidate.rank === selectedRank && (wasRandom || wasTieBreak)
              "
              class="popover-selected"
            >
              {{ wasRandom ? "ランダム選択" : "同スコア選択" }}
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
      <div
        v-if="wasTieBreak"
        class="random-info"
      >
        同スコア選択: #{{ selectedRank }} ({{ randomCandidateCount }}手)
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

    <!-- 探索統計 -->
    <div
      v-if="searchStats"
      class="debug-section"
    >
      <div class="debug-divider" />
      <div class="section-label">探索統計:</div>
      <div class="stats-grid">
        <div class="stats-row">
          <span class="stats-label">ノード:</span>
          <span class="stats-value">{{ formatNumber(searchStats.nodes) }}</span>
        </div>
        <div class="stats-row">
          <span class="stats-label">TTヒット:</span>
          <span class="stats-value">
            {{ formatNumber(searchStats.ttHits) }}
            ({{ formatPercent(searchStats.ttHits, searchStats.nodes) }})
          </span>
        </div>
        <div class="stats-row">
          <span class="stats-label">TTカット:</span>
          <span class="stats-value">
            {{ formatNumber(searchStats.ttCutoffs) }}
          </span>
        </div>
        <div class="stats-row">
          <span class="stats-label">β剪定:</span>
          <span class="stats-value">
            {{ formatNumber(searchStats.betaCutoffs) }}
          </span>
        </div>
      </div>
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
  background: rgba(95, 222, 236, 0.1);
  border-radius: var(--size-4);
  padding: var(--size-2) var(--size-4);
  margin: 0 calc(var(--size-4) * -1);
}

.candidate-item.selected {
  background: rgba(95, 222, 236, 0.15);
  border-radius: var(--size-4);
  padding: var(--size-2) var(--size-4);
  margin: 0 calc(var(--size-4) * -1);
}

.candidate-item.hovered {
  background: rgba(95, 222, 236, 0.2);
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

/* 探索統計 */
.stats-grid {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.stats-row {
  display: flex;
  gap: var(--size-8);
}

.stats-label {
  width: var(--size-64);
  color: var(--color-text-secondary);
}

.stats-value {
  color: var(--color-text-primary);
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

.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--size-6);
  margin-bottom: var(--size-6);
  border-bottom: 1px solid var(--color-border-light);
}

.popover-pos {
  font-size: var(--size-14);
  font-weight: 500;
  color: var(--color-text-primary);
}

.popover-search-score {
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-primary);
}

.popover-eval-score {
  font-size: var(--size-11);
  color: var(--color-text-secondary);
  margin-bottom: var(--size-6);
}

.popover-breakdown {
  font-family: monospace;
}

.popover-section-label {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
  margin-top: var(--size-4);
  margin-bottom: var(--size-2);
}

.popover-section-label:first-child {
  margin-top: 0;
}

.popover-row {
  display: flex;
  justify-content: space-between;
  gap: var(--size-12);
  padding: var(--size-1) 0;
  font-size: var(--size-11);
}

.popover-label {
  color: var(--color-text-secondary);
}

.popover-value {
  color: var(--color-text-primary);
  font-weight: 500;
}

/* 予想手順 (PV) */
.popover-pv {
  margin-top: var(--size-6);
  padding-top: var(--size-6);
  border-top: 1px solid var(--color-border-light);
}

.pv-sequence {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4);
  font-size: var(--size-11);
  font-family: monospace;
}

.pv-move {
  padding: var(--size-1) var(--size-4);
  border-radius: var(--size-4);
}

.pv-self {
  background: rgba(95, 222, 236, 0.15);
  color: var(--color-primary);
}

.pv-opponent {
  background: rgba(0, 0, 0, 0.08);
  color: var(--color-text-secondary);
}

/* 探索末端の評価 */
.popover-leaf {
  margin-top: var(--size-6);
  padding-top: var(--size-6);
  border-top: 1px solid var(--color-border-light);
}

.leaf-summary {
  display: flex;
  align-items: baseline;
  gap: var(--size-6);
  font-size: var(--size-11);
  font-family: monospace;
  margin-bottom: var(--size-6);
}

.leaf-total {
  font-size: var(--size-13);
  color: var(--color-primary);
  font-weight: 500;
}

.leaf-calc {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
}

.leaf-breakdown-section {
  margin-top: var(--size-4);
}

.leaf-breakdown-header {
  font-size: var(--size-10);
  color: var(--color-text-secondary);
  margin-bottom: var(--size-2);
}

.leaf-breakdown-row {
  display: flex;
  justify-content: space-between;
  gap: var(--size-8);
  padding: var(--size-1) 0;
  font-size: var(--size-10);
  font-family: monospace;
}

.leaf-breakdown-label {
  color: var(--color-text-secondary);
}

.leaf-breakdown-value {
  color: var(--color-text-primary);
}

.popover-selected {
  margin-top: var(--size-6);
  padding-top: var(--size-6);
  border-top: 1px solid var(--color-border-light);
  color: var(--color-primary);
  font-size: var(--size-10);
  text-align: center;
}
</style>
