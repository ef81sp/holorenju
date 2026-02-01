import type { CharacterType } from "@/types/character";
import type { Position, BoardState } from "@/types/game";
import type {
  QuestionSection,
  SuccessCondition,
  SuccessOperator,
} from "@/types/scenario";

import { useBoardStore, cloneBoard } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useProgressStore } from "@/stores/progressStore";
import { getPlayerColorFromConditions } from "@/utils/conditionUtils";

import { evaluateAllConditions, evaluateCondition } from "./problemConditions";

/**
 * 問題セクション固有のロジックを管理するComposable
 *
 * 石の配置、成功条件のチェック、フィードバック表示を担当します。
 */
export const useQuestionSolver = (
  scenarioId: string,
  onSectionComplete: () => void,
  onShowCorrectCutin?: () => void,
  onShowIncorrectCutin?: () => void,
): {
  handlePlaceStone: (
    position: Position,
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ) => void;
  submitAnswer: (
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ) => void;
  handleCorrectMove: (questionSection: QuestionSection) => void;
  checkAllConditions: (
    conditions: SuccessCondition[],
    operator?: SuccessOperator,
  ) => boolean;
  checkSuccessCondition: (
    condition: SuccessCondition,
    board: BoardState,
    operator?: SuccessOperator,
  ) => boolean;
  showForbiddenFeedback: () => void;
} => {
  const boardStore = useBoardStore();
  const dialogStore = useDialogStore();
  const progressStore = useProgressStore();

  let attemptBaseBoard: BoardState | null = null;

  const ensureAttemptBaseBoard = (): void => {
    if (!attemptBaseBoard) {
      attemptBaseBoard = cloneBoard(boardStore.board);
    }
  };

  const resetAttemptBaseBoard = (): void => {
    attemptBaseBoard = null;
  };

  const restoreAttemptBoard = (): void => {
    if (attemptBaseBoard) {
      boardStore.setBoard(cloneBoard(attemptBaseBoard), "question");
    }
  };

  const handleIncorrectMove = (questionSection: QuestionSection): void => {
    console.warn("[handleIncorrectMove] Called");
    restoreAttemptBoard();
    resetAttemptBaseBoard();

    // ×カットインを表示
    onShowIncorrectCutin?.();

    const [msg] = questionSection.feedback.failure || [];
    if (msg) {
      dialogStore.showMessage({
        id: `feedback-failure-${msg.character}`,
        character: msg.character as CharacterType,
        text: msg.text,
        emotion: msg.emotion,
      });
    }
  };

  /**
   * 石を配置し、成功条件をチェック
   */
  const handlePlaceStone = (
    position: Position,
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ): void => {
    if (isSectionCompleted) {
      return;
    }

    // すでに石が置かれている場合はスキップ
    if (boardStore.board[position.row]?.[position.col] !== null) {
      console.warn("[handlePlaceStone] Cell already occupied", position);
      return;
    }

    ensureAttemptBaseBoard();

    // successConditionsから石色を推論
    const playerColor = getPlayerColorFromConditions(
      questionSection.successConditions,
    );
    const newBoard = cloneBoard(boardStore.board);
    const row = newBoard[position.row];
    if (row) {
      row[position.col] = playerColor;
    }
    boardStore.setBoard(newBoard, "question");

    console.warn(
      `[handlePlaceStone] Placed ${playerColor} stone at (${position.row}, ${position.col})`,
    );

    // 成功条件をチェック
    const operator = questionSection.successOperator ?? "or";
    if (operator === "or") {
      if (checkAllConditions(questionSection.successConditions, operator)) {
        resetAttemptBaseBoard();
        handleCorrectMove(questionSection);
      } else {
        handleIncorrectMove(questionSection);
      }
    }
  };

  /**
   * 回答ボタンからの判定（AND想定）
   */
  const submitAnswer = (
    questionSection: QuestionSection,
    isSectionCompleted: boolean,
  ): void => {
    if (isSectionCompleted) {
      return;
    }

    const operator = questionSection.successOperator ?? "or";
    ensureAttemptBaseBoard();

    if (checkAllConditions(questionSection.successConditions, operator)) {
      resetAttemptBaseBoard();
      handleCorrectMove(questionSection);
    } else {
      handleIncorrectMove(questionSection);
    }
  };

  /**
   * 成功時の処理
   */
  const handleCorrectMove = (questionSection: QuestionSection): void => {
    console.warn("[handleCorrectMove] Called");
    onSectionComplete();

    // ○カットインを表示
    onShowCorrectCutin?.();

    // 正解のフィードバックを表示
    if (questionSection.feedback.success.length > 0) {
      const [msg] = questionSection.feedback.success;
      if (msg) {
        console.warn("[handleCorrectMove] Showing success feedback:", msg.text);
        dialogStore.showMessage({
          id: `feedback-success-${msg.character}`,
          character: msg.character as CharacterType,
          text: msg.text,
          emotion: msg.emotion,
        });
      }
    }

    // 進度を記録
    progressStore.completeSection(scenarioId, questionSection.id, 100);
  };

  /**
   * 成功条件をチェック
   */
  const checkAllConditions = (
    conditions: SuccessCondition[],
    operator: SuccessOperator = "or",
  ): boolean => {
    const result = evaluateAllConditions(
      conditions,
      boardStore.board,
      operator,
    );
    console.warn(
      `[checkAllConditions] All conditions check result: ${result} (operator=${operator})`,
    );
    return result;
  };

  /**
   * 個別の成功条件をチェック
   */
  const checkSuccessCondition = (
    condition: SuccessCondition,
    board: BoardState,
    operator: SuccessOperator = "or",
  ): boolean => evaluateCondition(condition, board, operator);

  /**
   * 禁じ手のフィードバック（将来実装用）
   */
  const showForbiddenFeedback = (): void => {
    // 禁じ手のフィードバック（新構造では未実装）
    // 禁じ手の応答はシナリオ拡張時に追加予定
  };

  return {
    handlePlaceStone,
    submitAnswer,
    handleCorrectMove,
    checkAllConditions,
    checkSuccessCondition,
    showForbiddenFeedback,
  };
};
