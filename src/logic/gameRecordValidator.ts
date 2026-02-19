/**
 * 棋譜バリデーション
 *
 * 棋譜文字列を検証し、正規化済み文字列と手数を返す
 */

/** 有効な手の正規表現: A-O列 + 1-15行 */
const MOVE_PATTERN = /^[A-O](1[0-5]|[1-9])$/;

export type GameRecordValidationResult =
  | { valid: true; moveCount: number; normalizedRecord: string }
  | { valid: false; error: string };

/**
 * 棋譜文字列を検証する
 */
export function validateGameRecord(input: string): GameRecordValidationResult {
  const trimmed = input.trim();
  if (trimmed === "") {
    return { valid: false, error: "棋譜が入力されていません" };
  }

  const tokens = trimmed.split(/\s+/).map((t) => t.toUpperCase());
  const seen = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    if (!MOVE_PATTERN.test(token)) {
      return {
        valid: false,
        error: `${i + 1}手目「${token}」が不正です（形式: A1〜O15）`,
      };
    }

    if (seen.has(token)) {
      return {
        valid: false,
        error: `${i + 1}手目「${token}」が重複しています`,
      };
    }
    seen.add(token);
  }

  return {
    valid: true,
    moveCount: tokens.length,
    normalizedRecord: tokens.join(" "),
  };
}
