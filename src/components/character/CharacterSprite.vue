<script setup lang="ts">
import { computed } from "vue";
import {
  type CharacterType,
  type EmotionId,
  EMOTION_COORDS,
} from "@/types/character";
import { getCharacterSpriteUrl } from "@/logic/characterSprites";
interface Props {
  character: CharacterType;
  emotionId: EmotionId;
  width?: number;
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  width: 144,
  height: 144,
});

const coords = computed(() => EMOTION_COORDS[props.emotionId]);
const spriteUrl = computed(() =>
  getCharacterSpriteUrl(props.character, coords.value.imageSet),
);

// スプライトシート全体のサイズを計算（原寸: 576x288、セル原寸: 144x144）
const spriteSheetSize = computed(() => {
  const scale = props.width / 144; // 144pxが原寸のセルサイズ
  return {
    width: Math.round(576 * scale),
    height: Math.round(288 * scale),
  };
});

// 座標もスケールに合わせて調整
const scaledPosition = computed(() => {
  const scale = props.width / 144;
  const x = parseInt(coords.value.x, 10) || 0;
  const y = parseInt(coords.value.y, 10) || 0;
  return {
    x: Math.round(x * scale),
    y: Math.round(y * scale),
  };
});
</script>

<template>
  <div
    class="character-sprite"
    :style="{
      width: `${width}px`,
      height: `${height}px`,
      backgroundImage: `url('${spriteUrl}')`,
      backgroundPosition: `${scaledPosition.x}px ${scaledPosition.y}px`,
      backgroundSize: `${spriteSheetSize.width}px ${spriteSheetSize.height}px`,
      backgroundRepeat: 'no-repeat',
    }"
  />
</template>

<style scoped>
.character-sprite {
  display: inline-block;
}
</style>
