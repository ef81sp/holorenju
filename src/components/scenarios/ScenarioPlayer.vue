<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useElementSize } from "@vueuse/core";

import CharacterDialog from "@/components/character/CharacterDialog.vue";
import RenjuBoard from "@/components/game/RenjuBoard.vue";
import { boardStringToBoardState } from "@/logic/scenarioFileHandler";
import { useAppStore } from "@/stores/appStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useGameStore } from "@/stores/gameStore";
import { useProgressStore } from "@/stores/progressStore";
import scenariosIndex from "@/data/scenarios/index.json";

import type { Scenario, Section } from "@/types/scenario";
import type { DialogMessage } from "@/types/character";
import type { Position } from "@/types/game";

// Props
interface Props {
  scenarioId: string;
}

const props = defineProps<Props>();

// Stores
const appStore = useAppStore();
const gameStore = useGameStore();
const dialogStore = useDialogStore();
const progressStore = useProgressStore();

// State
const scenario = ref<Scenario | null>(null);
const currentSectionIndex = ref(0);
const isSectionCompleted = ref(false);
const showHint = ref(false);

// 盤フレームサイズ計測用
const boardFrameRef = ref<HTMLElement | null>(null);
const { width: boardFrameWidth, height: boardFrameHeight } = useElementSize(
  boardFrameRef,
  {
    width: 0,
    height: 0,
  },
);

// Computed
const currentSection = computed<Section | null>(() => {
  if (!scenario.value) {
    return null;
  }
  return scenario.value.sections[currentSectionIndex.value] ?? null;
});

const isLastSection = computed(() => {
  if (!scenario.value) {
    return false;
  }
  return currentSectionIndex.value >= scenario.value.sections.length - 1;
});

const canProceed = computed(() => isSectionCompleted.value);

const boardSize = computed(() => {
  // 余白とgapを考慮したサイズ計算
  const availableWidth = boardFrameWidth.value;
  const availableHeight = boardFrameHeight.value;

  // 初期値が0の場合は計算しない（最小サイズを返す）
  if (availableWidth === 0 || availableHeight === 0) {
    console.warn("[ScenarioPlayer] boardSize: availableWidth or Height is 0");
    return 400; // 最小デフォルトサイズ
  }

  const calculatedSize = Math.min(availableWidth, availableHeight);

  console.warn("[ScenarioPlayer] boardSize computed:", {
    availableWidth,
    availableHeight,
    calculatedSize,
  });

  return calculatedSize;
});

// Methods
const loadScenario = async (): Promise<void> => {
  try {
    // Index.jsonからシナリオパスを取得
    let scenarioPath = "";
    for (const [, difficultyData] of Object.entries(
      scenariosIndex.difficulties,
    )) {
      const found = difficultyData.scenarios.find(
        (s) => s.id === props.scenarioId,
      );
      if (found) {
        scenarioPath = found.path;
        break;
      }
    }

    if (!scenarioPath) {
      throw new Error(`Scenario not found: ${props.scenarioId}`);
    }

    const scenarioModule = await import(`../../data/scenarios/${scenarioPath}`);
    const scenarioData = scenarioModule.default as Scenario;

    scenario.value = scenarioData;
    progressStore.startScenario(props.scenarioId);

    // 初期盤面をセット
    if (currentSection.value) {
      const boardState = boardStringToBoardState(
        currentSection.value.initialBoard,
      );
      gameStore.setBoard(boardState);
    }
  } catch (error) {
    console.error("Failed to load scenario:", props.scenarioId, error);
  }
};

const showIntroDialog = (): void => {
  // 新しい構造では、デモセクションのダイアログから取得
  const firstSection = scenario.value?.sections[0];
  if (firstSection && firstSection.type === "demo") {
    const [firstDialogue] = firstSection.dialogues;
    if (firstDialogue) {
      dialogStore.showMessage({
        character: firstDialogue.character,
        text: firstDialogue.text,
        emotion: firstDialogue.emotion,
      } as DialogMessage);
    }
  }
};

const handlePlaceStone = (position: Position): void => {
  if (isSectionCompleted.value) {
    return;
  }

  // 新構造では問題セクションのみ実装
  if (!currentSection.value || currentSection.value.type !== "problem") {
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

  // 成功条件の判定ロジックは今後の実装対象
  handleIncorrectMove();
};

const handleCorrectMove = (): void => {
  isSectionCompleted.value = true;
  showHint.value = false;

  // 正解のフィードバックを表示
  if (currentSection.value && currentSection.value.type === "problem") {
    if (currentSection.value.feedback.success.length > 0) {
      const [msg] = currentSection.value.feedback.success;
      dialogStore.showMessage({
        character: msg.character,
        text: msg.text,
        emotion: msg.emotion,
      } as DialogMessage);
    }
  }

  // 進度を記録
  if (currentSection.value) {
    progressStore.completeSection(
      props.scenarioId,
      currentSection.value.id,
      100,
    );
  }
};

const handleIncorrectMove = (): void => {
  // 不正解のフィードバックを表示
  if (currentSection.value && currentSection.value.type === "problem") {
    if (currentSection.value.feedback.failure.length > 0) {
      const [msg] = currentSection.value.feedback.failure;
      dialogStore.showMessage({
        character: msg.character,
        text: msg.text,
        emotion: msg.emotion,
      } as DialogMessage);
    }
  }

  // 盤面をリセット
  if (currentSection.value) {
    const boardState = boardStringToBoardState(
      currentSection.value.initialBoard,
    );
    gameStore.setBoard(boardState);
  }
};

const showForbiddenFeedback = (): void => {
  // 禁じ手のフィードバック（新構造では未実装）
  // 禁じ手の応答はシナリオ拡張時に追加予定
};

const toggleHint = (): void => {
  showHint.value = !showHint.value;
};

const nextSection = (): void => {
  if (!canProceed.value) {
    return;
  }

  if (isLastSection.value) {
    completeScenario();
  } else {
    currentSectionIndex.value += 1;
    isSectionCompleted.value = false;
    showHint.value = false;

    if (currentSection.value) {
      const boardState = boardStringToBoardState(
        currentSection.value.initialBoard,
      );
      gameStore.setBoard(boardState);
    }
  }
};

const completeScenario = (): void => {
  progressStore.completeScenario(props.scenarioId);
  appStore.goToScenarioList();
};

const handleBack = (): void => {
  appStore.goToScenarioList();
};

// Lifecycle
onMounted(async () => {
  loadScenario();

  await nextTick();
  console.warn("[ScenarioPlayer] Initial size:", {
    width: boardFrameWidth.value,
    height: boardFrameHeight.value,
  });
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
          {{ currentSection?.title }} ({{ currentSectionIndex + 1 }}/{{
            scenario.sections.length
          }})
        </p>
      </div>
    </div>

    <!-- 盤面フレーム（左上 11×6）-->
    <div
      ref="boardFrameRef"
      class="board-section"
    >
      <div class="board-wrapper">
        <RenjuBoard
          :board-state="gameStore.board"
          :disabled="isSectionCompleted"
          :stage-size="boardSize"
          @place-stone="handlePlaceStone"
        />
      </div>

      <!-- ヒント表示 -->
      <div
        v-if="
          showHint &&
            currentSection?.type === 'problem' &&
            currentSection.hints &&
            currentSection.hints.length > 0
        "
        class="hint-box"
      >
        💡 {{ currentSection.hints[0] }}
      </div>
    </div>

    <!-- 説明・コントロール部（右側 5×9）-->
    <div class="info-section">
      <!-- 説明 -->
      <div class="step-description">
        <h3>{{ currentSection?.id }}</h3>
        <p v-if="currentSection?.type === 'problem'">
          {{ currentSection.description }}
        </p>
      </div>

      <!-- コントロール -->
      <div class="controls">
        <button
          v-if="!isSectionCompleted"
          class="hint-button"
          @click="toggleHint"
        >
          {{ showHint ? "ヒントを隠す" : "ヒントを見る" }}
        </button>

        <button
          v-if="canProceed"
          class="next-button"
          @click="nextSection"
        >
          {{ isLastSection ? "シナリオ完了" : "次のセクションへ" }}
        </button>
      </div>
    </div>

    <!-- セリフ部（左下 11×2）-->
    <div class="character-dialog-section">
      <CharacterDialog
        :message="dialogStore.currentMessage"
        :position="
          dialogStore.currentMessage?.character === 'fubuki' ? 'left' : 'right'
        "
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

.header {
  grid-column: 1 / 2;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: var(--size-20);
}

.board-section {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--size-12);
  overflow: hidden;
  min-height: 0; /* grid itemの最小サイズをリセット */
}

.board-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0; /* flex itemの最小サイズをリセット */
}

.info-section {
  grid-column: 2;
  grid-row: 1 / 4;
  display: flex;
  flex-direction: column;
  gap: var(--size-20);
  overflow-y: auto;
}

.character-dialog-section {
  grid-column: 1;
  grid-row: 3;
  background: transparent;
  overflow-y: auto;
}

.back-button {
  padding: var(--size-10) var(--size-20);
  background: white;
  border: 2px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  font-size: var(--size-16);
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
  margin: var(--size-5) 0 0;
  color: #666;
  font-size: var(--size-14);
}

.hint-box {
  padding: var(--size-16);
  background: var(--color-fubuki-bg);
  border: 2px solid var(--color-fubuki-primary);
  border-radius: 8px;
  align-self: center;
  max-width: 100%;
}

.step-description {
  padding: var(--size-20);
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.step-description h3 {
  margin: 0 0 var(--size-10);
  color: #333;
}

.step-description p {
  margin: 0;
  color: #666;
  line-height: 1.6;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: var(--size-12);
}

.hint-button,
.next-button {
  padding: var(--size-12) var(--size-24);
  border: none;
  border-radius: 8px;
  font-size: var(--size-16);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.hint-button {
  background: var(--color-fubuki-primary);
  color: var(--color-text-primary);
}

.hint-button:hover {
  background: #4a9ec9;
  transform: translateY(-2px);
}

.next-button {
  background: var(--color-holo-purple);
  color: var(--color-text-primary);
}

.next-button:hover {
  background: #5e3f7a;
  transform: translateY(-2px);
}
</style>
