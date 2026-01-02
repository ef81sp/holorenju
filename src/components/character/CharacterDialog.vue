<script setup lang="ts">
import { computed } from "vue";

import type {
  DialogMessage,
  CharacterType,
  EmotionId,
} from "@/types/character";
import CharacterSprite from "./CharacterSprite.vue";
import DialogText from "@/components/common/DialogText.vue";

// Props
interface Props {
  message: DialogMessage | null;
  position?: "left" | "right";
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  position: "left",
  canNavigatePrevious: false,
  canNavigateNext: false,
});

// Emits
const emit = defineEmits<{
  choiceSelected: [choiceId: string];
  dialogClicked: [];
  dialogNext: [];
  dialogPrevious: [];
}>();

// キャラクター情報
const characterInfo = computed(() => {
  if (!props.message) {
    return null;
  }

  const charType = props.message.character as "fubuki" | "miko";
  return {
    fubuki: {
      avatarBg: "#77DFFF",
      color: "#54C7EA",
      name: "フブキ先生",
    },
    miko: {
      avatarBg: "#FF9CB4",
      color: "#FE4B74",
      name: "みこ",
    },
  }[charType];
});

// 選択肢がクリックされた
const handleChoiceClick = (choiceId: string): void => {
  emit("choiceSelected", choiceId);
};
</script>

<template>
  <div
    v-if="message"
    class="character-dialog"
    :class="`position-${position}`"
  >
    <!-- アバター -->
    <div
      class="avatar"
      :style="{ backgroundColor: characterInfo?.avatarBg }"
    >
      <CharacterSprite
        :character="message.character"
        :emotion-id="message.emotion"
      />
    </div>

    <!-- 吹き出し -->
    <div
      class="dialog-bubble"
      :style="{ borderColor: characterInfo?.color }"
      @click="() => emit('dialogClicked')"
    >
      <div class="character-name-container">
        <div
          class="character-name"
          :style="{ color: characterInfo?.color }"
        >
          {{ characterInfo?.name }}
        </div>
        <div class="dialogue-nav-buttons">
          <button
            class="nav-button"
            :disabled="!canNavigatePrevious"
            @click.stop="emit('dialogPrevious')"
          >
            ◀戻る
          </button>
          <button
            class="nav-button"
            :disabled="!canNavigateNext"
            @click.stop="emit('dialogNext')"
          >
            進む▶
          </button>
        </div>
      </div>
      <DialogText :nodes="message.text" />

      <!-- 選択肢 -->
      <div
        v-if="message.choices && message.choices.length > 0"
        class="choices"
      >
        <button
          v-for="choice in message.choices"
          :key="choice.id"
          class="choice-button"
          @click="handleChoiceClick(choice.id)"
        >
          {{ choice.text }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.character-dialog {
  display: flex;
  gap: var(--size-12);
  align-items: flex-start;
  padding-block: var(--size-5);
  animation: fadeIn 0.3s ease-in;
  height: 100%;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(var(--size-10));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.position-right.character-dialog {
  flex-direction: row-reverse;
}

.avatar {
  flex-shrink: 0;
  max-height: var(--size-100);
  aspect-ratio: 1;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 var(--size-5) var(--size-5) rgba(0, 0, 0, 0.1);
}

.avatar-icon {
  font-size: var(--size-32);
}

.dialog-bubble {
  flex: 1;
  height: 100%;
  padding: var(--size-8);
  background: white;
  border-radius: var(--size-12);
  border: var(--size-2) solid;
  box-shadow: 0 var(--size-5) var(--size-8) rgba(0, 0, 0, 0.1);
  position: relative;
}

.position-left .dialog-bubble::before {
  content: "";
  position: absolute;
  left: calc(-1 * var(--size-10));
  top: var(--size-20);
  width: 0;
  height: 0;
  border-style: solid;
  border-width: var(--size-10) var(--size-10) var(--size-10) 0;
  border-color: transparent currentColor transparent transparent;
}

.position-right .dialog-bubble::before {
  content: "";
  position: absolute;
  right: calc(-1 * var(--size-10));
  top: var(--size-20);
  width: 0;
  height: 0;
  border-style: solid;
  border-width: var(--size-10) 0 var(--size-10) var(--size-10);
  border-color: transparent transparent transparent currentColor;
}

.character-name-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--size-8);
  gap: var(--size-8);
}

.character-name {
  font-weight: 500;
  font-size: var(--size-14);
}

.dialogue-nav-buttons {
  display: flex;
  gap: var(--size-6);
}

.nav-button {
  padding: var(--size-2);
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-secondary);
  transition: color 0.2s;
  white-space: nowrap;
}

.nav-button:hover:not(:disabled) {
  color: var(--color-fubuki-primary);
}

.nav-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.dialog-text {
  color: var(--color-text-primary);
  line-height: 1.6;
  font-size: var(--size-16);
  white-space: pre-wrap;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: var(--size-8);
  margin-top: var(--size-16);
}

.choice-button {
  padding: var(--size-10) var(--size-16);
  background: var(--color-bg-gray);
  border: 2px solid var(--color-border);
  border-radius: var(--size-8);
  cursor: pointer;
  font-size: var(--size-14);
  transition: all 0.2s;
  text-align: left;
}

.choice-button:hover {
  background: var(--color-fubuki-bg);
  border-color: var(--color-fubuki-primary);
  transform: translateX(var(--size-5));
}

.choice-button:active {
  transform: translateX(var(--size-5)) scale(0.98);
}
</style>
