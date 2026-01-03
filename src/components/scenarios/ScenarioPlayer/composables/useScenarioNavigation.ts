import { computed, ref, type ComputedRef, type Ref } from "vue";

import type {
  Scenario,
  Section,
  BoardAction,
  DemoDialogue,
} from "@/types/scenario";

import scenariosIndex from "@/data/scenarios/index.json";
import { boardStringToBoardState } from "@/logic/scenarioFileHandler";
import { parseScenario } from "@/logic/scenarioParser";
import { useAppStore } from "@/stores/appStore";
import { useBoardStore } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useProgressStore } from "@/stores/progressStore";

/**
 * ボードアクションのアニメーション待機時間（ミリ秒）
 * RenjuBoard.vueのアニメーション時間（200ms）+ マージン
 */
const BOARD_ACTION_ANIMATION_DURATION = 250;

/**
 * ダイアログと所属セクション、セクション内インデックスをマッピング
 */
interface DialogueMapping {
  dialogue: DemoDialogue;
  sectionIndex: number;
  sectionDialogueIndex: number;
}

/**
 * シナリオ・ダイアログナビゲーションを管理するComposable
 *
 * シナリオのすべてのセクションのダイアログを統合管理し、
 * グローバルなダイアログインデックスでセクションをまたぐナビゲーションを実現します。
 */
export const useScenarioNavigation = (
  scenarioId: string,
): {
  scenario: Ref<Scenario | null>;
  currentSectionIndex: Ref<number>;
  currentDialogueIndex: Ref<number>;
  isSectionCompleted: Ref<boolean>;
  currentSection: ComputedRef<Section | null>;
  isLastSection: ComputedRef<boolean>;
  canProceed: ComputedRef<boolean>;
  canNavigatePrevious: ComputedRef<boolean>;
  canNavigateNext: ComputedRef<boolean>;
  allDialogues: Ref<DialogueMapping[]>;
  loadScenario: () => Promise<void>;
  showIntroDialog: () => void;
  nextDialogue: () => void;
  previousDialogue: () => void;
  nextSection: () => void;
  completeScenario: () => void;
  applyBoardAction: (action: BoardAction) => Promise<void>;
  goBack: () => void;
} => {
  // Stores
  const appStore = useAppStore();
  const boardStore = useBoardStore();
  const dialogStore = useDialogStore();
  const progressStore = useProgressStore();

  // State
  const scenario = ref<Scenario | null>(null);
  const currentSectionIndex = ref(0);
  const currentDialogueIndex = ref(0);
  const isSectionCompleted = ref(false);
  const allDialogues = ref<DialogueMapping[]>([]);

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

  const canNavigatePrevious = computed(() => currentDialogueIndex.value > 0);

  const canNavigateNext = computed(
    () => currentDialogueIndex.value < allDialogues.value.length - 1,
  );

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
      const rawScenarioData = scenarioModule.default;
      const scenarioData = parseScenario(rawScenarioData);

      scenario.value = scenarioData;

      // すべてのセクションのダイアログを統合
      const dialogueMappings: DialogueMapping[] = [];
      for (
        let sectionIndex = 0;
        sectionIndex < scenarioData.sections.length;
        sectionIndex++
      ) {
        const section = scenarioData.sections[sectionIndex];
        for (
          let dialogueIndex = 0;
          dialogueIndex < section.dialogues.length;
          dialogueIndex++
        ) {
          dialogueMappings.push({
            dialogue: section.dialogues[dialogueIndex],
            sectionIndex,
            sectionDialogueIndex: dialogueIndex,
          });
        }
      }
      allDialogues.value = dialogueMappings;

      progressStore.startScenario(scenarioId);

      // 初期盤面をセット
      if (currentSection.value) {
        const boardState = boardStringToBoardState(
          currentSection.value.initialBoard,
        );
        boardStore.setBoard(boardState);
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
    if (allDialogues.value.length === 0) {
      return;
    }

    currentDialogueIndex.value = 0;
    const [mapping] = allDialogues.value;
    currentSectionIndex.value = mapping.sectionIndex;
    showDialogueWithAction(mapping.dialogue);
  };

  /**
   * 複数のボードアクションを順次実行するヘルパー
   */
  const applyBoardActionsSequentially = async (
    actions: BoardAction[],
  ): Promise<void> => {
    await actions.reduce(async (promise, action) => {
      await promise;
      await applyBoardAction(action);
    }, Promise.resolve());
  };

  /**
   * 複数のダイアログまでのボードアクションを順次実行
   */
  const applyActionsUntilDialogueIndex = async (
    dialogues: DemoDialogue[],
    untilIndex: number,
  ): Promise<void> => {
    const relevantDialogues = dialogues.slice(0, untilIndex);
    await relevantDialogues.reduce(async (promise, dialogue) => {
      await promise;
      await applyBoardActionsSequentially(dialogue.boardActions);
    }, Promise.resolve());
  };

  /**
   * 次のダイアログへ進む
   */
  const nextDialogue = async (): Promise<void> => {
    if (currentDialogueIndex.value < allDialogues.value.length - 1) {
      currentDialogueIndex.value += 1;
      const mapping = allDialogues.value[currentDialogueIndex.value];
      const prevMapping = allDialogues.value[currentDialogueIndex.value - 1];

      // セクションが変わった場合、盤面を初期化
      if (mapping.sectionIndex !== prevMapping.sectionIndex) {
        const newSection = scenario.value?.sections[mapping.sectionIndex];
        if (newSection && newSection.type === "demo") {
          const boardState = boardStringToBoardState(newSection.initialBoard);
          boardStore.setBoard(boardState);
          currentSectionIndex.value = mapping.sectionIndex;
          isSectionCompleted.value = false;
          // 新しいセクション内の前のダイアログまでのボードアクションを順次実行
          await applyActionsUntilDialogueIndex(
            newSection.dialogues,
            mapping.sectionDialogueIndex,
          );
        }
      }

      await showDialogueWithAction(mapping.dialogue);
    }
  };

  /**
   * 前のダイアログへ戻す
   */
  const previousDialogue = async (): Promise<void> => {
    if (currentDialogueIndex.value > 0) {
      currentDialogueIndex.value -= 1;
      const mapping = allDialogues.value[currentDialogueIndex.value];
      const nextMapping = allDialogues.value[currentDialogueIndex.value + 1];

      // セクションが変わった場合、盤面を初期化
      if (mapping.sectionIndex === nextMapping.sectionIndex) {
        // 同じセクション内での移動の場合
        const section = scenario.value?.sections[mapping.sectionIndex];
        if (section && section.type === "demo") {
          const boardState = boardStringToBoardState(section.initialBoard);
          boardStore.setBoard(boardState);
          // 前のダイアログまでのボードアクションを順次実行
          await applyActionsUntilDialogueIndex(
            section.dialogues,
            mapping.sectionDialogueIndex,
          );
        }
      } else {
        const newSection = scenario.value?.sections[mapping.sectionIndex];
        if (newSection && newSection.type === "demo") {
          const boardState = boardStringToBoardState(newSection.initialBoard);
          boardStore.setBoard(boardState);
          currentSectionIndex.value = mapping.sectionIndex;
          isSectionCompleted.value = false;
          // 前のセクション内の前のダイアログまでのボードアクションを順次実行
          await applyActionsUntilDialogueIndex(
            newSection.dialogues,
            mapping.sectionDialogueIndex,
          );
        }
      }

      await showDialogueWithAction(mapping.dialogue);
    }
  };

  /**
   * ダイアログを表示して盤面操作を適用
   */
  const showDialogueWithAction = async (
    dialogue: DemoDialogue,
  ): Promise<void> => {
    dialogStore.showMessage({
      id: dialogue.id,
      character: dialogue.character,
      text: dialogue.text,
      emotion: dialogue.emotion,
    });
    // BoardActions 配列を順次実行
    await dialogue.boardActions.reduce(async (promise, action) => {
      await promise;
      await applyBoardAction(action);
    }, Promise.resolve());
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
        boardStore.setBoard(boardState);

        // ダイアログがあるセクションなら最初のダイアログを表示
        const section = currentSection.value;
        if (section.type === "demo") {
          const [firstDialogue] = section.dialogues;
          if (firstDialogue) {
            showDialogueWithAction(firstDialogue);
          }
        } else if (section.type === "problem") {
          const [firstDialogue] = section.dialogues;
          if (firstDialogue) {
            showDialogueWithAction(firstDialogue);
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
  const applyBoardAction = async (action: BoardAction): Promise<void> => {
    if (action.type === "place") {
      boardStore.placeStone(action.position, action.color);
      // アニメーション完了を待つ
      await new Promise((resolve) => {
        setTimeout(resolve, BOARD_ACTION_ANIMATION_DURATION);
      });
    } else if (action.type === "remove") {
      boardStore.removeStone(action.position);
      // アニメーション完了を待つ
      await new Promise((resolve) => {
        setTimeout(resolve, BOARD_ACTION_ANIMATION_DURATION);
      });
    } else if (action.type === "setBoard") {
      const boardState = boardStringToBoardState(action.board);
      boardStore.setBoard(boardState);
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
    allDialogues,
    // Computed
    currentSection,
    isLastSection,
    canProceed,
    canNavigatePrevious,
    canNavigateNext,
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
