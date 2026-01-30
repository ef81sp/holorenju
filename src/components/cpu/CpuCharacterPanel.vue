<script setup lang="ts">
/**
 * CPU対戦用キャラクター表示パネル
 *
 * キャラクターの立ち絵と名前を表示
 */

import { computed } from "vue";

import CharacterSprite from "@/components/character/CharacterSprite.vue";
import type { CharacterType, EmotionId } from "@/types/character";

interface Props {
  character: CharacterType;
  emotionId: EmotionId;
}

const props = defineProps<Props>();

const characterInfo = computed(() => {
  const infoMap: Record<
    Exclude<CharacterType, "narration">,
    { name: string; bgColor: string; borderColor: string }
  > = {
    fubuki: {
      name: "フブキ",
      bgColor: "var(--color-fubuki-bg)",
      borderColor: "var(--color-fubuki-primary)",
    },
    miko: {
      name: "みこ",
      bgColor: "var(--color-miko-bg)",
      borderColor: "var(--color-miko-primary)",
    },
  };

  if (props.character === "narration") {
    return null;
  }

  return infoMap[props.character];
});
</script>

<template>
  <div
    v-if="characterInfo"
    class="cpu-character-panel"
  >
    <div
      class="avatar-wrapper"
      :style="{
        backgroundColor: characterInfo.bgColor,
        borderColor: characterInfo.borderColor,
      }"
    >
      <CharacterSprite
        :character="character"
        :emotion-id="emotionId"
        :is-active="true"
      />
    </div>
    <div
      class="character-name"
      :style="{ color: characterInfo.borderColor }"
    >
      {{ characterInfo.name }}
    </div>
  </div>
</template>

<style scoped>
.cpu-character-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-8);
}

.avatar-wrapper {
  width: var(--size-100);
  aspect-ratio: 1;
  border-radius: var(--size-8);
  border: var(--size-2) solid var(--color-border);
  box-shadow: 0 var(--size-5) var(--size-5) rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.character-name {
  font-size: var(--size-16);
  font-weight: 500;
  text-align: center;
}
</style>
