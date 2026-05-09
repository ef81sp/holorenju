<script setup lang="ts">
/**
 * 分岐の代替手選択（APG radiogroup パターン）
 *
 * 進行ツリーの分岐ポイントで、複数の代替手から1つを選ぶ。
 * 見た目はタブ風だが、選択結果が後続行のフローを変えるだけで
 * 独立した tabpanel を持たないため、role="radiogroup" を採用する。
 *
 * - role="radiogroup" / role="radio" / aria-checked
 * - Roving tabindex: 選択中のオプションだけ tabindex=0
 * - キーボード（APG 推奨の自動選択モード）:
 *   - ArrowLeft / ArrowUp:  前のオプション（先頭でラップ）に移動＋選択
 *   - ArrowRight / ArrowDown: 次のオプション（末尾でラップ）に移動＋選択
 *   - Home: 先頭、End: 末尾
 *   - Space / Enter: 現在フォーカス中のオプションを明示的に選択
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 */

import { nextTick, useTemplateRef } from "vue";

import type { PVDisplayItem } from "./composables/useReviewProgression";

interface Option {
  id: string;
  item: PVDisplayItem;
}

const props = defineProps<{
  options: Option[];
  selectedId: string;
  /** スクリーンリーダー用の説明（例: "12 手目の代替手"） */
  groupLabel: string;
  /** 行の表示状態（is-played / is-current-row） */
  rowClass?: Record<string, boolean>;
}>();

const emit = defineEmits<{
  select: [optId: string];
  preview: [optId: string];
  previewLeave: [];
}>();

const buttonsRef = useTemplateRef<HTMLButtonElement[]>("buttons");

function isSelected(optId: string): boolean {
  return optId === props.selectedId;
}

function focusIndex(idx: number): void {
  nextTick(() => {
    buttonsRef.value?.[idx]?.focus();
  });
}

function onKeydown(event: KeyboardEvent, currentId: string): void {
  const opts = props.options;
  const currentIdx = opts.findIndex((o) => o.id === currentId);
  if (currentIdx < 0) {
    return;
  }
  let nextIdx = -1;
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowUp":
      nextIdx = (currentIdx - 1 + opts.length) % opts.length;
      break;
    case "ArrowRight":
    case "ArrowDown":
      nextIdx = (currentIdx + 1) % opts.length;
      break;
    case "Home":
      nextIdx = 0;
      break;
    case "End":
      nextIdx = opts.length - 1;
      break;
    case " ":
    case "Enter":
      event.preventDefault();
      event.stopPropagation();
      if (!isSelected(currentId)) {
        emit("select", currentId);
      }
      return;
    default:
      return;
  }
  // window レベルの Arrow / Home / End（手数送り）を抑止
  event.preventDefault();
  event.stopPropagation();
  const next = opts[nextIdx];
  if (next) {
    emit("select", next.id);
    focusIndex(nextIdx);
  }
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="groupLabel"
    class="prog-branch"
    :class="rowClass"
  >
    <button
      v-for="opt in options"
      :key="opt.id"
      ref="buttons"
      type="button"
      role="radio"
      :aria-checked="isSelected(opt.id)"
      :tabindex="isSelected(opt.id) ? 0 : -1"
      class="prog-opt"
      :class="[
        opt.item.moveNum % 2 === 1 ? 'black' : 'white',
        {
          'is-best-opt': opt.id === 'best',
          'is-selected': isSelected(opt.id),
        },
      ]"
      @click="emit('select', opt.id)"
      @keydown="onKeydown($event, opt.id)"
      @mouseenter="emit('preview', opt.id)"
      @mouseleave="emit('previewLeave')"
      @focus="emit('preview', opt.id)"
      @blur="emit('previewLeave')"
    >
      <span class="m-num">{{ opt.item.moveNum }}</span>
      <span class="m-coord">{{ opt.item.coord }}</span>
    </button>
  </div>
</template>

<style scoped>
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

.prog-opt:focus-visible {
  outline: var(--size-2) solid var(--color-fubuki-primary);
  outline-offset: -2px;
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

.prog-opt.black .m-num {
  background: #1a1a1a;
  color: #fff;
}

.prog-opt.white .m-num {
  background: #fff;
  color: #1a1a1a;
  border: 1px solid var(--color-border-heavy);
}

.prog-opt .m-coord {
  font-size: var(--font-size-13);
  color: var(--color-text-primary);
  line-height: 1.1;
  text-align: center;
}
</style>
