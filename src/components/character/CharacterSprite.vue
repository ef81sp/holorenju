<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  type CharacterType,
  type EmotionId,
  EMOTION_COORDS,
  getEmotionAltText,
} from "@/types/character";
import { getCharacterSpriteUrl } from "@/logic/characterSprites";

interface Props {
  character: CharacterType;
  emotionId: EmotionId;
  isActive?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isActive: true,
});

const coords = computed(() => EMOTION_COORDS[props.emotionId]);
const altText = computed(() =>
  getEmotionAltText(props.character, props.emotionId),
);
const spriteUrl = computed(() =>
  getCharacterSpriteUrl(props.character, coords.value.imageSet),
);

// セルサイズ（原寸）
const cellSize = 144;

// 切り出された画像のdata URL
const croppedImageUrl = ref<string>("");

// スプライトシートから切り出し
const cropSprite = (): void => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = spriteUrl.value;

  img.onload = () => {
    const xStr = coords.value.x;
    const yStr = coords.value.y;
    const x = Math.abs(parseInt(xStr, 10) || 0);
    const y = Math.abs(parseInt(yStr, 10) || 0);

    const canvas = document.createElement("canvas");
    canvas.width = cellSize;
    canvas.height = cellSize;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      ctx.drawImage(img, x, y, cellSize, cellSize, 0, 0, cellSize, cellSize);
      croppedImageUrl.value = canvas.toDataURL();
    }
  };
};

// スプライトが変更されたら再切り出し
watch([spriteUrl, coords], cropSprite, { immediate: true });
</script>

<template>
  <img
    v-if="croppedImageUrl"
    :src="croppedImageUrl"
    class="character-sprite"
    :class="{ inactive: !isActive }"
    :alt="altText"
  />
</template>

<style scoped>
.character-sprite {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition:
    filter var(--duration-sprite) ease,
    opacity var(--duration-sprite) ease;
}

.character-sprite.inactive {
  filter: grayscale(100%);
  opacity: 0.5;
}
</style>
