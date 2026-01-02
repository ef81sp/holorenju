import { computed, ref, type ComputedRef, type Ref } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useGameStore } from "@/stores/gameStore";
import { useProgressStore } from "@/stores/progressStore";
import { boardStringToBoardState } from "@/logic/scenarioFileHandler";
import scenariosIndex from "@/data/scenarios/index.json";

import type { Scenario, Section, BoardAction } from "@/types/scenario";
import type { DialogMessage } from "@/types/character";

/**
 * シナリオ・ダイアログナビゲーションを管理するComposable
 *
 * シナリオの読み込み、セクション・ダイアログ間の遷移、初期化を担当します。
 * 複数のストア（appStore, gameStore, dialogStore, progressStore）と連携します。
 */
export const useScenarioNavigation = (scenarioId: string): {
  scenario: Ref<Scenario | null>;
  currentSectionIndex: Ref<number>;
  currentDialogueIndex: Ref<number>;
  isSectionCompleted: Ref<boolean>;
  currentSection: ComputedRef<Section | null>;
  isLastSection: ComputedRef<boolean>;
  canProceed: ComputedRef<boolean>;
  loadScenario: () => Promise<void>;
  showIntroDialog: () => void;
  nextDialogue: () => void;
  previousDialogue: () => void;
  nextSection: () => void;
  completeScenario: () => void;
  applyBoardAction: (action: BoardAction) => void;
  goBack: () => void;
} => {
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

  /**
   * シナリオを読み込み初期化
   */
  const loadScenario = async (): Promise<void> => {
    try {
      // Index.jsonからシナリオパスを取得
      let scenarioPath = "";
      for (const [, difficultyData] of Object.entries(
        scenariosIndex.difficulties,
      )) {
        const found = difficultyData.scenarios.find((s) => s.id === scenarioId);
        if (found) {
          scenarioPath = found.path;
          break;
        }
      }

      if (!scenarioPath) {
        throw new Error(`Scenario not found: ${scenarioId}`);
      }

      const scenarioModule = await import(
        `../../../../data/scenarios/${scenarioPath}`
      );
      const scenarioData = scenarioModule.default as Scenario;

      scenario.value = scenarioData;
      progressStore.startScenario(scenarioId);

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
      console.error("Failed to load scenario:", scenarioId, error);
    }
  };

  /**
   * イントロダイアログ（最初のダイアログ）を表示
   */
  const showIntroDialog = (): void => {
    const firstSection = scenario.value?.sections[0];
    if (firstSection && firstSection.type === "demo") {
      currentDialogueIndex.value = 0;
      const [firstDialogue] = firstSection.dialogues;
      if (firstDialogue) {
        dialogStore.showMessage({
          id: firstDialogue.id,
          character: firstDialogue.character,
          text: firstDialogue.text,
          emotion: firstDialogue.emotion,
        } as DialogMessage);
        if (firstDialogue.boardAction) {
          applyBoardAction(firstDialogue.boardAction);
        }
      }
    }
  };

  /**
   * 次のダイアログへ進む（デモセクション用）
   */
  const nextDialogue = (): void => {
    const demoSection = currentSection.value;
    if (!demoSection || demoSection.type !== "demo") {
      return;
    }

    currentDialogueIndex.value += 1;

    if (currentDialogueIndex.value >= demoSection.dialogues.length) {
      // デモセクション完了 → 問題セクションへ自動遷移
      isSectionCompleted.value = true;
      nextSection();
      return;
    }

    // 次のダイアログを表示
    const nextDialogueData = demoSection.dialogues[currentDialogueIndex.value];
    dialogStore.showMessage({
      id: nextDialogueData.id,
      character: nextDialogueData.character,
      text: nextDialogueData.text,
      emotion: nextDialogueData.emotion,
    } as DialogMessage);
    if (nextDialogueData.boardAction) {
      applyBoardAction(nextDialogueData.boardAction);
    }
  };

  /**
   * 前のダイアログへ戻す（デモセクション用）
   */
  const previousDialogue = (): void => {
    const demoSection = currentSection.value;
    if (!demoSection || demoSection.type !== "demo") {
      return;
    }

    if (currentDialogueIndex.value <= 0) {
      return;
    }

    currentDialogueIndex.value -= 1;

    const prevDialogueData = demoSection.dialogues[currentDialogueIndex.value];
    dialogStore.showMessage({
      id: prevDialogueData.id,
      character: prevDialogueData.character,
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

  /**
   * 次のセクションへ進む
   */
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
              character: firstDialogue.character,
              text: firstDialogue.text,
              emotion: firstDialogue.emotion,
            } as DialogMessage);
          }
        }
      }
    }
  };

  /**
   * シナリオを完了
   */
  const completeScenario = (): void => {
    progressStore.completeScenario(scenarioId);
    appStore.goToScenarioList();
  };

  /**
   * 盤面操作を適用（デモセクションのダイアログに含まれるアクション）
   */
  const applyBoardAction = (action: BoardAction): void => {
    if (action.type === "place") {
      gameStore.placeStone(action.position);
    } else if (action.type === "remove") {
      const newBoard = gameStore.board.map((row) => [...row]);
      newBoard[action.position.row][action.position.col] = null;
      gameStore.setBoard(newBoard);
    } else if (action.type === "setBoard") {
      const boardState = boardStringToBoardState(action.board);
      gameStore.setBoard(boardState);
    }
    // Mark, lineアクションは盤面表示の拡張時に実装
  };

  /**
   * メインビューへ戻る
   */
  const goBack = (): void => {
    appStore.goToScenarioList();
  };

  return {
    // State
    scenario,
    currentSectionIndex,
    currentDialogueIndex,
    isSectionCompleted,
    // Computed
    currentSection,
    isLastSection,
    canProceed,
    // Methods
    loadScenario,
    showIntroDialog,
    nextDialogue,
    previousDialogue,
    nextSection,
    completeScenario,
    applyBoardAction,
    goBack,
  };
};
