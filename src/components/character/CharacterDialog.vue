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
  leftCharacter?: {
    character: CharacterType;
    emotion: EmotionId;
    isActive: boolean;
  } | null;
  rightCharacter?: {
    character: CharacterType;
    emotion: EmotionId;
    isActive: boolean;
  } | null;
  canNavigatePrevious?: boolean;
  canNavigateNext?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  leftCharacter: null,
  rightCharacter: null,
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

// 選択肢がクリックされた
const handleChoiceClick = (choiceId: string): void => {
  emit("choiceSelected", choiceId);
};

// 吹き出し用キャラクター情報
const messageCharacterInfo = computed(() => {
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
</script>

<template>
  <div class="character-dialog">
    <!-- 左キャラクター -->
    <div
      v-if="leftCharacter"
      :key="`left-${leftCharacter.character}`"
      class="character-slot left-slot"
      :class="{ 'is-active': leftCharacter.isActive }"
    >
      <div
        class="avatar"
        :style="{
          backgroundColor: leftCharacter.isActive
            ? leftCharacter.character === 'fubuki'
              ? '#77DFFF'
              : '#FF9CB4'
            : '#CCCCCC',
        }"
      >
        <CharacterSprite
          :character="leftCharacter.character"
          :emotion-id="leftCharacter.emotion"
          :is-active="leftCharacter.isActive"
        />
      </div>
    </div>

    <!-- セリフ部分 -->
    <div class="dialog-content">
      <div
        v-if="message"
        class="dialog-bubble"
        :style="{ borderColor: messageCharacterInfo?.color }"
        @click="() => emit('dialogClicked')"
      >
        <div class="character-name-container">
          <div
            class="character-name"
            :style="{ color: messageCharacterInfo?.color }"
          >
            {{ messageCharacterInfo?.name }}
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
        <Transition
          name="dialog-slide"
          mode="out-in"
        >
          <div
            :key="message.id"
            class="dialog-text-wrapper"
          >
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
        </Transition>
      </div>
    </div>

    <!-- 右キャラクター -->
    <div
      v-if="rightCharacter"
      :key="`right-${rightCharacter.character}`"
      class="character-slot right-slot"
      :class="{ 'is-active': rightCharacter.isActive }"
    >
      <div
        class="avatar"
        :style="{
          backgroundColor: rightCharacter.isActive
            ? rightCharacter.character === 'fubuki'
              ? '#77DFFF'
              : '#FF9CB4'
            : '#CCCCCC',
        }"
      >
        <CharacterSprite
          :character="rightCharacter.character"
          :emotion-id="rightCharacter.emotion"
          :is-active="rightCharacter.isActive"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.character-dialog {
  display: flex;
  gap: var(--size-12);
  align-items: stretch;
  padding-block: var(--size-5);
  height: 100%;
}

.character-slot {
  flex-shrink: 0;
  width: var(--size-100);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  animation: fadeIn var(--duration-character) ease-in;
}

.character-slot.left-slot {
  order: 1;
}

.character-slot.right-slot {
  order: 3;
}

.character-slot .avatar {
  transform: translateY(var(--size-4));
  transition: transform var(--duration-character) ease-in-out;
}

.character-slot.is-active .avatar {
  transform: translateY(0);
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

.dialog-content {
  flex: 1;
  order: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

.avatar {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 var(--size-5) var(--size-5) rgba(0, 0, 0, 0.1);
  border: var(--size-2) solid var(--color-border);
}

.avatar-icon {
  font-size: var(--size-32);
}

.dialog-bubble {
  height: 100%;
  padding: var(--size-8);
  background: white;
  border-radius: var(--size-12);
  border: var(--size-2) solid;
  box-shadow: 0 var(--size-5) var(--size-8) rgba(0, 0, 0, 0.1);
  position: relative;
}

/* トランジション: 下から上へせり上がり */
.dialog-slide-enter-active,
.dialog-slide-leave-active {
  transition: all var(--duration-dialog) ease-out;
}

.dialog-slide-enter-from {
  opacity: 0;
  transform: translateY(var(--size-4));
}

.dialog-slide-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.dialog-slide-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.dialog-slide-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--size-4) * -1));
}

.character-name-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: calc(var(--size-4) * -1);
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

.dialog-text-wrapper {
  font-size: calc(var(--size-20) * var(--text-size-multiplier));
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
