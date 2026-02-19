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
    switch (condition.type) {
      case "position":
      case "pattern":
      case "vcf":
      case "vct":
        return condition.color;
      case "sequence":
        if (condition.moves.length > 0) {
          const [firstMove] = condition.moves;
          if (firstMove) {
            return firstMove.color;
          }
        }
        break;
      default:
        break;
    }
  }
  return "black";
};
