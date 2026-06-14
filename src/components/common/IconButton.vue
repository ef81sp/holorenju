<script setup lang="ts">
/**
 * 共通のアイコンボタン。
 *
 * - size: lg=40 / md=32 / sm=28 / xs=24（px は --size-* に解決）
 * - variant: toolbar（白背景・枠線あり）/ ghost（透明・枠線なし）
 * - label: アイコン下に表示する短いラベル（xs では非表示）
 * - tone: 'accent' で fubuki カラーに着色（コピー成功表示など）
 * - labelSize='small': 4 文字を 40px 枠に収めるための 7px 例外（FullscreenButton 用）
 *
 * label を渡さない場合は呼び出し側で aria-label を付与してアクセシブル名を確保すること。
 */
type IconButtonSize = "lg" | "md" | "sm" | "xs";
type IconButtonVariant = "toolbar" | "ghost";
type IconButtonTone = "default" | "accent";
type IconButtonLabelSize = "default" | "small";

interface Props {
  size: IconButtonSize;
  variant: IconButtonVariant;
  label?: string;
  disabled?: boolean;
  tone?: IconButtonTone;
  labelSize?: IconButtonLabelSize;
}

withDefaults(defineProps<Props>(), {
  label: undefined,
  disabled: undefined,
  tone: "default",
  labelSize: "default",
});

defineEmits<{
  click: [MouseEvent];
}>();
</script>

<template>
  <button
    class="icon-button"
    :class="[
      `icon-button--${size}`,
      `icon-button--${variant}`,
      tone !== 'default' && `icon-button--tone-${tone}`,
      labelSize !== 'default' && `icon-button--label-${labelSize}`,
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

  & .icon-button__label {
    font-size: var(--size-9);
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

  & .icon-button__label {
    font-size: var(--size-8);
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

  & .icon-button__label {
    font-size: var(--size-8);
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

/* 「画面縮小」など 4 文字を 40px に収めるための小サイズラベル */
.icon-button--label-small .icon-button__label {
  font-size: var(--size-7);
}
</style>
