<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

import BackButton from "./BackButton.vue";
import ControlInfo from "./ControlInfo.vue";
import ScenarioInfoPanel from "./ScenarioInfoPanel.vue";
import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import DialogSection from "./DialogSection.vue";
import CutinOverlay from "@/components/common/CutinOverlay.vue";
import SettingsControl from "@/components/common/SettingsControl.vue";
import { useScenarioNavigation } from "./composables/useScenarioNavigation";
import { useKeyboardNavigation } from "./composables/useKeyboardNavigation";
import { useBoardSize } from "./composables/useBoardSize";
import { useQuestionSolver } from "./composables/useQuestionSolver";
import { useCutinDisplay } from "./composables/useCutinDisplay";
import { useDialogStore } from "@/stores/dialogStore";

import type { QuestionSection, SuccessCondition } from "@/types/scenario";
import type { Position } from "@/types/game";
import type { TextNode } from "@/types/text";

// Props
interface Props {
  scenarioId: string;
}

const props = defineProps<Props>();

// Stores
const dialogStore = useDialogStore();

// Composables
const scenarioNav = useScenarioNavigation(props.scenarioId);
const boardFrameRef = ref<HTMLElement | null>(null);
const { boardSize: boardSizeValue } = useBoardSize(boardFrameRef);
const boardSize = computed(() => boardSizeValue.value);

// カットイン
const cutinRef = ref<InstanceType<typeof CutinOverlay> | null>(null);
const cutinType = ref<"correct" | "wrong">("correct");
const { isCutinVisible, showCutin } = useCutinDisplay(cutinRef);

// ターナリー条件：セクションの完了時コールバック
const onSectionComplete = (): void => {
  scenarioNav.isSectionCompleted.value = true;
};

// カットイン表示用コールバック
const showCorrectCutin = (): void => {
  cutinType.value = "correct";
  showCutin("correct");
};

const showIncorrectCutin = (): void => {
  cutinType.value = "wrong";
  showCutin("wrong");
};

const questionSolver = useQuestionSolver(
  props.scenarioId,
  onSectionComplete,
  showCorrectCutin,
  showIncorrectCutin,
);

const isDemoSection = computed(
  () => scenarioNav.currentSection.value?.type === "demo",
);

// カットイン表示中はキーボード操作を無効化
const isKeyboardDisabled = computed(
  () => isDemoSection.value || isCutinVisible.value,
);

const keyboardNav = useKeyboardNavigation(
  () => handlePlaceStone(),
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
  isKeyboardDisabled,
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

const handlePlaceStone = (position?: Position): void => {
  if (
    !scenarioNav.currentSection.value ||
    scenarioNav.currentSection.value.type !== "question"
  ) {
    return;
  }

  // Position が指定されていればそれを使用、なければカーソル位置
  const targetPosition = position || keyboardNav.cursorPosition.value;

  questionSolver.handlePlaceStone(
    targetPosition,
    scenarioNav.currentSection.value as QuestionSection,
    scenarioNav.isSectionCompleted.value,
  );
};

const requiresAnswerButton = computed(() => {
  if (
    !scenarioNav.currentSection.value ||
    scenarioNav.currentSection.value.type !== "question"
  ) {
    return false;
  }
  const operator = scenarioNav.currentSection.value.successOperator ?? "or";
  return operator === "and" && !scenarioNav.isSectionCompleted.value;
});

const descriptionNodes = computed<TextNode[]>(() => {
  const section = scenarioNav.currentSection.value;
  if (!section || section.type !== "question") {
    return [];
  }
  return section.description || [];
});

/**
 * successConditionsからプレイヤーの石色を推論する
 */
const getPlayerColorFromConditions = (
  conditions: SuccessCondition[],
): "black" | "white" => {
  for (const condition of conditions) {
    if (condition.type === "position" || condition.type === "pattern") {
      return condition.color;
    }
    if (condition.type === "sequence" && condition.moves.length > 0) {
      const [firstMove] = condition.moves;
      if (firstMove) {
        return firstMove.color;
      }
    }
  }
  return "black";
};

const playerColor = computed(() => {
  const section = scenarioNav.currentSection.value;
  if (section?.type === "question") {
    return getPlayerColorFromConditions(
      (section as QuestionSection).successConditions,
    );
  }
  return "black";
});

const handleSubmitAnswer = (): void => {
  if (
    !scenarioNav.currentSection.value ||
    scenarioNav.currentSection.value.type !== "question"
  ) {
    return;
  }

  questionSolver.submitAnswer(
    scenarioNav.currentSection.value as QuestionSection,
    scenarioNav.isSectionCompleted.value,
  );
};

const handleNextDialogue = (): void => {
  scenarioNav.nextDialogue();
};

const handleGoToList = (): void => {
  scenarioNav.completeScenario();
};
</script>

<template>
  <div
    v-if="scenarioNav.scenario.value"
    class="scenario-player"
  >
    <!-- 操作セクション（左上 4×7）-->
    <div class="control-section-slot">
      <div class="control-header">
        <BackButton @back="scenarioNav.goBack" />
        <SettingsControl />
      </div>
      <ControlInfo
        :cursor-position="keyboardNav.cursorPosition.value"
        :section-type="scenarioNav.currentSection.value?.type"
      />
    </div>

    <!-- 連珠盤セクション（中央 7×7）-->
    <div
      id="board-anchor"
      ref="boardFrameRef"
      class="board-section-wrapper"
      style="anchor-name: --board-area"
    >
      <RenjuBoard
        :disabled="
          scenarioNav.currentSection.value?.type === 'demo' ||
          scenarioNav.isSectionCompleted.value
        "
        :stage-size="boardSize"
        :cursor-position="keyboardNav.cursorPosition.value"
        :player-color="playerColor"
        @place-stone="handlePlaceStone"
      />
      <CutinOverlay
        ref="cutinRef"
        :type="cutinType"
        :anchor="'board-anchor'"
      />
    </div>

    <!-- 説明・コントロール部（右側 5×9）-->
    <div class="info-section-slot">
      <ScenarioInfoPanel
        :scenario-title="scenarioNav.scenario.value.title"
        :section-title="scenarioNav.currentSection.value?.title || ''"
        :description="
          scenarioNav.currentSection.value?.type === 'demo'
            ? scenarioNav.demoDescriptionNodes.value
            : descriptionNodes
        "
        :section-index="scenarioNav.currentSectionIndex.value"
        :total-sections="scenarioNav.scenario.value.sections.length"
        :show-next-section-button="scenarioNav.showNextSectionButton.value"
        :show-complete-button="scenarioNav.isScenarioDone.value"
        :show-answer-button="requiresAnswerButton"
        :answer-disabled="scenarioNav.isSectionCompleted.value"
        @next-section="scenarioNav.nextSection"
        @submit-answer="handleSubmitAnswer"
        @complete-scenario="handleGoToList"
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

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.board-section-wrapper {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.info-section-slot {
  grid-column: 3;
  grid-row: 1 / 3;
  overflow-y: auto;
}

.dialog-section-slot {
  grid-column: 1 / 3;
  grid-row: 2;
  overflow-y: auto;
}
</style>
