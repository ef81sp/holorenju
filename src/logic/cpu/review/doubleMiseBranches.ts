/**
 * 両ミセの分岐情報構築
 *
 * review.worker.ts から SRP 切り出し。
 */

import type { BoardState, Position } from "@/types/game";
import type { ForcedWinDefense, ForcedWinNode } from "@/types/review";

// #37 P3 PR5: 四三判定を Zig 単一ソース(evaluate.createsFourThree)経由に（合法局面で TS と一致、未ロード時 TS フォールバック）。
import { createsFourThree } from "../wasm/threatAdapter";

/**
 * 両ミセの詰み木を構築（#22）
 *
 * root = bestMove。各防御 targets[i] に対し:
 * - i=0（主筋）: opponent が targets[0] を防御 → self が targets[1] で四三完成（終端）
 * - i>=1: opponent が targets[i] を防御 → self が surviving target で四三完成（終端）
 *
 * defenses[0] 連鎖 = [bestMove, targets[0], targets[1]]（最善タブの既定経路）。
 */
export function buildDoubleMiseTree(
  board: BoardState,
  bestMove: Position,
  color: "black" | "white",
  opponentColor: "black" | "white",
  targets: Position[],
): ForcedWinNode | null {
  const bmRow = board[bestMove.row];
  const [main, mainWin] = targets;
  if (!bmRow || !main || !mainWin) {
    return null;
  }

  bmRow[bestMove.col] = color;

  const defenses: ForcedWinDefense[] = [
    // 主筋: targets[0] を受け → targets[1] で完成
    { defenderMove: main, next: { attackerMove: mainWin, defenses: [] } },
  ];

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
      defenses.push({
        defenderMove: defense,
        next: { attackerMove: surviving, defenses: [] },
      });
    }
  }

  bmRow[bestMove.col] = null;
  return { attackerMove: bestMove, defenses };
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
