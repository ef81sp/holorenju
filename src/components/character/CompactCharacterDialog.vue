<script setup lang="ts">
/**
 * コンパクトダイアログ（盤面拡大モード用）
 *
 * 狭い右パネル向け。小アバター＋キャラ名＋テキストを横並びで表示。
 */

import { computed } from "vue";

import type { DialogMessage } from "@/types/character";
import CharacterSprite from "./CharacterSprite.vue";
import DialogText from "@/components/common/DialogText.vue";
import { CHARACTER_CONFIG } from "./characterConfig";

interface Props {
  message: DialogMessage | null;
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  canNavigatePrevious: false,
  canNavigateNext: false,
});

const emit = defineEmits<{
  dialogClicked: [];
  dialogNext: [];
  dialogPrevious: [];
}>();

const characterInfo = computed(() => {
  if (!props.message) {
    return null;
  }
  const charType = props.message.character as "fubuki" | "miko";
  return CHARACTER_CONFIG[charType];
});
</script>

<template>
  <div
    v-if="message && characterInfo"
    class="compact-dialog"
    :style="{ borderColor: characterInfo.borderColor }"
    @click="emit('dialogClicked')"
  >
    <!-- アバター（小） -->
    <div
      class="compact-avatar"
      :style="{ backgroundColor: characterInfo.avatarBg }"
    >
      <CharacterSprite
        :character="message.character"
        :emotion-id="message.emotion"
        :is-active="true"
      />
    </div>

    <!-- テキスト部分 -->
    <div class="compact-dialog-body">
      <div class="compact-dialog-header">
        <div
          class="compact-character-name"
          :style="{ color: characterInfo.nameColor }"
        >
          {{ characterInfo.name }}
        </div>
        <div
          v-if="canNavigatePrevious || canNavigateNext"
          class="compact-nav-buttons"
        >
          <button
            class="compact-nav-button"
            :disabled="!canNavigatePrevious"
            @click.stop="emit('dialogPrevious')"
          >
            ◀
          </button>
          <button
            class="compact-nav-button"
            :disabled="!canNavigateNext"
            @click.stop="emit('dialogNext')"
          >
            ▶
          </button>
        </div>
      </div>
      <div class="compact-dialog-text">
        <DialogText :nodes="message.text" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.compact-dialog {
  display: flex;
  gap: var(--size-6);
  align-items: stretch;
  padding: var(--size-6);
  background: white;
  border-radius: var(--size-8);
  border: var(--size-2) solid;
  box-shadow: 0 var(--size-2) var(--size-6) rgba(0, 0, 0, 0.08);
  cursor: pointer;
  user-select: none;
}

.compact-avatar {
  flex-shrink: 0;
  width: var(--size-48);
  align-self: center;
  aspect-ratio: 1;
  border-radius: var(--size-6);
  border: var(--size-1) solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.compact-dialog-body {
  flex: 1;
  min-width: 0;
  align-self: flex-start;
}

.compact-dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--size-1);
}

.compact-character-name {
  font-weight: 500;
  font-size: var(--font-size-10);
}

.compact-nav-buttons {
  display: flex;
  gap: var(--size-4);
}

.compact-nav-button {
  padding: var(--size-1) var(--size-4);
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-8);
  color: var(--color-text-secondary);
  transition: color 0.2s;
}

.compact-nav-button:hover:not(:disabled) {
  color: var(--color-fubuki-primary);
}

.compact-nav-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.compact-dialog-text {
  font-size: var(--font-size-12);
  line-height: 1.4;
}
</style>
