import type { CharacterType } from "@/types/character";

/**
 * キャラクタースプライトシート管理ロジック
 */

/**
 * キャラクターのスプライトシート画像URLを取得（メモ化）
 * 初回呼び出し時にURLを生成してキャッシュに保存
 * 以降の呼び出しはキャッシュから即座に返却
 *
 * @param character - キャラクター種（'fubuki' | 'miko'）
 * @param imageSet - 画像セット番号（1-5）
 * @returns スプライトシート画像のURL
 */
export const getCharacterSpriteUrl = (() => {
  const cache: Record<string, string> = {};

  return (character: CharacterType, imageSet: 1 | 2 | 3 | 4 | 5): string => {
    const key = `${character}-${imageSet}`;

    // キャッシュに存在しない場合のみURLを生成
    if (!cache[key]) {
      const charName = character === "fubuki" ? "shirakamifubuki" : "sakramiko";
      const charId = character === "fubuki" ? "01" : "00";
      const filename = `Holoface${charId}-${charName}-${String(imageSet).padStart(2, "0")}.png`;

      cache[key] = new URL(
        `../assets/characters/${filename}`,
        import.meta.url,
      ).href;
    }

    return cache[key];
  };
})();
