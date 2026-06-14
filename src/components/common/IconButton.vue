<script setup lang="ts">
/**
 * 共通のアイコンボタン。
 *
 * - size: lg=40 / md=32 / sm=28 / xs=24（px は --size-* に解決）
 * - variant: toolbar（白背景・枠線あり）/ ghost（透明・枠線なし）
 * - label: アイコン下に表示する短いラベル（最大 5 文字。xs では非表示）
 *   フォントサイズは文字数に応じて自動で決まる
 *   （長文ほど縮小して 40/32/28 px の枠に収める）
 * - tone: 'accent' で fubuki カラーに着色（コピー成功表示など）
 *
 * label を渡さない場合は呼び出し側で aria-label を付与してアクセシブル名を確保すること。
 */
import { computed } from "vue";

type IconButtonSize = "lg" | "md" | "sm" | "xs";
type IconButtonVariant = "toolbar" | "ghost";
type IconButtonTone = "default" | "accent";

interface Props {
  size: IconButtonSize;
  variant: IconButtonVariant;
  label?: string;
  disabled?: boolean;
  tone?: IconButtonTone;
}

const props = withDefaults(defineProps<Props>(), {
  label: undefined,
  disabled: undefined,
  tone: "default",
});

defineEmits<{
  click: [MouseEvent];
}>();

// data-length は文字数（最大 5）。CSS 側で属性セレクタで font-size を切替
const labelLength = computed(() =>
  props.label ? Math.min(props.label.length, 5) : undefined,
);
</script>

<template>
  <button
    class="icon-button"
    :class="[
      `icon-button--${size}`,
      `icon-button--${variant}`,
      tone !== 'default' && `icon-button--tone-${tone}`,
    ]"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <span class="icon-button__icon">
      <slot />
    </span>
    <span
      v-if="label"
      class="icon-button__label"
      :data-length="labelLength"
    >
      {{ label }}
    </span>
  </button>
</template>

<style scoped>
.icon-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-text-secondary);
  box-sizing: border-box;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.icon-button__icon {
  display: block;
  flex-shrink: 0;
}

.icon-button__icon :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
}

.icon-button__label {
  line-height: 1;
  font-weight: 500;
  white-space: nowrap;
}

/* Sizes */
.icon-button--lg {
  width: var(--size-40);
  height: var(--size-40);
  padding: var(--size-3);
  gap: var(--size-2);

  & .icon-button__icon {
    width: var(--size-20);
    height: var(--size-20);
  }
}

.icon-button--md {
  width: var(--size-32);
  height: var(--size-32);
  padding: var(--size-2);
  gap: var(--size-1);

  & .icon-button__icon {
    width: var(--size-14);
    height: var(--size-14);
  }
}

.icon-button--sm {
  width: var(--size-28);
  height: var(--size-28);
  padding: var(--size-2);
  gap: var(--size-1);

  & .icon-button__icon {
    width: var(--size-14);
    height: var(--size-14);
  }
}

.icon-button--xs {
  width: var(--size-24);
  height: var(--size-24);
  padding: var(--size-4);

  & .icon-button__icon {
    width: 100%;
    height: 100%;
  }
}

/* Label font-size: デフォルト（〜3 文字） */
.icon-button--lg .icon-button__label {
  font-size: var(--size-9);
}
.icon-button--md .icon-button__label,
.icon-button--sm .icon-button__label {
  font-size: var(--size-8);
}

/* Label font-size: 4 文字 */
.icon-button--lg .icon-button__label[data-length="4"] {
  font-size: var(--size-7);
}
.icon-button--md .icon-button__label[data-length="4"] {
  font-size: var(--size-6);
}
.icon-button--sm .icon-button__label[data-length="4"] {
  font-size: var(--size-5);
}

/* Label font-size: 5 文字 */
.icon-button--lg .icon-button__label[data-length="5"] {
  font-size: var(--size-6);
}
.icon-button--md .icon-button__label[data-length="5"] {
  font-size: var(--size-5);
}
.icon-button--sm .icon-button__label[data-length="5"] {
  font-size: var(--size-5);
}

/* Variants */
.icon-button--toolbar {
  background: rgba(255, 255, 255, 0.9);
  border: var(--size-2) solid var(--color-border);
  border-radius: var(--size-8);
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: white;
    border-color: var(--color-border-heavy);
    color: var(--color-text-primary);
  }
}

.icon-button--ghost {
  background: transparent;
  border: none;
  border-radius: var(--size-6);
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--color-bg-gray);
    color: var(--color-text-primary);
  }
}

/* xs は ghost より細い角丸（小さい枠との比率を保つ） */
.icon-button--ghost.icon-button--xs {
  border-radius: var(--size-4);
}

/* Tone */
.icon-button--tone-accent {
  color: var(--color-fubuki-primary);
}
</style>
