<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  watch,
} from "vue";

import BackButton from "./BackButton.vue";
import ControlInfo from "./ControlInfo.vue";
import ScenarioInfoPanel from "./ScenarioInfoPanel.vue";
import RenjuBoard from "@/components/game/RenjuBoard/RenjuBoard.vue";
import DialogSection from "./DialogSection.vue";
import CutinOverlay from "@/components/common/CutinOverlay.vue";
import SettingsControl from "@/components/common/SettingsControl.vue";
import GamePlayerLayout from "@/components/common/GamePlayerLayout.vue";
import DebugReloadButton from "./DebugReloadButton.vue";
import { useScenarioNavigation } from "./composables/useScenarioNavigation";
import { useKeyboardNavigation } from "./composables/useKeyboardNavigation";
import { useQuestionSolver } from "./composables/useQuestionSolver";
import { useCutinDisplay } from "@/composables/useCutinDisplay";
import { scenarioNavKey } from "./composables/useScenarioNavProvide";
import { useDialogStore } from "@/stores/dialogStore";

import type { QuestionSection } from "@/types/scenario";
import type { Position } from "@/types/game";
import type { TextNode } from "@/types/text";
import { getSectionDisplayTitle } from "@/utils/sectionUtils";
import { getPlayerColorFromConditions } from "@/utils/conditionUtils";

// Props
interface Props {
  scenarioId: string;
}

const props = defineProps<Props>();

// Stores
const dialogStore = useDialogStore();

// Composables
const scenarioNav = useScenarioNavigation(props.scenarioId);

// DebugReloadButton 用に loadScenario を provide
provide(scenarioNavKey, {
  loadScenario: scenarioNav.loadScenario,
});

// レイアウトコンポーネントの参照
const layoutRef = ref<InstanceType<typeof GamePlayerLayout> | null>(null);

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

// セクション変更時にカーソルアクティベーションをリセット
watch(
  () => scenarioNav.currentSectionIndex.value,
  () => {
    keyboardNav.resetCursorActivation();
  },
);

// カーソル非表示条件
const isBoardDisabled = computed(() => {
  // デモセクションまたはセクション完了時は無効化（現行動作）
  if (
    scenarioNav.currentSection.value?.type === "demo" ||
    scenarioNav.isSectionCompleted.value
  ) {
    return true;
  }
  // 問題セクションでWASDキーを押していない場合はカーソル非表示
  return !keyboardNav.isCursorActivated.value;
});

// Lifecycle
onMounted(async () => {
  await scenarioNav.loadScenario();
  keyboardNav.attachKeyListener();

  await nextTick();
  console.warn("[ScenarioPlayer] Initial size:", {
    width: layoutRef.value?.boardFrameRef?.clientWidth,
    height: layoutRef.value?.boardFrameRef?.clientHeight,
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

  // マウスクリックの場合（positionが渡される）はカーソルを非表示に
  if (position) {
    keyboardNav.resetCursorActivation();
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
  <GamePlayerLayout
    v-if="scenarioNav.scenario.value"
    ref="layoutRef"
  >
    <template #back-button>
      <BackButton @back="scenarioNav.goBack" />
    </template>

    <template #header-controls>
      <DebugReloadButton />
      <SettingsControl />
    </template>

    <template #control-info>
      <ControlInfo
        :cursor-position="keyboardNav.cursorPosition.value"
        :section-type="scenarioNav.currentSection.value?.type"
      />
    </template>

    <template #board="{ boardSize }">
      <RenjuBoard
        :disabled="isBoardDisabled"
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
    </template>

    <template #info>
      <ScenarioInfoPanel
        :scenario-title="scenarioNav.scenario.value.title"
        :section-title="
          getSectionDisplayTitle(
            scenarioNav.scenario.value.sections,
            scenarioNav.currentSectionIndex.value,
          )
        "
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
    </template>

    <template #dialog>
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
    </template>
  </GamePlayerLayout>
</template>
