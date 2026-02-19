import type { BoardState } from "@/types/game";
import type { SuccessCondition, SuccessOperator } from "@/types/scenario";

export const evaluateCondition = (
  condition: SuccessCondition,
  board: BoardState,
  operator: SuccessOperator = "or",
): boolean => {
  switch (condition.type) {
    case "position": {
      const matcher = operator === "and" ? "every" : "some";
      return condition.positions[matcher]((pos) => {
        const cell = board[pos.row]?.[pos.col];
        return cell === condition.color;
      });
    }
    case "pattern":
      // パターン判定は未実装
      return false;
    case "sequence":
      // シーケンス判定は未実装
      return false;
    case "vcf":
    case "vct":
      // VCF/VCTは静的条件チェックではない（専用ソルバーが処理する）
      return false;
    default:
      return false;
  }
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
