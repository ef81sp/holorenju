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
import { useBoardAnnouncer } from "@/composables/useBoardAnnouncer";
import { useKeyboardNavigation } from "@/composables/useKeyboardNavigation";
import { useQuestionRouter } from "./composables/useQuestionRouter";
import { useCutinDisplay } from "@/composables/useCutinDisplay";
import { scenarioNavKey } from "./composables/useScenarioNavProvide";
import { useBoardStore } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useAudioStore } from "@/stores/audioStore";
import { useScenarioAnimationStore } from "@/stores/scenarioAnimationStore";

import type { QuestionSection } from "@/types/scenario";
import type { Position } from "@/types/game";
import type { TextNode } from "@/types/text";
import { getSectionDisplayTitle } from "@/utils/sectionUtils";
import { getPlayerColorFromConditions } from "@/utils/conditionUtils";
import { isInteractiveClick } from "@/utils/isInteractiveClick";

// Props
interface Props {
  scenarioId: string;
}

const props = defineProps<Props>();

// Stores
const boardStore = useBoardStore();
const dialogStore = useDialogStore();
const audioStore = useAudioStore();
const animationStore = useScenarioAnimationStore();

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
const cutinType = ref<"correct" | "wrong" | "practice" | "clear">("correct");

// クリアカットイン表示のためのフラグ
const hasShownClearCutin = ref(false);
const { isCutinVisible, showCutin } = useCutinDisplay(cutinRef);

// ターナリー条件：セクションの完了時コールバック
const onSectionComplete = (): void => {
  scenarioNav.isSectionCompleted.value = true;
};

// カットイン表示用コールバック
const showCorrectCutin = (): void => {
  cutinType.value = "correct";
  showCutin("correct");
  audioStore.playSfx("correct");
};

const showIncorrectCutin = (): void => {
  cutinType.value = "wrong";
  showCutin("wrong");
  audioStore.playSfx("incorrect");
};

const questionRouter = useQuestionRouter(
  props.scenarioId,
  onSectionComplete,
  showCorrectCutin,
  showIncorrectCutin,
);

const isDemoSection = computed(
  () => scenarioNav.currentSection.value?.type === "demo",
);

// カットイン表示中 or アニメーション中はキーボード操作を無効化
const isKeyboardDisabled = computed(
  () =>
    isDemoSection.value ||
    isCutinVisible.value ||
    animationStore.animatingIds.size > 0,
);

let boardAnnouncer: ReturnType<typeof useBoardAnnouncer> | undefined =
  undefined;
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
  () => boardAnnouncer?.announceCursorMove(),
);

// 盤面読み上げ（ARIAライブリージョン）
boardAnnouncer = useBoardAnnouncer({
  board: computed(() => boardStore.board),
  cursorPosition: keyboardNav.cursorPosition,
  isCursorActivated: keyboardNav.isCursorActivated,
});

// セクション変更時にカーソルアクティベーションをリセット＆デモ→問題遷移時はカットインを表示
watch(
  () => scenarioNav.currentSectionIndex.value,
  async (newIndex, oldIndex) => {
    keyboardNav.resetCursorActivation();

    // セクション遷移がない場合はスキップ
    if (oldIndex === undefined || oldIndex === newIndex) {
      return;
    }

    const sections = scenarioNav.scenario.value?.sections;
    if (!sections) {
      return;
    }

    const prevSection = sections[oldIndex];
    const newSection = sections[newIndex];

    // 問題セクションに入ったらボードにフォーカス（WASD操作を有効化）
    if (newSection?.type === "question") {
      await nextTick();
      layoutRef.value?.boardFrameRef?.focus({
        focusVisible: false,
      } as FocusOptions);
    }

    // デモ→問題への遷移時のみカットインを表示
    if (prevSection?.type === "demo" && newSection?.type === "question") {
      cutinType.value = "practice";
      await nextTick();
      showCutin("practice");
    }
  },
);

// デモのみシナリオの完了を検知してクリアカットインを表示
watch(
  () => scenarioNav.isScenarioDone.value,
  (isDone) => {
    if (!isDone || hasShownClearCutin.value) {
      return;
    }

    // デモのみシナリオ（最後のセクションがデモ）の場合
    const lastSection = scenarioNav.currentSection.value;
    if (lastSection?.type === "demo") {
      setTimeout(() => {
        if (!hasShownClearCutin.value) {
          hasShownClearCutin.value = true;
          cutinType.value = "clear";
          showCutin("clear");
          audioStore.playSfx("clear");
        }
      }, 1000);
    }
  },
);

// 正解カットインが消えた後のクリアカットイン表示
watch(
  () => isCutinVisible.value,
  (isVisible, wasVisible) => {
    // カットインが消えた瞬間を検知
    if (wasVisible && !isVisible) {
      // 最後の問題セクションで正解カットインだった場合
      if (
        scenarioNav.isScenarioDone.value &&
        scenarioNav.currentSection.value?.type === "question" &&
        cutinType.value === "correct" &&
        !hasShownClearCutin.value
      ) {
        setTimeout(() => {
          if (!hasShownClearCutin.value) {
            hasShownClearCutin.value = true;
            cutinType.value = "clear";
            showCutin("clear");
            audioStore.playSfx("clear");
          }
        }, 1000);
      }
    }
  },
);

// ボード無効化条件（デモセクション / セクション完了 / アニメーション中 / VCT未サポート）
const isBoardDisabled = computed(() => {
  const section = scenarioNav.currentSection.value;
  if (section?.type === "demo") {
    return true;
  }
  if (scenarioNav.isSectionCompleted.value) {
    return true;
  }
  if (animationStore.animatingIds.size > 0) {
    return true;
  }
  if (
    section?.type === "question" &&
    questionRouter.isVctUnsupported(section as QuestionSection)
  ) {
    return true;
  }
  return false;
});

// カーソル表示条件（問題セクションでWASDキーを押した場合のみ表示）
const cursorPositionForBoard = computed(() => {
  if (isBoardDisabled.value) {
    return undefined;
  }
  // カーソルが有効化されていない場合は非表示
  if (!keyboardNav.isCursorActivated.value) {
    return undefined;
  }
  return keyboardNav.cursorPosition.value;
});

// ボードにフォーカスがなくても矢印キーで会話送りできるようにする
const handleGlobalArrowKeys = (event: KeyboardEvent): void => {
  // dialog 内やフォーム要素にフォーカスがある場合は無視
  const target = event.target as HTMLElement;
  if (
    target.closest("dialog") ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA"
  ) {
    return;
  }

  if (!scenarioNav.currentSection.value) {
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    scenarioNav.nextDialogue();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    scenarioNav.previousDialogue();
  }
};

// Lifecycle
onMounted(async () => {
  await scenarioNav.loadScenario();

  await nextTick();
  const boardElement = layoutRef.value?.boardFrameRef;
  if (boardElement) {
    keyboardNav.attachKeyListener(boardElement);
    // フォーカスリングを表示せずにフォーカス（WASD操作を有効化）
    boardElement.focus({ focusVisible: false } as FocusOptions);
  }
  window.addEventListener("keydown", handleGlobalArrowKeys);
});

onUnmounted(() => {
  keyboardNav.detachKeyListener();
  window.removeEventListener("keydown", handleGlobalArrowKeys);
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

  questionRouter.handlePlaceStone(
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

  questionRouter.submitAnswer(
    scenarioNav.currentSection.value as QuestionSection,
    scenarioNav.isSectionCompleted.value,
  );
};

const handleNextDialogue = (): void => {
  scenarioNav.nextDialogue();
};

const handleResetPuzzle = (): void => {
  const section = scenarioNav.currentSection.value;
  if (section?.type === "question") {
    questionRouter.resetPuzzle(section as QuestionSection);
  }
};

const handleGoToList = (): void => {
  scenarioNav.completeScenario();
};

const handleLayoutClick = (event: MouseEvent): void => {
  if (isInteractiveClick(event)) {
    return;
  }
  const target = event.target as HTMLElement;
  if (target.closest(".dialog-bubble")) {
    return;
  }
  if (isCutinVisible.value || animationStore.animatingIds.size > 0) {
    return;
  }
  scenarioNav.nextDialogue();
};
</script>

<template>
  <!-- Transition mode="out-in" に対応するため単一ルート要素で囲む -->
  <div
    class="scenario-player-root"
    @click="handleLayoutClick"
  >
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
          :cursor-position="cursorPositionForBoard"
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
          :show-reset-button="
            questionRouter.isResetAvailable.value &&
            !scenarioNav.isSectionCompleted.value
          "
          @next-section="scenarioNav.nextSection"
          @submit-answer="handleSubmitAnswer"
          @reset-puzzle="handleResetPuzzle"
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

    <!-- 盤面読み上げ用ARIAライブリージョン -->
    <div
      aria-live="polite"
      class="visually-hidden"
    >
      {{ boardAnnouncer?.politeMessage.value }}
    </div>
  </div>
</template>

<style scoped>
.scenario-player-root {
  width: 100%;
  height: 100%;
}
</style>
