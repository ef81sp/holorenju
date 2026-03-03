/**
 * 両ミセの分岐情報構築
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinBranch } from "@/types/review";

import { createsFourThree } from "../evaluation/winningPatterns";

/**
 * 両ミセの分岐情報を構築
 *
 * Main PV: [bestMove, targets[0], targets[1]]
 * 各分岐: opponent が targets[i] (i>=1) を防御 → self が surviving target で四三完成
 */
export function buildDoubleMiseBranches(
  board: BoardState,
  bestMove: Position,
  color: "black" | "white",
  opponentColor: "black" | "white",
  targets: Position[],
): ForcedWinBranch[] | undefined {
  const bmRow = board[bestMove.row];
  if (!bmRow) {
    return undefined;
  }

  bmRow[bestMove.col] = color;
  const branches: ForcedWinBranch[] = [];

  for (let i = 1; i < targets.length; i++) {
    const defense = targets[i];
    if (!defense) {
      continue;
    }
    const surviving = findSurvivingTarget(
      board,
      defense,
      i,
      targets,
      color,
      opponentColor,
    );
    if (surviving) {
      branches.push({
        defenseIndex: 1,
        defenseMove: defense,
        continuation: [surviving],
      });
    }
  }

  bmRow[bestMove.col] = null;
  return branches.length > 0 ? branches : undefined;
}

/**
 * 防御手を仮配置し、残りのターゲットで四三が成立するものを探す
 */
function findSurvivingTarget(
  board: BoardState,
  defense: Position,
  defenseIdx: number,
  targets: Position[],
  color: "black" | "white",
  opponentColor: "black" | "white",
): Position | undefined {
  const defRow = board[defense.row];
  if (!defRow) {
    return undefined;
  }

  defRow[defense.col] = opponentColor;

  let result: Position | undefined = undefined;
  for (let j = 0; j < targets.length; j++) {
    if (j === defenseIdx) {
      continue;
    }
    const target = targets[j];
    if (target && createsFourThree(board, target.row, target.col, color)) {
      result = target;
      break;
    }
  }

  defRow[defense.col] = null;
  return result;
}
