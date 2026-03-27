/**
 * 振り返り評価キューの構築
 */

import { isOpeningMove } from "@/logic/reviewLogic";

/** 評価キューの1項目 */
export interface QueueItem {
  moveIndex: number;
  isLightEval: boolean;
}

/**
 * 棋譜からの評価キュー構築
 *
 * 珠型(最初の3手)をスキップし、プレイヤー手はフル評価、
 * コンピュータ手は軽量評価としてキューに入れる。
 */
export function buildReviewQueue(
  moves: string[],
  playerFirst: boolean,
  analyzeAll?: boolean,
  skipLastMove?: boolean,
): QueueItem[] {
  const lastMoveIndex = moves.length - 1;
  const items: QueueItem[] = [];

  for (let i = 0; i < moves.length; i++) {
    if (isOpeningMove(i)) {
      continue;
    }
    if (skipLastMove && i === lastMoveIndex) {
      continue;
    }
    const isPlayerMove = playerFirst ? i % 2 === 0 : i % 2 === 1;
    const isLightEval = analyzeAll ? false : !isPlayerMove;
    items.push({ moveIndex: i, isLightEval });
  }

  return items;
}

/** ディスパッチキューのソート: フル評価を先、軽量評価を後 */
export function sortReviewQueue(items: { isLightEval: boolean }[]): void {
  items.sort((a, b) => {
    if (a.isLightEval !== b.isLightEval) {
      return a.isLightEval ? 1 : -1;
    }
    return 0;
  });
}
