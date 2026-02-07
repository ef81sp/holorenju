import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

import type {
  Scenario,
  Section,
  DemoDialogue,
  BoardAction,
  LineAction,
  MarkAction,
  PlaceMoveAction,
} from "@/types/scenario";
import type { TextNode } from "@/types/text";

import { boardStringToBoardState } from "@/logic/scenarioFileHandler";
import { parseScenario } from "@/logic/scenarioParser";
import { useAppStore } from "@/stores/appStore";
import {
  useBoardStore,
  type Stone,
  type Mark,
  type Line,
} from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useProgressStore } from "@/stores/progressStore";
import { useScenarioAnimationStore } from "@/stores/scenarioAnimationStore";
import { useScenarioIndexStore } from "@/stores/scenarioIndexStore";
import { assertNever } from "@/utils/assertNever";

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
 * SSoT: stonesをキャッシュし、boardはstonesから導出
 */
interface BoardSnapshot {
  stones: Stone[];
  marks: Mark[];
  lines: Line[];
  descriptionNodes: TextNode[];
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
  showNextSectionButton: ComputedRef<boolean>;
  isScenarioDone: ComputedRef<boolean>;
  canNavigatePrevious: ComputedRef<boolean>;
  canNavigateNext: ComputedRef<boolean>;
  allDialogues: Ref<DialogueMapping[]>;
  demoDescriptionNodes: Ref<TextNode[]>;
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
  const animationStore = useScenarioAnimationStore();

  // State
  const scenario = ref<Scenario | null>(null);
  const currentSectionIndex = ref(0);
  const currentDialogueIndex = ref(0);
  const isSectionCompleted = ref(false);
  const allDialogues = ref<DialogueMapping[]>([]);
  const demoDescriptionNodes = ref<TextNode[]>([]);
  // 盤面キャッシュ: セクションインデックス → ダイアログインデックス → スナップショット
  const boardCache = ref<Map<number, Map<number, BoardSnapshot>>>(new Map());
  // 完了した問題セクションのインデックスを記録
  const completedSectionIndices = ref<Set<number>>(new Set());

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

  // 「次に進む」ボタン表示: 問題セクション完了後、かつ次のセクションがある
  const showNextSectionButton = computed(
    () =>
      currentSection.value?.type === "question" &&
      isSectionCompleted.value &&
      !isLastSection.value,
  );

  // シナリオ完了状態か（= 「シナリオ完了」ボタン表示条件）
  const isScenarioDone = computed(() => {
    if (!isLastSection.value) {
      return false;
    }
    // デモセクション: 最後のダイアログに到達
    if (currentSection.value?.type === "demo") {
      return currentDialogueIndex.value >= allDialogues.value.length - 1;
    }
    // 問題セクション: 正解済み（現在または過去に完了）
    return (
      isSectionCompleted.value ||
      isSectionAlreadyCompleted(currentSectionIndex.value)
    );
  });

  const canNavigatePrevious = computed(() => currentDialogueIndex.value > 0);

  // 完了した問題セクションを記録するヘルパー関数
  const markSectionAsCompleted = (sectionIndex: number): void => {
    completedSectionIndices.value = new Set([
      ...completedSectionIndices.value,
      sectionIndex,
    ]);
  };

  const isSectionAlreadyCompleted = (sectionIndex: number): boolean =>
    completedSectionIndices.value.has(sectionIndex);

  /**
   * 指定セクションから次のセクションへ進行可能かを判定
   * 問題セクションの場合、完了済み（現在または過去に正解済み）でないと進行不可
   */
  const canPassSectionBoundary = (fromSectionIndex: number): boolean => {
    const section = scenario.value?.sections[fromSectionIndex];
    if (section?.type !== "question") {
      return true;
    }
    return (
      isSectionCompleted.value || isSectionAlreadyCompleted(fromSectionIndex)
    );
  };

  // 問題セクション完了時に記録（戻って再度進む場合に許可するため）
  watch(isSectionCompleted, (newValue) => {
    if (newValue) {
      markSectionAsCompleted(currentSectionIndex.value);
    }
  });

  const canNavigateNext = computed(() => {
    if (currentDialogueIndex.value >= allDialogues.value.length - 1) {
      return false;
    }

    const nextMapping = allDialogues.value[currentDialogueIndex.value + 1];
    const currentMapping = allDialogues.value[currentDialogueIndex.value];

    if (!nextMapping || !currentMapping) {
      return false;
    }

    // セクション境界を越える場合、進行可能かチェック
    if (nextMapping.sectionIndex !== currentMapping.sectionIndex) {
      return canPassSectionBoundary(currentMapping.sectionIndex);
    }

    return true;
  });

  /**
   * シナリオを読み込み初期化
   */
  const loadScenario = async (): Promise<void> => {
    try {
      // キャッシュクリア
      clearBoardCache();
      completedSectionIndices.value = new Set();

      // Index.jsonからシナリオパスを取得
      const indexStore = useScenarioIndexStore();
      await indexStore.loadIndex();
      const scenarioPath = indexStore.findScenarioPath(scenarioId);

      if (!scenarioPath) {
        throw new Error(`Scenario not found: ${scenarioId}`);
      }

      // fetch を使用してシナリオを読み込む
      // 開発環境のみキャッシュバスティング（ホットリロード対応）
      const scenarioUrl = import.meta.env.DEV
        ? `/scenarios/${scenarioPath}?t=${Date.now()}`
        : `/scenarios/${scenarioPath}`;
      const scenarioRes = await fetch(scenarioUrl);
      if (!scenarioRes.ok) {
        throw new Error(`HTTP error: ${scenarioRes.status}`);
      }
      const rawScenarioData = await scenarioRes.json();
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
        if (!section) {
          continue;
        }
        for (
          let dialogueIndex = 0;
          dialogueIndex < section.dialogues.length;
          dialogueIndex++
        ) {
          const dialogue = section.dialogues[dialogueIndex];
          if (dialogue) {
            dialogueMappings.push({
              dialogue,
              sectionIndex,
              sectionDialogueIndex: dialogueIndex,
            });
          }
        }
      }
      allDialogues.value = dialogueMappings;

      progressStore.startScenario(scenarioId);

      // 初期盤面をセット（SSoT: setBoard が stones を設定するので clearStones は不要）
      if (currentSection.value) {
        const boardState = boardStringToBoardState(
          currentSection.value.initialBoard,
        );
        animationStore.cancelOngoingAnimations();
        boardStore.setBoard(boardState, "initial");
        boardStore.clearMarks();
        boardStore.clearLines();
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
    if (!mapping) {
      return;
    }
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
    animationStore.cancelOngoingAnimations();

    if (currentDialogueIndex.value < allDialogues.value.length - 1) {
      const nextIndex = currentDialogueIndex.value + 1;
      const nextMapping = allDialogues.value[nextIndex];
      const currentMapping = allDialogues.value[currentDialogueIndex.value];

      if (!nextMapping || !currentMapping) {
        return;
      }

      // セクション境界を越える場合のチェック
      if (nextMapping.sectionIndex !== currentMapping.sectionIndex) {
        if (!canPassSectionBoundary(currentMapping.sectionIndex)) {
          return; // 進行をブロック
        }
      }

      currentDialogueIndex.value = nextIndex;
      const mapping = nextMapping;
      const prevMapping = currentMapping;

      // セクションが変わった場合
      if (mapping.sectionIndex !== prevMapping.sectionIndex) {
        const newSection = scenario.value?.sections[mapping.sectionIndex];
        if (newSection) {
          const boardState = boardStringToBoardState(newSection.initialBoard);
          animationStore.cancelOngoingAnimations();
          boardStore.setBoard(boardState, "initial");
          boardStore.clearMarks();
          boardStore.clearLines();
          demoDescriptionNodes.value = [];
          currentSectionIndex.value = mapping.sectionIndex;
          isSectionCompleted.value = false;

          // 新しいセクション内の前のダイアログまでのアクションを適用（アニメーションなし）
          applyActionsUntilDialogueIndex(
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

    if (!mapping || !currentMapping) {
      return;
    }

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
      animationStore.cancelOngoingAnimations();
      boardStore.setBoard(boardState, "initial");
      boardStore.clearMarks();
      boardStore.clearLines();

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
   * ダイアログの説明を更新
   * - description がなければ前の状態を維持
   * - text があれば新規表示
   * - text が空で clear: true ならクリア
   */
  const updateDescriptionForDialogue = (dialogue: DemoDialogue): void => {
    if (!dialogue.description) {
      // undefinedなら前の状態を維持（何もしない）
      return;
    }

    const { text, clear } = dialogue.description;

    if (text.length > 0) {
      // テキストがあれば新規表示
      demoDescriptionNodes.value = [...text];
    } else if (clear) {
      // テキストなし + clear: true → クリア
      demoDescriptionNodes.value = [];
    }
    // テキストなし + clear なし → 前の状態を維持（何もしない）
  };

  // ===== アクショングループ化ヘルパー =====

  type ActionGroupType =
    | "place"
    | "mark-draw"
    | "mark-remove"
    | "line-draw"
    | "immediate";

  type ActionGroup =
    | { type: "place"; actions: PlaceMoveAction[] }
    | { type: "mark-draw"; actions: MarkAction[] }
    | { type: "mark-remove"; actions: MarkAction[] }
    | { type: "line-draw"; actions: LineAction[] }
    | { type: "immediate"; actions: BoardAction[] };

  const getActionGroupType = (action: BoardAction): ActionGroupType => {
    switch (action.type) {
      case "place":
        return "place";
      case "mark":
        return action.action === "remove" ? "mark-remove" : "mark-draw";
      case "line":
        return action.action === "draw" ? "line-draw" : "immediate";
      default:
        return "immediate"; // resetAll, resetMarkLine, setBoard, remove
    }
  };

  const groupActionsByConsecutiveType = (
    actions: BoardAction[],
  ): ActionGroup[] => {
    const groups: ActionGroup[] = [];
    for (const action of actions) {
      const groupType = getActionGroupType(action);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.type === groupType) {
        (lastGroup.actions as BoardAction[]).push(action);
      } else {
        groups.push({ type: groupType, actions: [action] } as ActionGroup);
      }
    }
    return groups;
  };

  /**
   * ダイアログを表示して石・マーク・ラインを追加
   * アクションはJSON配列の順序通りに実行される（同一タイプの連続はグループ化）
   */
  const showDialogueWithAction = async (
    dialogue: DemoDialogue,
    animate: boolean,
  ): Promise<void> => {
    showDialogueMessage(dialogue);
    updateDescriptionForDialogue(dialogue);

    const actionGroups = groupActionsByConsecutiveType(dialogue.boardActions);
    let markCounter = 0;
    let lineCounter = 0;

    /* eslint-disable no-await-in-loop -- アニメーションを順序通りに実行するために意図的 */
    for (const group of actionGroups) {
      switch (group.type) {
        case "place": {
          const placeActions = group.actions;
          // アニメーション対象のIDを先行登録（描画時に半透明になるように）
          if (animate) {
            const stoneIds = placeActions.map(
              (a) =>
                `${currentDialogueIndex.value}-${a.position.row}-${a.position.col}`,
            );
            animationStore.prepareForAnimation(stoneIds);
          }

          const addedStones = boardStore.addStones(
            placeActions.map((a) => ({
              position: a.position,
              color: a.color,
            })),
            currentDialogueIndex.value,
          );
          await animationStore.animateStones(addedStones, { animate });
          break;
        }

        case "mark-remove": {
          const markRemoveActions = group.actions;
          boardStore.removeMarks(
            markRemoveActions.map((a) => ({
              positions: a.positions,
              markType: a.markType,
            })),
          );
          break;
        }

        case "mark-draw": {
          const markDrawActions = group.actions;
          const startIndex = markCounter;
          markCounter += markDrawActions.length;

          // アニメーション対象のIDを先行登録（描画時に半透明になるように）
          if (animate) {
            const markIds = markDrawActions.map(
              (_, i) => `${currentDialogueIndex.value}-mark-${startIndex + i}`,
            );
            animationStore.prepareForAnimation(markIds);
          }

          const addedMarks = boardStore.addMarks(
            markDrawActions.map((a) => ({
              positions: a.positions,
              markType: a.markType,
              label: a.label,
            })),
            currentDialogueIndex.value,
            startIndex,
          );
          await animationStore.animateMarks(addedMarks, { animate });
          break;
        }

        case "line-draw": {
          const lineDrawActions = group.actions;
          const startIndex = lineCounter;
          lineCounter += lineDrawActions.length;

          // アニメーション対象のIDを先行登録（描画時に半透明になるように）
          if (animate) {
            const lineIds = lineDrawActions.map(
              (_, i) => `${currentDialogueIndex.value}-line-${startIndex + i}`,
            );
            animationStore.prepareForAnimation(lineIds);
          }

          const addedLines = boardStore.addLines(
            lineDrawActions.map((a) => ({
              fromPosition: a.fromPosition,
              toPosition: a.toPosition,
              style: a.style,
            })),
            currentDialogueIndex.value,
            startIndex,
          );
          await animationStore.animateLines(addedLines, { animate });
          break;
        }

        case "immediate":
          applyImmediateActions(group.actions);
          break;

        default:
          break;
      }
    }
    /* eslint-enable no-await-in-loop */
  };

  /**
   * 即時実行アクション（resetAll, resetMarkLine, setBoard, remove, line remove）を適用
   */
  const applyImmediateActions = (actions: BoardAction[]): void => {
    for (const action of actions) {
      switch (action.type) {
        case "resetAll":
          boardStore.resetAll();
          break;
        case "resetMarkLine":
          boardStore.resetMarkLine();
          break;
        case "setBoard":
          boardStore.setBoard(
            boardStringToBoardState(action.board),
            currentDialogueIndex.value,
          );
          boardStore.clearMarks();
          break;
        case "remove":
          boardStore.removeStone(action.position);
          break;
        case "line":
          // line remove はここで処理（line draw は別グループで処理済み）
          if (action.action === "remove") {
            boardStore.removeLine(action.fromPosition, action.toPosition);
          }
          break;
        default:
          // place, mark は別グループで処理済み
          break;
      }
    }
  };

  /**
   * 指定インデックスまでのダイアログのアクションを適用（アニメーションなし）
   * resetAll, setBoard, place, remove, mark, line を順次処理
   */
  const applyActionsUntilDialogueIndex = (
    dialogues: DemoDialogue[],
    untilIndex: number,
  ): void => {
    for (let i = 0; i < untilIndex && i < dialogues.length; i++) {
      const dialogue = dialogues[i];
      if (!dialogue) {
        continue;
      }
      const globalIndex = findGlobalDialogueIndex(dialogue);

      for (const action of dialogue.boardActions) {
        applyBoardAction(action, globalIndex);
      }
    }
  };

  /**
   * 単一の盤面アクションを適用（アニメーションなし）
   */
  const applyBoardAction = (
    action: BoardAction,
    dialogueIndex: number,
  ): void => {
    switch (action.type) {
      case "resetAll":
        boardStore.resetAll();
        break;
      case "resetMarkLine":
        boardStore.resetMarkLine();
        break;
      case "setBoard":
        boardStore.setBoard(
          boardStringToBoardState(action.board),
          dialogueIndex,
        );
        boardStore.clearMarks();
        break;
      case "place":
        boardStore.addStones(
          [{ position: action.position, color: action.color }],
          dialogueIndex,
        );
        break;
      case "remove":
        boardStore.removeStone(action.position);
        break;
      case "mark":
        if (action.action === "remove") {
          boardStore.removeMarks([
            {
              positions: action.positions,
              markType: action.markType,
            },
          ]);
        } else {
          // draw または undefined（デフォルト）
          boardStore.addMarks(
            [
              {
                positions: action.positions,
                markType: action.markType,
                label: action.label,
              },
            ],
            dialogueIndex,
          );
        }
        break;
      case "line":
        if (action.action === "draw") {
          boardStore.addLines(
            [
              {
                fromPosition: action.fromPosition,
                toPosition: action.toPosition,
                style: action.style,
              },
            ],
            dialogueIndex,
          );
        }
        // action === "remove" の場合、現状ではサポートなし
        break;
      default:
        assertNever(action);
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
      stones: boardStore.stones.map((s) => ({ ...s })),
      marks: boardStore.marks.map((m) => ({
        ...m,
        positions: [...m.positions],
      })),
      lines: boardStore.lines.map((l) => ({ ...l })),
      descriptionNodes: [...demoDescriptionNodes.value],
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

    // SSoT: stones を直接復元（board は stones から自動計算される）
    boardStore.stones.splice(
      0,
      boardStore.stones.length,
      ...snapshot.stones.map((s) => ({ ...s })),
    );
    boardStore.marks.splice(
      0,
      boardStore.marks.length,
      ...snapshot.marks.map((m) => ({ ...m, positions: [...m.positions] })),
    );
    boardStore.lines.splice(
      0,
      boardStore.lines.length,
      ...snapshot.lines.map((l) => ({ ...l })),
    );
    demoDescriptionNodes.value = [...snapshot.descriptionNodes];
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
   * nextDialogueがセクション境界を越える処理を持っているので委譲する
   */
  const nextSection = async (): Promise<void> => {
    if (!showNextSectionButton.value) {
      return;
    }
    await nextDialogue();
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
    demoDescriptionNodes,
    // Computed
    currentSection,
    showNextSectionButton,
    isScenarioDone,
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
