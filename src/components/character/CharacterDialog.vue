<script setup lang="ts">
import { computed } from "vue";

import type { DialogMessage } from "@/types/character";

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
      avatarBg: "#E3F2FD",
      color: "#4A9EFF",
      name: "フブキ先生",
    },
    miko: {
      avatarBg: "#FFE4F0",
      color: "#FF69B4",
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
    <div class="dialog-container">
      <!-- アバター -->
      <div
        class="avatar"
        :style="{ backgroundColor: characterInfo?.avatarBg }"
      >
        <div class="avatar-icon">
          {{ message.character === "fubuki" ? "🦊" : "🌸" }}
        </div>
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
  </div>
</template>

<style scoped>
.character-dialog {
  margin: 16px 0;
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dialog-container {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.position-right .dialog-container {
  flex-direction: row-reverse;
}

.avatar {
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.avatar-icon {
  font-size: 32px;
}

.dialog-bubble {
  flex: 1;
  max-width: 500px;
  padding: 16px;
  background: white;
  border-radius: 12px;
  border: 2px solid;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  position: relative;
}

.position-left .dialog-bubble::before {
  content: "";
  position: absolute;
  left: -10px;
  top: 20px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 10px 10px 10px 0;
  border-color: transparent currentColor transparent transparent;
}

.position-right .dialog-bubble::before {
  content: "";
  position: absolute;
  right: -10px;
  top: 20px;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 10px 0 10px 10px;
  border-color: transparent transparent transparent currentColor;
}

.character-name {
  font-weight: bold;
  font-size: 14px;
  margin-bottom: 8px;
}

.dialog-text {
  color: #333;
  line-height: 1.6;
  font-size: 16px;
  white-space: pre-wrap;
}

.choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.choice-button {
  padding: 10px 16px;
  background: #f5f5f5;
  border: 2px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
  text-align: left;
}

.choice-button:hover {
  background: #e8e8e8;
  border-color: #4a9eff;
  transform: translateX(4px);
}

.choice-button:active {
  transform: translateX(4px) scale(0.98);
}

@media (max-width: 768px) {
  .dialog-bubble {
    max-width: 100%;
  }

  .avatar {
    width: 48px;
    height: 48px;
  }

  .avatar-icon {
    font-size: 28px;
  }

  .dialog-text {
    font-size: 14px;
  }
}
</style>
