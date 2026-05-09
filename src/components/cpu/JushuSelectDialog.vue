<script setup lang="ts">
/**
 * 珠型選択ダイアログ
 *
 * 26珠型をカード一覧UIで視覚的に選択。
 * 直接打ち（縦横）13種 / 間接打ち（斜め）13種をタブで切り替え。
 */

import { ref, watch } from "vue";

import { useLightDismiss } from "@/composables/useLightDismiss";
import { DIAGONAL_PATTERNS, ORTHOGONAL_PATTERNS } from "@/logic/cpu/opening";

type TabType = "orthogonal" | "diagonal";

const props = defineProps<{
  selectedJushu: string | null;
  fixedDirection: boolean;
}>();

const emit = defineEmits<{
  select: [jushu: string, fixedDirection: boolean];
  clear: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
useLightDismiss(dialogRef);

// 内部状態（props を初期値として使用し、決定時にemit）
const activeTab = ref<TabType>("orthogonal");
const localJushu = ref<string | null>(props.selectedJushu);
const localFixedDirection = ref(props.fixedDirection);

// ダイアログが開かれたときにpropsで同期
watch(
  () => props.selectedJushu,
  (v) => {
    localJushu.value = v;
    // 選択済み珠型のタブを自動選択
    if (v) {
      const isDiag = DIAGONAL_PATTERNS.some((p) => p.name === v);
      activeTab.value = isDiag ? "diagonal" : "orthogonal";
    }
  },
);
watch(
  () => props.fixedDirection,
  (v) => {
    localFixedDirection.value = v;
  },
);

// ミニボード SVG 座標変換（5×5 グリッド: 0-4 → SVG座標）
const GRID_SPACING = 8;
const GRID_ORIGIN = 4;
function toSvg(gridIndex: number): number {
  return GRID_ORIGIN + gridIndex * GRID_SPACING;
}

function handleConfirm(): void {
  if (localJushu.value) {
    emit("select", localJushu.value, localFixedDirection.value);
  }
  dialogRef.value?.close();
}

function handleClear(): void {
  localJushu.value = null;
  emit("clear");
  dialogRef.value?.close();
}

function handleClose(): void {
  dialogRef.value?.close();
}

defineExpose({
  showModal: () => dialogRef.value?.showModal(),
  close: () => dialogRef.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="jushu-dialog"
    closedby="any"
  >
    <div class="dialog-content">
      <header class="dialog-header">
        <h2 class="dialog-title">珠型を選択</h2>
        <button
          type="button"
          class="close-button"
          @click="handleClose"
        >
          ×
        </button>
      </header>

      <!-- タブ切替 -->
      <div
        class="tab-bar"
        role="tablist"
      >
        <button
          role="tab"
          :aria-selected="activeTab === 'orthogonal'"
          :class="['tab-button', { active: activeTab === 'orthogonal' }]"
          @click="activeTab = 'orthogonal'"
        >
          直接打ち（縦横）
        </button>
        <button
          role="tab"
          :aria-selected="activeTab === 'diagonal'"
          :class="['tab-button', { active: activeTab === 'diagonal' }]"
          @click="activeTab = 'diagonal'"
        >
          間接打ち（斜め）
        </button>
      </div>

      <!-- カードグリッド -->
      <div
        class="card-grid"
        role="radiogroup"
        aria-label="珠型"
      >
        <label
          v-for="pattern in activeTab === 'orthogonal'
            ? ORTHOGONAL_PATTERNS
            : DIAGONAL_PATTERNS"
          :key="pattern.name"
          class="jushu-card"
        >
          <input
            v-model="localJushu"
            type="radio"
            name="jushu"
            :value="pattern.name"
            class="visually-hidden"
          />
          <!-- ミニボード: 5×5 グリッド上に3石を表示 -->
          <svg
            class="mini-board"
            viewBox="0 0 40 40"
            aria-hidden="true"
          >
            <line
              v-for="i in 5"
              :key="'v' + i"
              :x1="toSvg(i - 1)"
              :y1="toSvg(0)"
              :x2="toSvg(i - 1)"
              :y2="toSvg(4)"
              class="grid-line"
            />
            <line
              v-for="i in 5"
              :key="'h' + i"
              :x1="toSvg(0)"
              :y1="toSvg(i - 1)"
              :x2="toSvg(4)"
              :y2="toSvg(i - 1)"
              class="grid-line"
            />
            <!-- 黒1: 天元 (2,2) -->
            <circle
              :cx="toSvg(2)"
              :cy="toSvg(2)"
              r="3.2"
              class="stone-black"
            />
            <!-- 白2: 上(直接打ち) / 右上(間接打ち) -->
            <circle
              :cx="toSvg(activeTab === 'orthogonal' ? 2 : 3)"
              :cy="toSvg(1)"
              r="3.2"
              class="stone-white"
            />
            <!-- 黒3: パターン固有の位置（上下反転） -->
            <circle
              :cx="toSvg(2 + pattern.offset.dc)"
              :cy="toSvg(2 - pattern.offset.dr)"
              r="3.2"
              class="stone-black"
            />
          </svg>
          <span class="card-name">{{ pattern.name }}</span>
        </label>
      </div>

      <!-- 方向トグル -->
      <div class="direction-section">
        <span class="direction-label">白2の方向:</span>
        <label class="direction-option">
          <input
            v-model="localFixedDirection"
            type="radio"
            name="direction"
            :value="true"
            class="visually-hidden"
          />
          <span class="direction-text">固定</span>
        </label>
        <label class="direction-option">
          <input
            v-model="localFixedDirection"
            type="radio"
            name="direction"
            :value="false"
            class="visually-hidden"
          />
          <span class="direction-text">ランダム</span>
        </label>
      </div>

      <!-- フッター -->
      <div class="dialog-footer">
        <button
          type="button"
          class="footer-button secondary"
          @click="handleClear"
        >
          ランダムに戻す
        </button>
        <button
          type="button"
          class="footer-button primary"
          :disabled="!localJushu"
          @click="handleConfirm"
        >
          決定
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.jushu-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: var(--size-16);
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: var(--size-600);
  height: var(--size-500);
  overflow: hidden;
  opacity: 0;

  transition:
    opacity 0.15s ease-out,
    overlay 0.15s ease-out allow-discrete,
    display 0.15s ease-out allow-discrete;

  &[open] {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }

  &::backdrop {
    background: rgba(0, 0, 0, 0.5);
    opacity: 0;
    transition:
      opacity 0.15s ease-out,
      overlay 0.15s ease-out allow-discrete,
      display 0.15s ease-out allow-discrete;
  }

  &[open]::backdrop {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }
}

.dialog-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-title {
  margin: 0;
  font-size: var(--size-16);
  font-weight: 500;
  color: var(--color-text-primary);
}

.close-button {
  background: none;
  border: none;
  font-size: var(--size-24);
  cursor: pointer;
  color: var(--color-text-secondary);
  padding: var(--size-4);
  line-height: 1;
  transition: color 0.2s;

  &:hover {
    color: var(--color-text-primary);
  }
}

.tab-bar {
  display: flex;
  gap: var(--size-4);
}

.tab-button {
  flex: 1;
  padding: var(--size-6) var(--size-12);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-6);
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s;

  &.active {
    border-color: var(--color-primary);
    color: var(--color-text-primary);
    background: var(--color-primary-light);
  }

  &:hover:not(.active) {
    background: var(--color-background-hover);
  }
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--size-4);
  padding-block: var(--size-2);
}

.jushu-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-1);
  padding: var(--size-6) var(--size-4);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-6);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    transform: translateY(calc(-1 * var(--size-1)));
    box-shadow: 0 var(--size-2) var(--size-8) rgba(0, 0, 0, 0.1);
  }

  &:has(input:checked) {
    border-color: var(--color-primary);
    background: var(--color-primary-light);
  }

  &:has(input:focus-visible) {
    animation: focus-pulse 1.5s ease-in-out infinite;
  }
}

.mini-board {
  width: var(--size-40);
  height: var(--size-40);
}

.grid-line {
  stroke: var(--color-text-secondary);
  stroke-width: 0.5;
  opacity: 0.4;
}

.stone-black {
  fill: #1a1a2e;
}

.stone-white {
  fill: #f0f0f0;
  stroke: #333;
  stroke-width: 0.5;
}

.card-name {
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-primary);
}

.direction-section {
  display: flex;
  align-items: center;
  gap: var(--size-8);
  padding: var(--size-4) 0;
}

.direction-label {
  font-size: var(--size-12);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.direction-option {
  cursor: pointer;
}

.direction-text {
  display: inline-block;
  padding: var(--size-4) var(--size-10);
  background: var(--color-background-secondary);
  border: var(--size-2) solid transparent;
  border-radius: var(--size-6);
  font-size: var(--size-12);
  color: var(--color-text-secondary);
  transition: all 0.15s;
}

.direction-option:has(input:checked) .direction-text {
  border-color: var(--color-primary);
  color: var(--color-text-primary);
  background: var(--color-primary-light);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--size-8);
}

.footer-button {
  padding: var(--size-8) var(--size-16);
  border: none;
  border-radius: var(--size-8);
  font-size: var(--size-12);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.footer-button.secondary {
  background: var(--color-background-secondary);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border-light);

  &:hover {
    background: var(--color-background-hover);
  }
}

.footer-button.primary {
  background: var(--gradient-button-primary);
  color: var(--color-text-primary);

  &:hover:not(:disabled) {
    transform: translateY(calc(-1 * var(--size-1)));
    box-shadow: 0 var(--size-4) var(--size-12) rgba(95, 222, 236, 0.3);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

@keyframes focus-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 1px var(--color-primary),
      0 0 0 var(--size-2) rgba(95, 222, 236, 0.4);
  }
  50% {
    box-shadow:
      0 0 0 var(--size-2) var(--color-primary),
      0 0 0 var(--size-6) rgba(95, 222, 236, 0.2);
  }
}
</style>
