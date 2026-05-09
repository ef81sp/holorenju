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

import { toRef } from "vue";

import type { PVDisplayItem } from "./composables/useReviewProgression";
import { useRovingTabindex } from "./composables/useRovingTabindex";

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

function isSelected(optId: string): boolean {
  return optId === props.selectedId;
}

const { onKeydown: onArrowKeydown } = useRovingTabindex({
  items: toRef(() => props.options),
  getId: (o) => o.id,
  onChange: (id) => emit("select", id),
  orientation: "both",
});

/**
 * radio の Space / Enter は明示的選択。共通 composable の矢印操作と
 * 合流させ、それ以外は素通り。
 */
function onKeydown(event: KeyboardEvent, currentId: string): void {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    if (!isSelected(currentId)) {
      emit("select", currentId);
    }
    return;
  }
  onArrowKeydown(event, currentId);
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
      ref="items"
      type="button"
      role="radio"
      :aria-checked="isSelected(opt.id)"
      :aria-label="
        opt.id === 'best'
          ? `${opt.item.moveNum} 手目 ${opt.item.coord}（推奨手）`
          : `${opt.item.moveNum} 手目 ${opt.item.coord}（代替手）`
      "
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
      <span
        class="m-num"
        aria-hidden="true"
      >
        {{ opt.item.moveNum }}
      </span>
      <span
        class="m-coord"
        aria-hidden="true"
      >
        {{ opt.item.coord }}
      </span>
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
  background: var(--color-bg-white);
  border-bottom-color: var(--color-fubuki-primary);
}

.prog-branch.is-current-row {
  border-bottom-color: var(--color-fubuki-primary);
  box-shadow: 0 var(--size-2) var(--size-8)
    color-mix(in srgb, var(--color-fubuki-primary) 25%, transparent);
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

/*
 * 端タブの外側角はコンテナの border-radius に合わせて丸める。
 * 角を丸めないとフォーカスリング（outline-offset で内側に描画）が
 * 矩形になり、コンテナの overflow:hidden で見た目だけ角が丸い形と
 * 一致しなくなる。
 */
.prog-opt:first-child {
  border-top-left-radius: calc(var(--size-8) - 1px);
  border-bottom-left-radius: calc(var(--size-8) - 1px);
}

.prog-opt:last-child {
  border-right: none;
  border-top-right-radius: calc(var(--size-8) - 1px);
  border-bottom-right-radius: calc(var(--size-8) - 1px);
}

.prog-opt:hover {
  background: var(--color-bg-white);
}

.prog-opt:focus-visible {
  outline: var(--size-2) solid var(--color-fubuki-primary);
  outline-offset: calc(var(--size-2) * -1);
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
  background: var(--color-bg-white);
  color: var(--color-fubuki-name);
}

.prog-opt.is-selected::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(var(--size-2) * -1);
  height: var(--size-2);
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
  background: var(--color-stone-black);
  color: var(--color-bg-white);
}

.prog-opt.white .m-num {
  background: var(--color-bg-white);
  color: var(--color-stone-black);
  border: 1px solid var(--color-border-heavy);
}

.prog-opt .m-coord {
  font-size: var(--font-size-13);
  color: var(--color-text-primary);
  line-height: 1.1;
  text-align: center;
}
</style>
