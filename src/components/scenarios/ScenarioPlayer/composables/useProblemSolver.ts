import type { CharacterType } from "@/types/character";
import type { Position, BoardState } from "@/types/game";
import type {
  ProblemSection,
  SuccessCondition,
  BoardAction,
} from "@/types/scenario";

import { useBoardStore } from "@/stores/boardStore";
import { useDialogStore } from "@/stores/dialogStore";
import { useProgressStore } from "@/stores/progressStore";

/**
 * 問題セクション固有のロジックを管理するComposable
 *
 * 石の配置、成功条件のチェック、フィードバック表示を担当します。
 */
export const useProblemSolver = (
  scenarioId: string,
  onSectionComplete: () => void,
): {
  handlePlaceStone: (
    position: Position,
    problemSection: ProblemSection,
    isSectionCompleted: boolean,
  ) => void;
  handleCorrectMove: (problemSection: ProblemSection) => void;
  checkAllConditions: (conditions: SuccessCondition[]) => boolean;
  checkSuccessCondition: (
    condition: SuccessCondition,
    board: BoardState,
  ) => boolean;
  showForbiddenFeedback: () => void;
  applyBoardAction: (action: BoardAction) => void;
} => {
  const boardStore = useBoardStore();
  const dialogStore = useDialogStore();
  const progressStore = useProgressStore();

  /**
   * 石を配置し、成功条件をチェック
   */
  const handlePlaceStone = (
    position: Position,
    problemSection: ProblemSection,
    isSectionCompleted: boolean,
  ): void => {
    if (isSectionCompleted) {
      return;
    }

    // すでに石が置かれている場合はスキップ
    if (boardStore.board[position.row][position.col] !== null) {
      console.warn("[handlePlaceStone] Cell already occupied", position);
      return;
    }

    // 問題セクションでは常に黒石を配置
    const newBoard = boardStore.board.map((row) => [...row]);
    newBoard[position.row][position.col] = "black";
    boardStore.setBoard(newBoard);

    console.warn(
      `[handlePlaceStone] Placed black stone at (${position.row}, ${position.col})`,
    );

    // 成功条件をチェック
    if (checkAllConditions(problemSection.successConditions)) {
      handleCorrectMove(problemSection);
    }
  };

  /**
   * 成功時の処理
   */
  const handleCorrectMove = (problemSection: ProblemSection): void => {
    console.warn("[handleCorrectMove] Called");
    onSectionComplete();

    // 正解のフィードバックを表示
    if (problemSection.feedback.success.length > 0) {
      const [msg] = problemSection.feedback.success;
      console.warn("[handleCorrectMove] Showing success feedback:", msg.text);
      dialogStore.showMessage({
        id: `feedback-success-${msg.character}`,
        character: msg.character as CharacterType,
        text: msg.text,
        emotion: msg.emotion,
      });
    }

    // 進度を記録
    progressStore.completeSection(scenarioId, problemSection.id, 100);
  };

  /**
   * 成功条件をチェック
   */
  const checkAllConditions = (conditions: SuccessCondition[]): boolean => {
    const result = conditions.some((condition) =>
      checkSuccessCondition(condition, boardStore.board),
    );
    console.warn(`[checkAllConditions] All conditions check result: ${result}`);
    return result;
  };

  /**
   * 個別の成功条件をチェック
   */
  const checkSuccessCondition = (
    condition: SuccessCondition,
    board: BoardState,
  ): boolean => {
    if (condition.type === "position") {
      const result = condition.positions.some((pos) => {
        const cell = board[pos.row][pos.col];
        const matches = cell === condition.color;
        console.warn(
          `[checkSuccessCondition] pos(${pos.row},${pos.col}): cell=${cell}, expected=${condition.color}, matches=${matches}`,
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

  /**
   * 禁じ手のフィードバック（将来実装用）
   */
  const showForbiddenFeedback = (): void => {
    // 禁じ手のフィードバック（新構造では未実装）
    // 禁じ手の応答はシナリオ拡張時に追加予定
  };

  /**
   * 盤面操作を適用（ダイアログに含まれるアクション）
   */
  const applyBoardAction = (action: BoardAction): void => {
    if (action.type === "place") {
      boardStore.placeStone(action.position, action.color);
    } else if (action.type === "remove") {
      boardStore.removeStone(action.position);
    } else if (action.type === "setBoard") {
      // 別ファイルからboardStringToBoardStateをインポート後使用
      console.warn("[applyBoardAction] setBoard action not fully implemented");
    }
  };

  return {
    handlePlaceStone,
    handleCorrectMove,
    checkAllConditions,
    checkSuccessCondition,
    showForbiddenFeedback,
    applyBoardAction,
  };
};
