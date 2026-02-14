<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useLightDismiss } from "@/composables/useLightDismiss";
import { useGameBrowser } from "@/editor/composables/useGameBrowser";
import { boardStateToStringArray } from "@/editor/logic/boardCalculator";
import GameListPanel from "./GameListPanel.vue";
import GamePlaybackPanel from "./GamePlaybackPanel.vue";

const emit = defineEmits<{
  import: [data: { board: string[]; record: string; moveNumber: number }];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
useLightDismiss(dialogRef);

const browser = useGameBrowser();

const showModal = (): void => {
  dialogRef.value?.showModal();
  if (!browser.analysisResult.value) {
    browser.loadLatestAnalysis();
  }
};

const close = (): void => {
  dialogRef.value?.close();
};

const handleImport = (): void => {
  const game = browser.selectedGame.value;
  if (!game) {
    return;
  }

  const board = boardStateToStringArray(browser.currentBoard.value);
  const moves = game.moves.slice(0, browser.moveIndex.value);
  const record = moves.map((m: { notation: string }) => m.notation).join(" ");

  emit("import", {
    board,
    record,
    moveNumber: browser.moveIndex.value,
  });
  close();
};

// キーボードショートカット
const handleKeydown = (e: KeyboardEvent): void => {
  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      browser.goToPrev();
      break;
    case "ArrowRight":
      e.preventDefault();
      browser.goToNext();
      break;
    case "Home":
      e.preventDefault();
      browser.goToFirst();
      break;
    case "End":
      e.preventDefault();
      browser.goToLast();
      break;
  }
};

onMounted(() => {
  dialogRef.value?.addEventListener("keydown", handleKeydown);
});

defineExpose({ showModal, close });
</script>

<template>
  <dialog
    ref="dialogRef"
    class="game-browser-dialog"
    closedby="any"
  >
    <div class="dialog-header">
      <h2>棋譜ブラウザ</h2>
      <button
        class="close-button"
        @click="close"
      >
        ✕
      </button>
    </div>

    <div
      v-if="browser.isLoading.value"
      class="loading"
    >
      読み込み中...
    </div>
    <div
      v-else-if="browser.loadError.value"
      class="error"
    >
      {{ browser.loadError.value }}
    </div>
    <div
      v-else
      class="dialog-content"
    >
      <GameListPanel
        :games="browser.filteredGames.value"
        :selected-index="browser.selectedGameIndex.value"
        :filter="browser.filter.value"
        :available-matchups="browser.availableMatchups.value"
        :available-jushu="browser.availableJushu.value"
        :available-tags="browser.availableTags.value"
        @select="browser.selectGame"
        @update:filter="(f) => (browser.filter.value = f)"
      />

      <div
        v-if="browser.selectedGame.value"
        class="playback-area"
      >
        <GamePlaybackPanel
          :game="browser.selectedGame.value"
          :board-state="browser.currentBoard.value"
          :move-index="browser.moveIndex.value"
          :total-moves="browser.totalMoves.value"
          :current-move-analysis="browser.currentMoveAnalysis.value"
          :stone-labels="browser.stoneLabels.value"
          @first="browser.goToFirst"
          @prev="browser.goToPrev"
          @next="browser.goToNext"
          @last="browser.goToLast"
          @go-to-move="browser.goToMove"
          @import="handleImport"
        />
      </div>
      <div
        v-else
        class="no-selection"
      >
        左のリストからゲームを選択してください
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.game-browser-dialog {
  width: 90vw;
  max-width: 1000px;
  height: 80vh;
  max-height: 700px;
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.game-browser-dialog::backdrop {
  background: rgba(0, 0, 0, 0.4);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f5f5;
  border-bottom: 1px solid #ddd;
  flex-shrink: 0;
}

.dialog-header h2 {
  margin: 0;
  font-size: 16px;
}

.close-button {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  color: #666;
}

.close-button:hover {
  color: #333;
}

.loading,
.error {
  padding: 32px;
  text-align: center;
  color: #666;
}

.error {
  color: #c00;
}

.dialog-content {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 12px;
  padding: 12px;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.playback-area {
  overflow-y: auto;
}

.no-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 14px;
}
</style>
