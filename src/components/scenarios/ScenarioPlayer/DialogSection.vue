<script setup lang="ts">
import CharacterDialog from "@/components/character/CharacterDialog.vue";
import type { DialogMessage } from "@/types/character";

interface Props {
  message: DialogMessage | null;
  isDemo: boolean;
  dialogIndex: number;
  totalDialogues: number;
  canNavigatePrevious: boolean;
  canNavigateNext: boolean;
}

defineProps<Props>();

const emits = defineEmits<{
  dialogClicked: [];
  nextDialogue: [];
  previousDialogue: [];
}>();
</script>

<template>
  <div class="character-dialog-section">
    <CharacterDialog
      :message="message"
      :position="message?.character === 'fubuki' ? 'left' : 'right'"
      @dialog-clicked="isDemo ? emits('dialogClicked') : undefined"
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
