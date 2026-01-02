<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

import ScenarioHeader from "./ScenarioHeader.vue";
import ScenarioInfoPanel from "./ScenarioInfoPanel.vue";
import BoardSection from "./BoardSection.vue";
import DialogSection from "./DialogSection.vue";
import { useScenarioNavigation } from "./composables/useScenarioNavigation";
import { useKeyboardNavigation } from "./composables/useKeyboardNavigation";
import { useBoardSize } from "./composables/useBoardSize";
import { useProblemSolver } from "./composables/useProblemSolver";
import { useGameStore } from "@/stores/gameStore";
import { useDialogStore } from "@/stores/dialogStore";

import type { ProblemSection } from "@/types/scenario";

// Props
interface Props {
  scenarioId: string;
}

const props = defineProps<Props>();

// Stores
const gameStore = useGameStore();
const dialogStore = useDialogStore();

// Composables
const scenarioNav = useScenarioNavigation(props.scenarioId);
const boardFrameRef = ref<HTMLElement | null>(null);
const { boardSize: boardSizeValue } = useBoardSize(boardFrameRef);
const boardSize = computed(() => boardSizeValue.value);

// ターナリー条件：セクションの完了時コールバック
const onSectionComplete = (): void => {
  scenarioNav.isSectionCompleted.value = true;
};

const problemSolver = useProblemSolver(props.scenarioId, onSectionComplete);

const keyboardNav = useKeyboardNavigation((position) => {
  if (!scenarioNav.currentSection.value || scenarioNav.currentSection.value.type !== "problem") {
    return;
  }

  problemSolver.handlePlaceStone(
    position,
    scenarioNav.currentSection.value as ProblemSection,
    scenarioNav.isSectionCompleted.value,
  );
});

// State
const showHint = ref(false);

// Lifecycle
onMounted(async () => {
  await scenarioNav.loadScenario();
  keyboardNav.attachKeyListener();

  await nextTick();
  console.warn("[ScenarioPlayer] Initial size:", {
    width: boardFrameRef.value?.clientWidth,
    height: boardFrameRef.value?.clientHeight,
  });
});

onUnmounted(() => {
  keyboardNav.detachKeyListener();
});

const handlePlaceStone = (): void => {
  keyboardNav.placeStoneAtCursor();
};

const handleToggleHint = (): void => {
  showHint.value = !showHint.value;
};

const handleNextDialogue = (): void => {
  scenarioNav.nextDialogue();
};
</script>

<template>
  <div
    v-if="scenarioNav.scenario.value"
    class="scenario-player"
  >
    <!-- ヘッダー -->
    <div class="header-slot">
      <ScenarioHeader
        :scenario-title="scenarioNav.scenario.value.title"
        :current-section-title="scenarioNav.currentSection.value?.title || ''"
        :section-index="scenarioNav.currentSectionIndex.value"
        :total-sections="scenarioNav.scenario.value.sections.length"
        @back="scenarioNav.goBack"
      />
    </div>

    <!-- 盤面フレーム（左上 11×6）-->
    <div
      ref="boardFrameRef"
      class="board-section-wrapper"
    >
      <BoardSection
        :board-state="gameStore.board"
        :disabled="scenarioNav.isSectionCompleted.value"
        :stage-size="boardSize"
        :cursor-position="keyboardNav.cursorPosition.value"
        @place-stone="handlePlaceStone"
      />
    </div>

    <!-- 説明・コントロール部（右側 5×9）-->
    <div class="info-section-slot">
      <ScenarioInfoPanel
        :title="scenarioNav.currentSection.value?.id || ''"
        :description="(scenarioNav.currentSection.value?.type === 'problem' ? scenarioNav.currentSection.value?.description : '') || ''"
        :section-index="scenarioNav.currentSectionIndex.value"
        :total-sections="scenarioNav.scenario.value.sections.length"
        :can-proceed="scenarioNav.canProceed.value"
        :is-last-section="scenarioNav.isLastSection.value"
        :show-hint="showHint"
        @toggle-hint="handleToggleHint"
        @next-section="scenarioNav.nextSection"
      />
    </div>

    <!-- セリフ部（左下 11×2）-->
    <div class="dialog-section-slot">
      <DialogSection
        :message="dialogStore.currentMessage"
        :is-demo="scenarioNav.currentSection.value?.type === 'demo'"
        :dialog-index="scenarioNav.currentDialogueIndex.value"
        :total-dialogues="(scenarioNav.currentSection.value?.type === 'demo' ? scenarioNav.currentSection.value.dialogues.length : 0)"
        :can-navigate-previous="scenarioNav.currentDialogueIndex.value > 0"
        :can-navigate-next="scenarioNav.currentDialogueIndex.value < ((scenarioNav.currentSection.value?.type === 'demo' ? scenarioNav.currentSection.value.dialogues.length : 0) - 1)"
        @dialog-clicked="handleNextDialogue"
        @next-dialogue="scenarioNav.nextDialogue"
        @previous-dialogue="scenarioNav.previousDialogue"
      />
    </div>
  </div>
</template>

<style scoped>
.scenario-player {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: 11fr 5fr;
  grid-template-rows: 1fr 6fr 2fr;
  padding: var(--size-14);
  gap: var(--size-10);
  box-sizing: border-box;
}

.header-slot {
  grid-column: 1;
  grid-row: 1;
}

.board-section-wrapper {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--size-12);
  overflow: hidden;
  min-height: 0;
}

.info-section-slot {
  grid-column: 2;
  grid-row: 1 / 4;
  overflow-y: auto;
}

.dialog-section-slot {
  grid-column: 1;
  grid-row: 3;
  overflow-y: auto;
}
</style>
