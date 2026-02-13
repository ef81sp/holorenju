/**
 * シナリオパーサー・バリデーター
 *
 * 2段階のバリデーション機能：
 * 1. parseScenario: JSON/オブジェクトをScenario型にパースする（実行時用）
 * 2. validateBoardState: 盤面の妥当性を検証する（JSON編集時用）
 */

export { parseScenario } from "./parseScenario";
export { validateBoardState } from "./validateBoardState";
export { DEFAULT_FEEDBACK } from "./parserUtils";
