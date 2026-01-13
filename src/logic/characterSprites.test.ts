import { describe, expect, it } from "vitest";

import { getCharacterSpriteUrl } from "./characterSprites";

describe("characterSprites", () => {
  describe("getCharacterSpriteUrl", () => {
    describe("fubuki", () => {
      it("imageSet 1でURLを生成", () => {
        const url = getCharacterSpriteUrl("fubuki", 1);

        expect(url).toContain("Holoface01-shirakamifubuki-01.png");
      });

      it("imageSet 2でURLを生成", () => {
        const url = getCharacterSpriteUrl("fubuki", 2);

        expect(url).toContain("Holoface01-shirakamifubuki-02.png");
      });

      it("imageSet 3でURLを生成", () => {
        const url = getCharacterSpriteUrl("fubuki", 3);

        expect(url).toContain("Holoface01-shirakamifubuki-03.png");
      });

      it("imageSet 4でURLを生成", () => {
        const url = getCharacterSpriteUrl("fubuki", 4);

        expect(url).toContain("Holoface01-shirakamifubuki-04.png");
      });

      it("imageSet 5でURLを生成", () => {
        const url = getCharacterSpriteUrl("fubuki", 5);

        expect(url).toContain("Holoface01-shirakamifubuki-05.png");
      });
    });

    describe("miko", () => {
      it("imageSet 1でURLを生成", () => {
        const url = getCharacterSpriteUrl("miko", 1);

        expect(url).toContain("Holoface00-sakramiko-01.png");
      });

      it("imageSet 2でURLを生成", () => {
        const url = getCharacterSpriteUrl("miko", 2);

        expect(url).toContain("Holoface00-sakramiko-02.png");
      });

      it("imageSet 3でURLを生成", () => {
        const url = getCharacterSpriteUrl("miko", 3);

        expect(url).toContain("Holoface00-sakramiko-03.png");
      });

      it("imageSet 4でURLを生成", () => {
        const url = getCharacterSpriteUrl("miko", 4);

        expect(url).toContain("Holoface00-sakramiko-04.png");
      });

      it("imageSet 5でURLを生成", () => {
        const url = getCharacterSpriteUrl("miko", 5);

        expect(url).toContain("Holoface00-sakramiko-05.png");
      });
    });
  });

  describe("メモ化", () => {
    it("同一引数で同一参照を返す", () => {
      const url1 = getCharacterSpriteUrl("fubuki", 1);
      const url2 = getCharacterSpriteUrl("fubuki", 1);

      expect(url1).toBe(url2);
    });

    it("異なるキャラクターで異なるURLを返す", () => {
      const fubukiUrl = getCharacterSpriteUrl("fubuki", 1);
      const mikoUrl = getCharacterSpriteUrl("miko", 1);

      expect(fubukiUrl).not.toBe(mikoUrl);
      expect(fubukiUrl).toContain("shirakamifubuki");
      expect(mikoUrl).toContain("sakramiko");
    });

    it("異なるimageSetで異なるURLを返す", () => {
      const url1 = getCharacterSpriteUrl("fubuki", 1);
      const url2 = getCharacterSpriteUrl("fubuki", 2);

      expect(url1).not.toBe(url2);
      expect(url1).toContain("-01.png");
      expect(url2).toContain("-02.png");
    });

    it("複数回呼び出しても一貫した結果を返す", () => {
      const results: string[] = [];

      for (let i = 0; i < 5; i++) {
        results.push(getCharacterSpriteUrl("fubuki", 3));
      }

      // 全て同じ参照であることを確認
      expect(results.every((r) => r === results[0])).toBe(true);
    });
  });

  describe("URL形式", () => {
    it("有効なURL形式を返す", () => {
      const url = getCharacterSpriteUrl("fubuki", 1);

      // URLとして解釈可能であることを確認
      expect(() => new URL(url)).not.toThrow();
    });

    it("assetsパスを含む", () => {
      const url = getCharacterSpriteUrl("miko", 2);

      // Viteのアセット解決により、パスに characters が含まれる
      expect(url).toMatch(/characters.*Holoface/);
    });
  });
});
