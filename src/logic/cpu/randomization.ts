import type { Position } from "@/types/game";

/**
 * 確率で「最善手」か「ランダム手選択器の結果」を返す。
 *
 * ★1 用の弱体化レイヤ。WASM 探索エンジンには randomFactor 配線がないため、
 * Worker 層でこの関数を挟んで弱体化を実現する。
 *
 * pickRandomMove は呼び出し側で禁手フィルタなどの責務を持つ。
 * null を返した場合は bestMove にフォールバックする。
 */
export interface SelectMoveOptions {
  readonly bestMove: Position;
  readonly bestMoveScore?: number;
  /**
   * |bestMoveScore| >= この閾値ならランダム化をスキップする。
   * 連珠の活三 OPEN_THREE=1000 を基準に 800 程度にすると、
   * 活三以上の脅威がある局面では最善手を選ぶ（脅威を見逃さない）。
   * undefined のときは閾値判定なし（Lv1 = 脅威も見逃しうる）。
   */
  readonly criticalScoreThreshold?: number;
  readonly randomFactor: number;
  readonly pickRandomMove: () => Position | null;
  readonly random?: () => number;
}

export function selectMoveWithRandomization(opts: SelectMoveOptions): Position {
  if (opts.randomFactor <= 0) {
    return opts.bestMove;
  }
  if (
    opts.criticalScoreThreshold !== undefined &&
    opts.bestMoveScore !== undefined &&
    Math.abs(opts.bestMoveScore) >= opts.criticalScoreThreshold
  ) {
    return opts.bestMove;
  }
  const random = opts.random ?? Math.random;
  if (random() >= opts.randomFactor) {
    return opts.bestMove;
  }
  return opts.pickRandomMove() ?? opts.bestMove;
}

/**
 * 中心点から Chebyshev 距離 ≤ radius の位置（中心除く・盤外除く）を列挙する。
 *
 * ★1 のランダム選択を「最善手の近傍」に絞るために使う。
 * 全空き点ランダムだと辺境（O12 など）に飛んで不自然なため。
 */
export function listChebyshevNeighbors(
  center: Position,
  radius: number,
  boardSize = 15,
): Position[] {
  const result: Position[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr === 0 && dc === 0) {
        continue;
      }
      const r = center.row + dr;
      const c = center.col + dc;
      if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) {
        continue;
      }
      result.push({ row: r, col: c });
    }
  }
  return result;
}
