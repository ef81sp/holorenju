<script setup lang="ts">
import { computed, useTemplateRef } from "vue";

export type CutinType = "correct" | "wrong" | "win" | "draw" | "lose";

interface Props {
  type: CutinType;
  anchor?: string;
}

const props = defineProps<Props>();

const popoverRef = useTemplateRef("popoverRef");

const iconSrc = computed(() => {
  const imageMap: Record<CutinType, string> = {
    correct: new URL(
      "@/assets/question-result/holorenju-seikai.svg",
      import.meta.url,
    ).href,
    wrong: new URL(
      "@/assets/question-result/holorenju-zannen.svg",
      import.meta.url,
    ).href,
    win: new URL(
      "@/assets/question-result/holorenju-appare.svg",
      import.meta.url,
    ).href,
    draw: new URL(
      "@/assets/question-result/holorenju-hikiwake.svg",
      import.meta.url,
    ).href,
    lose: new URL(
      "@/assets/question-result/holorenju-zannen.svg",
      import.meta.url,
    ).href,
  };
  return imageMap[props.type];
});

const altText = computed(() => {
  const altMap: Record<CutinType, string> = {
    correct: "せいかい",
    wrong: "ざんねん",
    win: "あっぱれ",
    draw: "ひきわけ",
    lose: "ざんねん",
  };
  return altMap[props.type];
});

const showPopover = (): void => {
  popoverRef.value?.showPopover();
  document.body.inert = true;
};

const hidePopover = (): void => {
  popoverRef.value?.hidePopover();
  document.body.inert = false;
};

defineExpose({
  showPopover,
  hidePopover,
});
</script>

<template>
  <div
    ref="popoverRef"
    popover="manual"
    :anchor="anchor"
    class="cutin-overlay"
  >
    <div class="cutin-wrapper">
      <img
        :src="iconSrc"
        class="cutin-icon"
        :alt="altText"
      />
    </div>
  </div>
</template>

<style scoped>
/* Firefox向けフォールバック: 親要素内で全体を覆う */
.cutin-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  margin: 0;
  padding: 0;
  pointer-events: none;
  background-color: inherit;
  opacity: 0;
  transition:
    opacity var(--duration-cutin-overlay) ease-out,
    display var(--duration-cutin-overlay) ease-out allow-discrete;
}

.cutin-overlay:popover-open {
  opacity: 1;
}

@starting-style {
  .cutin-overlay:popover-open {
    opacity: 0;
  }
}

.cutin-overlay::backdrop {
  background: inherit;
}

.cutin-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Firefox向けフォールバック: flexで中央配置 */
.cutin-icon {
  width: var(--size-350);
  aspect-ratio: 1 / 1;
  transform: scale(0.9);
  transition: transform var(--duration-cutin-overlay) ease-out;
}

.cutin-overlay:popover-open .cutin-icon {
  transform: scale(1);
}

@starting-style {
  .cutin-overlay:popover-open .cutin-icon {
    transform: scale(0.9);
  }
}

/* Anchor Positioning API対応ブラウザ: アイコンを連珠盤の中心に配置 */
@supports (anchor-name: --test) {
  .cutin-icon {
    position: fixed;
    position-anchor: --board-area;
    top: anchor(center);
    left: anchor(center);
    translate: -50% -50%;
  }
}
</style>
