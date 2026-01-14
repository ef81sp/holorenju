import type { BoardState } from "@/types/game";
import type { SuccessCondition, SuccessOperator } from "@/types/scenario";

export const evaluateCondition = (
  condition: SuccessCondition,
  board: BoardState,
  operator: SuccessOperator = "or",
): boolean => {
  if (condition.type === "position") {
    const matcher = operator === "and" ? "every" : "some";
    return condition.positions[matcher]((pos) => {
      const cell = board[pos.row]?.[pos.col];
      return cell === condition.color;
    });
  }

  if (condition.type === "pattern") {
    // パターン判定は未実装
    return false;
  }

  if (condition.type === "sequence") {
    // シーケンス判定は未実装
    return false;
  }

  return false;
};

export const evaluateAllConditions = (
  conditions: SuccessCondition[],
  board: BoardState,
  operator: SuccessOperator = "or",
): boolean => {
  const predicate = (condition: SuccessCondition): boolean =>
    evaluateCondition(condition, board, operator);

  return operator === "and"
    ? conditions.every(predicate)
    : conditions.some(predicate);
};
