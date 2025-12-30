<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import CharacterDialog from "@/components/character/CharacterDialog.vue";
import RenjuBoard from "@/components/game/RenjuBoard.vue";
import { parseInitialBoard } from "@/logic/boardParser";
import { useDialogStore } from "@/stores/dialogStore";
import { useGameStore } from "@/stores/gameStore";
import { useProgressStore } from "@/stores/progressStore";

import type { Scenario, ScenarioStep } from "@/types/scenario";
import type { DialogMessage } from "@/types/character";
import type { Position } from "@/types/game";

// Props
interface Props {
  scenarioId: string;
}

const props = defineProps<Props>();

// Emits
const emit = defineEmits<{
  complete: [];
  back: [];
}>();

// Stores
const gameStore = useGameStore();
const dialogStore = useDialogStore();
const progressStore = useProgressStore();

// State
const scenario = ref<Scenario | null>(null);
const currentStepIndex = ref(0);
const isStepCompleted = ref(false);
const showHint = ref(false);

// Computed
const currentStep = computed<ScenarioStep | null>(() => {
  if (!scenario.value) {
    return null;
  }
  return scenario.value.steps[currentStepIndex.value] ?? null;
});

const isLastStep = computed(() => {
  if (!scenario.value) {
    return false;
  }
  return currentStepIndex.value >= scenario.value.steps.length - 1;
});

const canProceed = computed(() => isStepCompleted.value);

// Methods
const loadScenario = async (): Promise<void> => {
  try {
    const scenarioModule = await import(
      `@/data/scenarios/${props.scenarioId}.json`
    );
    const scenarioData = scenarioModule.default as Scenario;

    scenario.value = scenarioData;
    progressStore.startScenario(props.scenarioId);

    // 初期盤面をセット
    if (currentStep.value) {
      const { board, expectedMoves } = parseInitialBoard(
        currentStep.value.initialBoard,
      );
      currentStep.value.expectedMoves = expectedMoves;
      gameStore.setBoard(board);
      showIntroDialog();
    }
  } catch (error) {
    console.error("Failed to load scenario:", props.scenarioId, error);
  }
};

const showIntroDialog = (): void => {
  if (!scenario.value?.dialogs) {
    return;
  }

  const { intro } = scenario.value.dialogs as Record<string, unknown>;

  if (intro && Array.isArray(intro) && intro.length > 0) {
    dialogStore.showMessage(intro[0] as DialogMessage);
  }
};

const handlePlaceStone = (position: Position): void => {
  if (isStepCompleted.value) {
    return;
  }

  const result = gameStore.placeStone(position);

  if (!result.success) {
    // 禁じ手の場合は特別なフィードバック
    if (result.message?.includes("禁じ手")) {
      showForbiddenFeedback();
    }
    return;
  }

  // 正解判定
  if (
    currentStep.value?.expectedMoves &&
    currentStep.value.expectedMoves.length > 0
  ) {
    const isCorrect = currentStep.value.expectedMoves.some(
      (expected) =>
        position.row === expected.row && position.col === expected.col,
    );
    if (isCorrect) {
      handleCorrectMove();
    } else {
      handleIncorrectMove();
    }
  }
};

const handleCorrectMove = (): void => {
  isStepCompleted.value = true;
  showHint.value = false;

  // 正解のフィードバックを表示
  const correctMessages = currentStep.value?.dialogs?.correct as
    | DialogMessage[]
    | undefined;
  if (correctMessages && correctMessages.length > 0) {
    dialogStore.showMessage(correctMessages[0]);
  }

  // 進度を記録
  if (currentStep.value) {
    progressStore.completeStep(props.scenarioId, currentStep.value.id, 100);
  }
};

const handleIncorrectMove = (): void => {
  // 不正解のフィードバックを表示
  const incorrectMessages = currentStep.value?.dialogs?.incorrect as
    | DialogMessage[]
    | undefined;
  if (incorrectMessages && incorrectMessages.length > 0) {
    dialogStore.showMessage(incorrectMessages[0]);
  }

  // 盤面をリセット
  if (currentStep.value) {
    const { board, expectedMoves } = parseInitialBoard(
      currentStep.value.initialBoard,
    );
    currentStep.value.expectedMoves = expectedMoves;
    gameStore.setBoard(board);
  }
};

const showForbiddenFeedback = (): void => {
  if (!scenario.value?.dialogs) {
    return;
  }

  const forbidden = scenario.value.dialogs.forbidden_detected as
    | DialogMessage[]
    | undefined;

  if (forbidden && forbidden.length > 0) {
    dialogStore.showMessage(forbidden[0]);
  }

  // 盤面をリセット
  if (currentStep.value) {
    const { board, expectedMoves } = parseInitialBoard(
      currentStep.value.initialBoard,
    );
    currentStep.value.expectedMoves = expectedMoves;
    gameStore.setBoard(board);
  }
};

const toggleHint = (): void => {
  showHint.value = !showHint.value;
};

const nextStep = (): void => {
  if (!canProceed.value) {
    return;
  }

  if (isLastStep.value) {
    completeScenario();
  } else {
    currentStepIndex.value += 1;
    isStepCompleted.value = false;
    showHint.value = false;

    if (currentStep.value) {
      const { board, expectedMoves } = parseInitialBoard(
        currentStep.value.initialBoard,
      );
      currentStep.value.expectedMoves = expectedMoves;
      gameStore.setBoard(board);
    }
  }
};

const completeScenario = (): void => {
  progressStore.completeScenario(props.scenarioId);
  emit("complete");
};

const handleBack = (): void => {
  emit("back");
};

// Lifecycle
onMounted(() => {
  loadScenario();
});
</script>

<template>
  <div
    v-if="scenario"
    class="scenario-player"
  >
    <!-- ヘッダー -->
    <div class="header">
      <button
        class="back-button"
        @click="handleBack"
      >
        ← 戻る
      </button>
      <div class="scenario-info">
        <h2>{{ scenario.title }}</h2>
        <p>
          {{ currentStep?.title }} ({{ currentStepIndex + 1 }}/{{
            scenario.steps.length
          }})
        </p>
      </div>
    </div>

    <!-- メインコンテンツ -->
    <div class="content">
      <!-- 左側：盤面 -->
      <div class="board-section">
        <RenjuBoard
          :board-state="gameStore.board"
          :disabled="isStepCompleted"
          @place-stone="handlePlaceStone"
        />

        <!-- ヒント表示 -->
        <div
          v-if="showHint && currentStep?.hint"
          class="hint-box"
        >
          💡 {{ currentStep.hint }}
        </div>
      </div>

      <!-- 右側：対話とコントロール -->
      <div class="dialog-section">
        <!-- キャラクター対話 -->
        <CharacterDialog
          :message="dialogStore.currentMessage"
          :position="
            dialogStore.currentMessage?.character === 'fubuki'
              ? 'left'
              : 'right'
          "
        />

        <!-- 説明 -->
        <div class="step-description">
          <h3>{{ currentStep?.title }}</h3>
          <p>{{ currentStep?.description }}</p>
        </div>

        <!-- コントロール -->
        <div class="controls">
          <button
            v-if="!isStepCompleted"
            class="hint-button"
            @click="toggleHint"
          >
            {{ showHint ? "ヒントを隠す" : "ヒントを見る" }}
          </button>

          <button
            v-if="canProceed"
            class="next-button"
            @click="nextStep"
          >
            {{ isLastStep ? "シナリオ完了" : "次のステップへ" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scenario-player {
  min-height: 100vh;
  padding: 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
}

.header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 30px;
}

.back-button {
  padding: 10px 20px;
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  transition: all 0.2s;
}

.back-button:hover {
  background: #f5f5f5;
  border-color: #4a9eff;
}

.scenario-info h2 {
  margin: 0;
  color: #333;
}

.scenario-info p {
  margin: 5px 0 0;
  color: #666;
  font-size: 14px;
}

.content {
  display: flex;
  gap: 40px;
  align-items: flex-start;
}

.board-section {
  flex-shrink: 0;
}

.hint-box {
  margin-top: 20px;
  padding: 16px;
  background: #fff9c4;
  border: 2px solid #fbc02d;
  border-radius: 8px;
  max-width: 600px;
}

.dialog-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.step-description {
  padding: 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.step-description h3 {
  margin: 0 0 10px;
  color: #333;
}

.step-description p {
  margin: 0;
  color: #666;
  line-height: 1.6;
}

.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.hint-button,
.next-button {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.hint-button {
  background: #ffe082;
  color: #333;
}

.hint-button:hover {
  background: #ffd54f;
  transform: translateY(-2px);
}

.next-button {
  background: #4caf50;
  color: white;
}

.next-button:hover {
  background: #45a049;
  transform: translateY(-2px);
}

@media (max-width: 1024px) {
  .content {
    flex-direction: column;
  }

  .board-section {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
}
</style>
