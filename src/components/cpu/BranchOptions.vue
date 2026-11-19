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

import type { PVDisplayItem } from "./composables/progressionModel";
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
/*
 * 選択肢は独立したボタンとして並べ、点線枠で 1 つの分岐行にまとめる。
 * 番号丸が各ボタンの左上の角からはみ出すため、枠の内側に余白を取る。
 */
.prog-branch {
  grid-column: 1 / -1;
  display: flex;
  align-items: stretch;
  gap: var(--size-4);
  padding: var(--size-8);
  border-radius: var(--size-8);
  background: var(--color-bg-gray);
  border: 1px dashed var(--color-border-heavy);
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
  border-color: var(--color-fubuki-primary);
}

.prog-branch.is-current-row {
  border-color: var(--color-fubuki-primary);
  box-shadow: 0 var(--size-2) var(--size-8)
    color-mix(in srgb, var(--color-fubuki-primary) 25%, transparent);
}

.prog-opt {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--size-32);
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  border-radius: var(--size-8);
  background: var(--color-bg-white);
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

/* 選択中（枠色＋背景）と区別するため、ホバーは背景の薄い色だけ */
.prog-opt:hover {
  background: var(--color-fubuki-bg-light);
}

.prog-opt:focus-visible {
  outline: var(--size-2) solid var(--color-fubuki-primary);
  outline-offset: calc(var(--size-2) * -1);
}

.prog-opt.is-best-opt::after {
  content: "";
  position: absolute;
  top: var(--size-4);
  right: var(--size-4);
  width: var(--size-4);
  height: var(--size-4);
  border-radius: 50%;
  background: var(--color-blue-500);
}

.prog-opt.is-selected {
  border-color: var(--color-fubuki-primary);
  background: var(--color-fubuki-bg-light);
  color: var(--color-fubuki-name);
}

/* 番号丸: 左上の角に重ねる真円。数字は字面の上下余白を切って中央へ */
.prog-opt .m-num {
  position: absolute;
  top: calc(var(--size-4) * -1);
  left: calc(var(--size-4) * -1);
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--size-16);
  height: var(--size-16);
  box-sizing: border-box;
  border-radius: 50%;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  /* 丸は固定サイズなので、文字倍率をかけない固定値にしてはみ出しを防ぐ */
  font-size: var(--size-9);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-box: trim-both cap alphabetic;
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
