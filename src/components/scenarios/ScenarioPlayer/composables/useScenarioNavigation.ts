import { computed, ref, type ComputedRef, type Ref } from "vue";

import type { BoardState } from "@/types/game";
import type { Scenario, Section, DemoDialogue } from "@/types/scenario";

import scenariosIndex from "@/data/scenarios/index.json";
import { boardStringToBoardState } from "@/logic/scenarioFileHandler";
import { parseScenario } from "@/logic/scenarioParser";
import { useAppStore } from "@/stores/appStore";
import { useBoardStore, type Stone } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useProgressStore } from "@/stores/progressStore";

/**
 * ダイアログと所属セクション、セクション内インデックスをマッピング
 */
interface DialogueMapping {
  dialogue: DemoDialogue;
  sectionIndex: number;
  sectionDialogueIndex: number;
}

/**
 * 盤面スナップショット（キャッシュ用）
 */
interface BoardSnapshot {
  board: BoardState;
  stones: Stone[];
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
  showIntroDialog: () => Promise<void>;
  nextDialogue: () => Promise<void>;
  previousDialogue: () => void;
  nextSection: () => Promise<void>;
  completeScenario: () => void;
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
  // 盤面キャッシュ: セクションインデックス → ダイアログインデックス → スナップショット
  const boardCache = ref<Map<number, Map<number, BoardSnapshot>>>(new Map());

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
      // キャッシュクリア
      clearBoardCache();

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
        boardStore.clearStones();
      }

      // デモセクションなら最初のダイアログを表示
      await showIntroDialog();
    } catch (error) {
      console.error("Failed to load scenario:", scenarioId, error);
    }
  };

  /**
   * イントロダイアログ（最初のダイアログ）を表示
   */
  const showIntroDialog = async (): Promise<void> => {
    if (allDialogues.value.length === 0) {
      return;
    }

    currentDialogueIndex.value = 0;
    const [mapping] = allDialogues.value;
    currentSectionIndex.value = mapping.sectionIndex;
    await showDialogueWithAction(mapping.dialogue, true);

    // 初期状態をキャッシュ
    saveBoardSnapshot(mapping.sectionIndex, currentDialogueIndex.value);
  };

  /**
   * 次のダイアログへ進む
   */
  const nextDialogue = async (): Promise<void> => {
    // 進行中のアニメーションをキャンセル（連打対応）
    boardStore.cancelOngoingAnimations();

    if (currentDialogueIndex.value < allDialogues.value.length - 1) {
      currentDialogueIndex.value += 1;
      const mapping = allDialogues.value[currentDialogueIndex.value];
      const prevMapping = allDialogues.value[currentDialogueIndex.value - 1];

      // セクションが変わった場合
      if (mapping.sectionIndex !== prevMapping.sectionIndex) {
        const newSection = scenario.value?.sections[mapping.sectionIndex];
        if (newSection) {
          const boardState = boardStringToBoardState(newSection.initialBoard);
          boardStore.setBoard(boardState);
          boardStore.clearStones();
          currentSectionIndex.value = mapping.sectionIndex;
          isSectionCompleted.value = false;

          // 新しいセクション内の前のダイアログまでのアクションを適用（アニメーションなし）
          await applyActionsUntilDialogueIndex(
            newSection.dialogues,
            mapping.sectionDialogueIndex,
          );
        }
      }

      await showDialogueWithAction(mapping.dialogue, true);

      // キャッシュ保存
      saveBoardSnapshot(mapping.sectionIndex, currentDialogueIndex.value);
    }
  };

  /**
   * 前のダイアログへ戻す
   */
  const previousDialogue = (): void => {
    if (currentDialogueIndex.value <= 0) {
      return;
    }

    const mapping = allDialogues.value[currentDialogueIndex.value - 1];
    const currentMapping = allDialogues.value[currentDialogueIndex.value];

    currentDialogueIndex.value -= 1;

    // キャッシュから復元を試みる
    if (
      restoreBoardSnapshot(mapping.sectionIndex, currentDialogueIndex.value)
    ) {
      // 復元成功
      if (mapping.sectionIndex !== currentMapping.sectionIndex) {
        currentSectionIndex.value = mapping.sectionIndex;
        isSectionCompleted.value = false;
      }
      showDialogueMessage(mapping.dialogue);
      return;
    }

    // キャッシュがない場合は再構築
    const section = scenario.value?.sections[mapping.sectionIndex];
    if (section) {
      const boardState = boardStringToBoardState(section.initialBoard);
      boardStore.setBoard(boardState);
      boardStore.clearStones();

      if (mapping.sectionIndex !== currentMapping.sectionIndex) {
        currentSectionIndex.value = mapping.sectionIndex;
        isSectionCompleted.value = false;
      }

      applyActionsUntilDialogueIndex(
        section.dialogues,
        mapping.sectionDialogueIndex + 1,
      );

      // 再構築結果をキャッシュ
      saveBoardSnapshot(mapping.sectionIndex, currentDialogueIndex.value);
    }

    showDialogueMessage(mapping.dialogue);
  };

  /**
   * ダイアログメッセージのみ表示（石の追加なし）
   */
  const showDialogueMessage = (dialogue: DemoDialogue): void => {
    dialogStore.showMessage({
      id: dialogue.id,
      character: dialogue.character,
      text: dialogue.text,
      emotion: dialogue.emotion,
    });
  };

  /**
   * ダイアログを表示して石を追加
   */
  const showDialogueWithAction = async (
    dialogue: DemoDialogue,
    animate: boolean,
  ): Promise<void> => {
    showDialogueMessage(dialogue);

    // placeアクションの石を追加
    const placeActions = dialogue.boardActions.filter(
      (a) => a.type === "place",
    );
    if (placeActions.length > 0) {
      await boardStore.addStones(
        placeActions.map((a) => ({
          position: a.position,
          color: a.color,
        })),
        currentDialogueIndex.value,
        { animate },
      );
    }

    // resetAll, setBoard等の他のアクションも処理
    for (const action of dialogue.boardActions) {
      if (action.type === "resetAll") {
        boardStore.clearStones();
        boardStore.resetBoard();
      } else if (action.type === "setBoard") {
        const boardState = boardStringToBoardState(action.board);
        boardStore.setBoard(boardState);
      }
    }
  };

  /**
   * 指定インデックスまでのダイアログのアクションを適用（アニメーションなし）
   * resetAll, setBoard, place を順次処理
   */
  const applyActionsUntilDialogueIndex = async (
    dialogues: DemoDialogue[],
    untilIndex: number,
  ): Promise<void> => {
    for (let i = 0; i < untilIndex && i < dialogues.length; i++) {
      const dialogue = dialogues[i];
      for (const action of dialogue.boardActions) {
        if (action.type === "resetAll") {
          boardStore.clearStones();
          boardStore.resetBoard();
        } else if (action.type === "setBoard") {
          boardStore.setBoard(boardStringToBoardState(action.board));
        } else if (action.type === "place") {
          const globalIndex = findGlobalDialogueIndex(dialogue);
          // oxlint-disable-next-line no-await-in-loop -- 順次石追加のため意図的
          await boardStore.addStones(
            [{ position: action.position, color: action.color }],
            globalIndex,
            { animate: false },
          );
        }
      }
    }
  };

  /**
   * ダイアログのグローバルインデックスを検索
   */
  const findGlobalDialogueIndex = (dialogue: DemoDialogue): number => {
    const index = allDialogues.value.findIndex(
      (m) => m.dialogue.id === dialogue.id,
    );
    return index >= 0 ? index : 0;
  };

  // --- 盤面キャッシュ操作 ---

  /**
   * 盤面スナップショットを保存
   */
  const saveBoardSnapshot = (
    sectionIndex: number,
    dialogueIndex: number,
  ): void => {
    if (!boardCache.value.has(sectionIndex)) {
      boardCache.value.set(sectionIndex, new Map());
    }
    boardCache.value.get(sectionIndex)?.set(dialogueIndex, {
      board: boardStore.board.map((row) => [...row]),
      stones: boardStore.stones.map((s) => ({ ...s })),
    });
  };

  /**
   * 盤面スナップショットを復元
   * @returns 復元成功したかどうか
   */
  const restoreBoardSnapshot = (
    sectionIndex: number,
    dialogueIndex: number,
  ): boolean => {
    const snapshot = boardCache.value.get(sectionIndex)?.get(dialogueIndex);
    if (!snapshot) {
      return false;
    }

    boardStore.setBoard(snapshot.board);
    boardStore.stones.splice(
      0,
      boardStore.stones.length,
      ...snapshot.stones.map((s) => ({ ...s })),
    );
    return true;
  };

  /**
   * 盤面キャッシュをクリア
   */
  const clearBoardCache = (): void => {
    boardCache.value.clear();
  };

  /**
   * 次のセクションへ進む
   */
  const nextSection = async (): Promise<void> => {
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
        boardStore.clearStones();

        // ダイアログがあるセクションなら最初のダイアログを表示
        const section = currentSection.value;
        if (section.type === "demo" || section.type === "problem") {
          const [firstDialogue] = section.dialogues;
          if (firstDialogue) {
            await showDialogueWithAction(firstDialogue, true);

            // 新セクションの初期状態をキャッシュ
            saveBoardSnapshot(
              currentSectionIndex.value,
              currentDialogueIndex.value,
            );
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
    goBack,
  };
};
