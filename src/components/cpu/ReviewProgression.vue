<script setup lang="ts">
/**
 * 振り返り評価パネルの「最善の進行 ＋ 分岐」セクション
 *
 * - 上位タブ: 最善 / 実際 / 被詰
 * - 各タブ内に進行ツリーを描画。分岐ポイントでは該当深度に
 *   インラインタブとして複数候補を提示し、選択次第で続きを切り替える
 * - 操作: 「全表示／1つ進む／リセット」
 * - ホバー/クリックで盤面に手順をプレビュー（hoverPvMove emit）
 *
 * ロジック・状態は `useReviewProgression` composable に分離している。
 */

import { toRef } from "vue";

import type { EvaluatedMove } from "@/types/review";
import type { Position } from "@/types/game";
import { useReviewProgression } from "./composables/useReviewProgression";

const props = defineProps<{
  evaluation: EvaluatedMove;
  moveIndex: number;
}>();

const emit = defineEmits<{
  hoverPvMove: [
    items: { position: Position; isSelf: boolean }[],
    type: "best" | "played",
  ];
  leavePvMove: [];
}>();

const {
  topTabs,
  activeTabId,
  rows,
  step,
  showAll,
  hasSelections,
  switchTab,
  toggleShowAll,
  stepForward,
  resetTree,
  jumpTo,
  selectBranchOption,
  isOptionSelected,
  previewHoverMove,
  previewHoverOption,
  previewLeave,
} = useReviewProgression({
  evaluation: toRef(() => props.evaluation as EvaluatedMove | null),
  moveIndex: toRef(() => props.moveIndex),
  emitHover: (items, type) => emit("hoverPvMove", items, type),
  emitLeave: () => emit("leavePvMove"),
});
</script>

<template>
  <section
    v-if="topTabs.length > 0"
    class="panel-section tree-section"
  >
    <div class="panel-label">
      <span>最善の進行</span>
      <span
        v-if="rows.length > 0"
        class="panel-label-count"
      >
        {{ rows.length }}手
      </span>
    </div>

    <div
      v-if="topTabs.length > 1"
      class="tree-tabs"
      role="tablist"
    >
      <button
        v-for="t in topTabs"
        :key="t.id"
        type="button"
        role="tab"
        class="tree-tab"
        :class="{
          'is-on': activeTabId === t.id,
          'is-loss': t.id === 'loss',
        }"
        @click="switchTab(t.id)"
      >
        <span class="tab-label">{{ t.label }}</span>
        <span
          v-if="t.sub"
          class="tab-sub"
        >
          {{ t.sub }}
        </span>
      </button>
    </div>

    <div class="tree-controls">
      <button
        type="button"
        class="ctl-btn primary"
        :class="{ 'is-on': showAll }"
        :disabled="rows.length === 0"
        @click="toggleShowAll"
      >
        全表示
      </button>
      <button
        type="button"
        class="ctl-btn"
        :disabled="step >= rows.length"
        @click="stepForward"
      >
        1つ進む
      </button>
      <button
        type="button"
        class="ctl-btn"
        :disabled="step === 0 && !showAll && !hasSelections"
        @click="resetTree"
      >
        リセット
      </button>
    </div>

    <div class="tree-scroll">
      <div
        v-if="rows.length > 0"
        class="prog-list"
      >
        <template
          v-for="(row, i) in rows"
          :key="row.key"
        >
          <button
            v-if="row.type === 'move'"
            type="button"
            class="prog-move"
            :class="[
              row.item.moveNum % 2 === 1 ? 'black' : 'white',
              {
                'is-played': i < step,
                'is-current': i === step - 1,
              },
            ]"
            @mouseenter="previewHoverMove(i)"
            @mouseleave="previewLeave"
            @focus="previewHoverMove(i)"
            @blur="previewLeave"
            @click="jumpTo(i)"
          >
            <span class="m-num">{{ row.item.moveNum }}</span>
            <span class="m-coord">{{ row.item.coord }}</span>
          </button>
          <div
            v-else
            class="prog-branch"
            :class="{
              'is-played': i < step,
              'is-current-row': i === step - 1,
            }"
          >
            <button
              v-for="opt in row.options"
              :key="opt.id"
              type="button"
              class="prog-opt"
              :class="[
                opt.item.moveNum % 2 === 1 ? 'black' : 'white',
                {
                  'is-best-opt': opt.id === 'best',
                  'is-selected': isOptionSelected(row.pvIdx, opt.id),
                },
              ]"
              @mouseenter="previewHoverOption(i, opt.id)"
              @mouseleave="previewLeave"
              @focus="previewHoverOption(i, opt.id)"
              @blur="previewLeave"
              @click="selectBranchOption(i, opt.id)"
            >
              <span class="m-num">{{ opt.item.moveNum }}</span>
              <span class="m-coord">{{ opt.item.coord }}</span>
            </button>
          </div>
        </template>
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

.tree-section {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.tree-tabs {
  display: flex;
  gap: var(--size-1);
  border-bottom: 1px solid var(--color-border);
  overflow-x: auto;
  scrollbar-width: thin;
  flex-shrink: 0;
}

.tree-tabs::-webkit-scrollbar {
  height: 4px;
}

.tree-tabs::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.tree-tab {
  flex: 1 0 auto;
  min-width: var(--size-60);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-4) var(--size-6) var(--size-5);
  margin-bottom: -1px;
  background: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-bottom: none;
  border-radius: var(--size-6) var(--size-6) 0 0;
  font-family: inherit;
  font-size: var(--font-size-11);
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  line-height: 1.2;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.tree-tab:hover {
  background: var(--color-bg-white);
  color: var(--color-fubuki-name);
}

.tree-tab.is-on {
  background: #fff;
  color: var(--color-fubuki-name);
  border-bottom: 1px solid #fff;
  z-index: 1;
}

.tree-tab.is-loss {
  color: hsl(0, 55%, 45%);
}

.tree-tab.is-on.is-loss {
  color: hsl(0, 65%, 45%);
}

.tree-tab .tab-sub {
  font-size: var(--font-size-9);
  font-weight: var(--font-weight-normal);
  opacity: 0.85;
}

.tree-controls {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: var(--size-4);
  flex-shrink: 0;
}

.ctl-btn {
  font-family: inherit;
  font-size: var(--font-size-10);
  font-weight: 500;
  padding: var(--size-5) var(--size-3);
  border-radius: var(--size-6);
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-text-primary);
  cursor: pointer;
  transition:
    transform 0.12s,
    border-color 0.12s,
    background 0.12s;
}

.ctl-btn:hover:not(:disabled) {
  border-color: var(--color-fubuki-primary);
  transform: translateY(-1px);
}

.ctl-btn:active:not(:disabled) {
  transform: translateY(0);
}

.ctl-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ctl-btn.primary {
  background: var(--color-fubuki-primary);
  color: #fff;
  border-color: var(--color-fubuki-primary);
}

.ctl-btn.primary:hover:not(:disabled) {
  background: var(--color-blue-500);
  border-color: var(--color-blue-500);
}

.ctl-btn.primary.is-on {
  background: var(--color-blue-500);
  border-color: var(--color-blue-500);
}

.tree-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: var(--size-2);
  margin-right: calc(var(--size-2) * -1);
}

.tree-scroll::-webkit-scrollbar {
  width: 6px;
}

.tree-scroll::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.prog-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--size-56), 1fr));
  gap: var(--size-4);
  padding: var(--size-2) 0;
  align-content: start;
}

.prog-move {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-12) var(--size-4) var(--size-4);
  border-radius: var(--size-8);
  border: 1px solid var(--color-border);
  background: #fff;
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-13);
  font-weight: 500;
  font-feature-settings: "tnum";
  cursor: pointer;
  opacity: 0.7;
  min-height: 0;
  transition:
    opacity 0.15s,
    border-color 0.15s,
    background 0.15s,
    transform 0.12s;
}

.prog-move:hover,
.prog-move:focus-visible {
  border-color: var(--color-fubuki-primary);
  opacity: 1;
  outline: none;
}

.prog-move.is-played {
  opacity: 1;
  border-color: var(--color-fubuki-primary);
  background: var(--color-fubuki-bg-light);
}

.prog-move.is-current {
  background: var(--color-fubuki-primary);
  color: #fff;
  border-color: var(--color-fubuki-primary);
  box-shadow: 0 var(--size-2) var(--size-8) rgba(84, 199, 234, 0.45);
  opacity: 1;
}

.prog-move.is-current .m-coord {
  color: #fff;
}

/* 分岐行（タブ付きコンテナ・グリッド全列に展開） */
.prog-branch {
  grid-column: 1 / -1;
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
  border-radius: var(--size-8);
  background: var(--color-bg-gray);
  border: 1px solid var(--color-border);
  border-bottom-width: 2px;
  border-bottom-color: var(--color-border-heavy);
  overflow: hidden;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s,
    opacity 0.15s;
}

.prog-branch:not(.is-played) {
  opacity: 0.85;
}

.prog-branch.is-played {
  background: #fff;
  border-bottom-color: var(--color-fubuki-primary);
}

.prog-branch.is-current-row {
  border-bottom-color: var(--color-fubuki-primary);
  box-shadow: 0 var(--size-2) var(--size-8) rgba(84, 199, 234, 0.25);
}

/* 分岐タブボタン（コンテナ内で等分） */
.prog-opt {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: var(--size-12) var(--size-4) var(--size-4);
  margin: 0;
  border: none;
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-gray);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-13);
  font-weight: 500;
  font-feature-settings: "tnum";
  cursor: pointer;
  flex: 1 1 0;
  min-width: 0;
  transition:
    background 0.15s,
    color 0.15s;
}

.prog-opt:last-child {
  border-right: none;
}

.prog-opt:hover,
.prog-opt:focus-visible {
  background: #fff;
  outline: none;
}

.prog-opt.is-best-opt::after {
  content: "";
  position: absolute;
  top: var(--size-3);
  right: var(--size-3);
  width: var(--size-5);
  height: var(--size-5);
  border-radius: 50%;
  background: var(--color-blue-500);
}

.prog-opt.is-selected {
  background: #fff;
  color: var(--color-fubuki-name);
}

.prog-opt.is-selected::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -2px;
  height: 2px;
  background: var(--color-fubuki-primary);
}

/* 共通: 手番バッジ（カード左肩） */
.prog-move .m-num,
.prog-opt .m-num {
  position: absolute;
  top: var(--size-2);
  left: var(--size-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--size-14);
  height: var(--size-14);
  border-radius: 50%;
  font-size: var(--font-size-9);
  font-weight: 500;
}

.prog-move.black .m-num,
.prog-opt.black .m-num {
  background: #1a1a1a;
  color: #fff;
}

.prog-move.white .m-num,
.prog-opt.white .m-num {
  background: #fff;
  color: #1a1a1a;
  border: 1px solid var(--color-border-heavy);
}

.prog-move.is-current .m-num {
  box-shadow: 0 0 0 1.5px #fff;
}

.prog-move .m-coord,
.prog-opt .m-coord {
  font-size: var(--font-size-13);
  color: var(--color-text-primary);
  line-height: 1.1;
  text-align: center;
}
</style>
