<script setup lang="ts">
import { computed } from "vue";

import type {
  DialogMessage,
  CharacterType,
  EmotionId,
} from "@/types/character";
import CharacterSprite from "./CharacterSprite.vue";

// Props
interface Props {
  message: DialogMessage | null;
  position?: "left" | "right";
}

const props = withDefaults(defineProps<Props>(), {
  position: "left",
});

// Emits
const emit = defineEmits<{
  choiceSelected: [choiceId: string];
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
        :character="message.character as CharacterType"
        :emotion-id="0"
        :width="80"
        :height="80"
      />
    </div>

    <!-- 吹き出し -->
    <div
      class="dialog-bubble"
      :style="{ borderColor: characterInfo?.color }"
    >
      <div
        class="character-name"
        :style="{ color: characterInfo?.color }"
      >
        {{ characterInfo?.name }}
      </div>
      <div class="dialog-text">
        {{ message.text }}
      </div>

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
  width: var(--size-56);
  height: var(--size-56);
  border-radius: 50%;
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

.character-name {
  font-weight: 500;
  font-size: var(--size-14);
  margin-bottom: var(--size-8);
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
