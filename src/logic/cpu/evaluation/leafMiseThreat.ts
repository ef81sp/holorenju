/**
 * 末端ミセ手脅威検出
 *
 * 末端評価（evaluateBoard）で「ミセ手（四三点が生まれる手）の機会が
 * 存在するか」を推定する。evaluatePosition の isMiseMove() に対応する
 * 末端版で、手オーダリング評価とのスコアギャップを解消する。
 *
 * 全空き点スキャンは末端評価には重すぎるため、既存の evaluateBoard の
 * パターンスコア結果（fourScore, openThreeScore）を利用して推定する。
 * 追加コストはほぼゼロ。
 */

/**
 * 既存パターンスコアからミセ手機会を推定
 *
 * 四のスコアと活三のスコアが両方存在する場合、次手で四三が成立しうる
 * （=ミセ手の機会がある）と推定する。
 *
 * 既に四三が成立している場合は呼び出し元で除外される前提
 * （scanFourThreeThreat で検出済みなら LEAF_FOUR_THREE_THREAT が適用されるため）。
 *
 * 偽陽性: 四と活三が同一方向・同一石に集中している場合は
 * ミセ手にならない可能性があるが、末端のヒューリスティックとして許容。
 *
 * @param fourScore 自色の四スコア合計
 * @param openThreeScore 自色の活三スコア合計
 * @returns ミセ手機会があれば true
 */
export function estimateMiseOpportunity(
  fourScore: number,
  openThreeScore: number,
): boolean {
  return fourScore > 0 && openThreeScore > 0;
}
