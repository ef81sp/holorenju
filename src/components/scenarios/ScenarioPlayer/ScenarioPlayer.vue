<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

import BackButton from "./BackButton.vue";
import KeyboardControlInfo from "./KeyboardControlInfo.vue";
import ScenarioInfoPanel from "./ScenarioInfoPanel.vue";
import RenjuBoard from "@/components/game/RenjuBoard.vue";
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

const keyboardNav = useKeyboardNavigation(
  (position) => {
    if (
      !scenarioNav.currentSection.value ||
      scenarioNav.currentSection.value.type !== "problem"
    ) {
      return;
    }

    problemSolver.handlePlaceStone(
      position,
      scenarioNav.currentSection.value as ProblemSection,
      scenarioNav.isSectionCompleted.value,
    );
  },
  (direction) => {
    if (!scenarioNav.currentSection.value) {
      return;
    }

    if (direction === "next") {
      scenarioNav.nextDialogue();
    } else {
      scenarioNav.previousDialogue();
    }
  },
);

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

const handleNextDialogue = (): void => {
  scenarioNav.nextDialogue();
};
</script>

<template>
  <div
    v-if="scenarioNav.scenario.value"
    class="scenario-player"
  >
    <!-- 操作セクション（左上 4×7）-->
    <div class="control-section-slot">
      <BackButton @back="scenarioNav.goBack" />
      <KeyboardControlInfo
        :cursor-position="keyboardNav.cursorPosition.value"
        :section-type="scenarioNav.currentSection.value?.type"
      />
    </div>

    <!-- 連珠盤セクション（中央 7×7）-->
    <div
      ref="boardFrameRef"
      class="board-section-wrapper"
    >
      <RenjuBoard
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
        :scenario-title="scenarioNav.scenario.value.title"
        :section-title="scenarioNav.currentSection.value?.id || ''"
        :description="
          (scenarioNav.currentSection.value?.type === 'problem'
            ? scenarioNav.currentSection.value?.description
            : '') || ''
        "
        :section-index="scenarioNav.currentSectionIndex.value"
        :total-sections="scenarioNav.scenario.value.sections.length"
        :can-proceed="scenarioNav.canProceed.value"
        :is-last-section="scenarioNav.isLastSection.value"
        @next-section="scenarioNav.nextSection"
      />
    </div>

    <!-- セリフ部（左下 11×2）-->
    <!-- セリフ部（左下 11×2）-->
    <div class="dialog-section-slot">
      <DialogSection
        :message="dialogStore.currentMessage"
        :is-demo="scenarioNav.currentSection.value?.type === 'demo'"
        :dialog-index="scenarioNav.currentDialogueIndex.value"
        :total-dialogues="scenarioNav.allDialogues.value.length"
        :can-navigate-previous="scenarioNav.canNavigatePrevious.value"
        :can-navigate-next="scenarioNav.canNavigateNext.value"
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
  grid-template-columns: 4fr 7fr 5fr;
  grid-template-rows: 7fr 2fr;
  padding: var(--size-14);
  gap: var(--size-14);
  box-sizing: border-box;
  position: relative;
}

.control-section-slot {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--size-12);
  overflow: hidden;
}

.board-section-wrapper {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
}

.info-section-slot {
  grid-column: 3;
  grid-row: 1 / 3;
  overflow-y: auto;
  padding-inline: var(--size-14);
}

.dialog-section-slot {
  grid-column: 1 / 3;
  grid-row: 2;
  overflow-y: auto;
}
</style>
