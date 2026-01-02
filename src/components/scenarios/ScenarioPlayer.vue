<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useElementSize } from "@vueuse/core";

import CharacterDialog from "@/components/character/CharacterDialog.vue";
import RenjuBoard from "@/components/game/RenjuBoard.vue";
import { boardStringToBoardState } from "@/logic/scenarioFileHandler";
import { useAppStore } from "@/stores/appStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useGameStore } from "@/stores/gameStore";
import { useProgressStore } from "@/stores/progressStore";
import scenariosIndex from "@/data/scenarios/index.json";

import type {
  Scenario,
  Section,
  DemoSection,
  ProblemSection,
  SuccessCondition,
  PositionCondition,
  PatternCondition,
  SequenceCondition,
  BoardAction,
} from "@/types/scenario";
import type { DialogMessage, CharacterType } from "@/types/character";
import type { Position, BoardState } from "@/types/game";

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
const currentDialogueIndex = ref(0);
const isSectionCompleted = ref(false);
const showHint = ref(false);
const cursorPosition = ref<Position>({ row: 7, col: 7 });

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

// Keyboard handler for debug
const handleKeyDown = (event: KeyboardEvent): void => {
  const { key } = event;

  switch (key.toLowerCase()) {
    case "w":
      event.preventDefault();
      cursorPosition.value.row = Math.max(0, cursorPosition.value.row - 1);
      break;
    case "s":
      event.preventDefault();
      cursorPosition.value.row = Math.min(14, cursorPosition.value.row + 1);
      break;
    case "a":
      event.preventDefault();
      cursorPosition.value.col = Math.max(0, cursorPosition.value.col - 1);
      break;
    case "d":
      event.preventDefault();
      cursorPosition.value.col = Math.min(14, cursorPosition.value.col + 1);
      break;
    case " ":
    case "enter":
      event.preventDefault();
      handlePlaceStone(cursorPosition.value);
      break;
    default:
      break;
  }
};

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

    // デモセクションなら最初のダイアログを表示
    showIntroDialog();
  } catch (error) {
    console.error("Failed to load scenario:", props.scenarioId, error);
  }
};

const showIntroDialog = (): void => {
  // デモセクションの最初のダイアログを表示
  const firstSection = scenario.value?.sections[0];
  if (firstSection && firstSection.type === "demo") {
    currentDialogueIndex.value = 0;
    const [firstDialogue] = firstSection.dialogues;
    if (firstDialogue) {
      dialogStore.showMessage({
        id: firstDialogue.id,
        character: firstDialogue.character as CharacterType,
        text: firstDialogue.text,
        emotion: firstDialogue.emotion,
      } as DialogMessage);
      // ダイアログ表示時に盤面操作を実行
      if (firstDialogue.boardAction) {
        applyBoardAction(firstDialogue.boardAction);
      }
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

  // すでに石が置かれている場合はスキップ
  if (gameStore.board[position.row][position.col] !== null) {
    console.warn("[handlePlaceStone] Cell already occupied");
    return;
  }

  // 問題セクションでは常に黒石を配置（色を親で制御）
  const newBoard = gameStore.board.map((row) => [...row]);
  newBoard[position.row][position.col] = "black";
  gameStore.setBoard(newBoard);

  console.warn(
    `[handlePlaceStone] Placed black stone at (${position.row}, ${position.col})`,
  );

  // 成功条件をチェック
  const problemSection = currentSection.value as ProblemSection;
  if (checkAllConditions(problemSection.successConditions)) {
    handleCorrectMove();
  }
};

const handleCorrectMove = (): void => {
  console.warn("[handleCorrectMove] Called");
  isSectionCompleted.value = true;
  showHint.value = false;

  // 正解のフィードバックを表示
  if (currentSection.value && currentSection.value.type === "problem") {
    console.warn(
      "[handleCorrectMove] Problem section found, feedback count:",
      currentSection.value.feedback.success.length,
    );
    if (currentSection.value.feedback.success.length > 0) {
      const [msg] = currentSection.value.feedback.success;
      console.warn("[handleCorrectMove] Showing success feedback:", msg.text);
      dialogStore.showMessage({
        id: `feedback-success-${msg.character}`,
        character: msg.character as CharacterType,
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

const showForbiddenFeedback = (): void => {
  // 禁じ手のフィードバック（新構造では未実装）
  // 禁じ手の応答はシナリオ拡張時に追加予定
};

const applyBoardAction = (action: BoardAction): void => {
  if (action.type === "place") {
    gameStore.placeStone(action.position);
  } else if (action.type === "remove") {
    // 石を削除（盤面状態を直接操作）
    const newBoard = gameStore.board.map((row) => [...row]);
    newBoard[action.position.row][action.position.col] = null;
    gameStore.setBoard(newBoard);
  } else if (action.type === "setBoard") {
    const boardState = boardStringToBoardState(action.board);
    gameStore.setBoard(boardState);
  }
  // Mark, lineアクションは盤面表示の拡張時に実装
};

const checkSuccessCondition = (
  condition: SuccessCondition,
  board: BoardState,
): boolean => {
  if (condition.type === "position") {
    const posCondition = condition;
    const result = posCondition.positions.some((pos) => {
      const cell = board[pos.row][pos.col];
      const matches = cell === posCondition.color;
      console.warn(
        `[checkSuccessCondition] pos(${pos.row},${pos.col}): cell=${cell}, expected=${posCondition.color}, matches=${matches}`,
      );
      return matches;
    });
    console.warn(
      `[checkSuccessCondition] position condition result: ${result}`,
    );
    return result;
  }

  if (condition.type === "pattern") {
    // パターン判定は今後実装
    return false;
  }

  if (condition.type === "sequence") {
    // シーケンス判定は今後実装
    return false;
  }

  return false;
};

const checkAllConditions = (conditions: SuccessCondition[]): boolean => {
  const result = conditions.some((condition) =>
    checkSuccessCondition(condition, gameStore.board),
  );
  console.warn(`[checkAllConditions] All conditions check result: ${result}`);
  return result;
};

const nextDialogue = (): void => {
  const demoSection = currentSection.value as DemoSection;
  if (!demoSection || demoSection.type !== "demo") {
    return;
  }

  // 次のダイアログに進む
  currentDialogueIndex.value += 1;

  if (currentDialogueIndex.value >= demoSection.dialogues.length) {
    // デモセクション完了 → 問題セクションへ自動遷移
    isSectionCompleted.value = true; // CanProceedがtrueになるようにセット
    nextSection();
    return;
  }

  // 次のダイアログを表示
  const nextDialogueData = demoSection.dialogues[currentDialogueIndex.value];
  dialogStore.showMessage({
    id: nextDialogueData.id,
    character: nextDialogueData.character as CharacterType,
    text: nextDialogueData.text,
    emotion: nextDialogueData.emotion,
  } as DialogMessage);
  // ダイアログ表示時に盤面操作を実行
  if (nextDialogueData.boardAction) {
    applyBoardAction(nextDialogueData.boardAction);
  }
};

const previousDialogue = (): void => {
  const demoSection = currentSection.value as DemoSection;
  if (!demoSection || demoSection.type !== "demo") {
    return;
  }

  if (currentDialogueIndex.value <= 0) {
    return;
  }

  // 前のダイアログに戻す
  currentDialogueIndex.value -= 1;

  const prevDialogueData = demoSection.dialogues[currentDialogueIndex.value];
  dialogStore.showMessage({
    id: prevDialogueData.id,
    character: prevDialogueData.character as CharacterType,
    text: prevDialogueData.text,
    emotion: prevDialogueData.emotion,
  } as DialogMessage);

  // 初期盤面に戻す
  const boardState = boardStringToBoardState(demoSection.initialBoard);
  gameStore.setBoard(boardState);

  // 前のダイアログまでの盤面操作を再実行
  for (let i = 0; i < currentDialogueIndex.value; i++) {
    const dialogue = demoSection.dialogues[i];
    if (dialogue.boardAction) {
      applyBoardAction(dialogue.boardAction);
    }
  }
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
    currentDialogueIndex.value = 0;
    isSectionCompleted.value = false;
    showHint.value = false;

    if (currentSection.value) {
      const boardState = boardStringToBoardState(
        currentSection.value.initialBoard,
      );
      gameStore.setBoard(boardState);

      // デモセクションなら最初のダイアログを表示
      if (currentSection.value.type === "demo") {
        const [firstDialogue] = currentSection.value.dialogues;
        if (firstDialogue) {
          dialogStore.showMessage({
            id: firstDialogue.id,
            character: firstDialogue.character as CharacterType,
            text: firstDialogue.text,
            emotion: firstDialogue.emotion,
          } as DialogMessage);
        }
      }
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
  window.addEventListener("keydown", handleKeyDown);

  await nextTick();
  console.warn("[ScenarioPlayer] Initial size:", {
    width: boardFrameWidth.value,
    height: boardFrameHeight.value,
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
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
        <!-- Keyboard control UI -->
        <div class="keyboard-control-info">
          <div class="control-title">キーボード操作</div>
          <div class="control-keys">
            <span class="key">W/A/S/D</span>: カーソル移動
          </div>
          <div class="control-keys">
            <span class="key">Space/Enter</span>: 配置
          </div>
          <div class="cursor-position">
            位置: ({{ cursorPosition.row }}, {{ cursorPosition.col }})
          </div>
        </div>
        <RenjuBoard
          :board-state="gameStore.board"
          :disabled="isSectionCompleted"
          :stage-size="boardSize"
          :cursor-position="cursorPosition"
          @place-stone="handlePlaceStone"
        />
      </div>

      <!-- ヒント表示 -->
      <!-- Note: ヒント機能は廃止されました。問題セクションで直接ヒント表示を追加する場合は別途実装予定 -->
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
        @dialog-clicked="
          currentSection?.type === 'demo' ? nextDialogue() : undefined
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
  gap: var(--size-16);
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

.keyboard-control-info {
  background: rgba(255, 255, 255, 0.95);
  border: 2px solid var(--color-fubuki-primary);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 7px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
  min-width: 150px;
}

.control-title {
  font-weight: 500;
  color: var(--color-fubuki-primary);
  margin-bottom: 8px;
  font-size: 13px;
}

.control-keys {
  margin-bottom: 4px;
  color: #666;
}

.key {
  display: inline-block;
  padding: 2px 6px;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 500;
  margin-right: 4px;
}

.cursor-position {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #e0e0e0;
  font-family: monospace;
  color: #333;
  font-weight: 500;
}
</style>
