import type { SuccessCondition } from "@/types/scenario";

/**
 * successConditionsからプレイヤーの石色を推論する
 *
 * 推論ロジック:
 * - PositionConditionまたはPatternConditionのcolorを使用
 * - SequenceConditionの場合は最初のmoveのcolorを使用
 * - 条件がない場合は"black"をデフォルトとする
 */
export const getPlayerColorFromConditions = (
  conditions: SuccessCondition[],
): "black" | "white" => {
  for (const condition of conditions) {
    if (condition.type === "position" || condition.type === "pattern") {
      return condition.color;
    }
    if (condition.type === "sequence" && condition.moves.length > 0) {
      const [firstMove] = condition.moves;
      if (firstMove) {
        return firstMove.color;
      }
    }
  }
  return "black";
};
