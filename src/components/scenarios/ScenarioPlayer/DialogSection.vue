<script setup lang="ts">
import { computed } from "vue";
import CharacterDialog from "@/components/character/CharacterDialog.vue";
import type {
  DialogMessage,
  CharacterType,
  EmotionId,
} from "@/types/character";

interface Props {
  message: DialogMessage | null;
  isDemo: boolean;
  dialogIndex: number;
  totalDialogues: number;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
}

const props = defineProps<Props>();

const emits = defineEmits<{
  dialogClicked: [];
  nextDialogue: [];
  previousDialogue: [];
}>();

// 左右キャラクター情報を生成
const leftCharacter = computed(() => ({
  character: "fubuki" as const,
  emotion:
    props.message?.character === "fubuki"
      ? props.message.emotion
      : (0 as const),
  isActive: props.message?.character === "fubuki",
}));

const rightCharacter = computed(() => ({
  character: "miko" as const,
  emotion:
    props.message?.character === "miko" ? props.message.emotion : (0 as const),
  isActive: props.message?.character === "miko",
}));
</script>

<template>
  <div class="character-dialog-section">
    <CharacterDialog
      :message="message"
      :left-character="leftCharacter"
      :right-character="rightCharacter"
      :can-navigate-previous="canNavigatePrevious"
      :can-navigate-next="canNavigateNext"
      @dialog-clicked="isDemo ? emits('dialogClicked') : undefined"
      @dialog-next="emits('nextDialogue')"
      @dialog-previous="emits('previousDialogue')"
    />
  </div>
</template>

<style scoped>
.character-dialog-section {
  background: transparent;
  overflow-y: auto;
  overflow-x: hidden;
  width: 100%;
  height: 100%;
}
</style>
