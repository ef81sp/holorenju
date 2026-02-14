import { describe, expect, it } from "vitest";

import type { EmotionId } from "./character";

import {
  CHARACTER_DISPLAY_NAMES,
  EMOTION_LABELS,
  getEmotionAltText,
} from "./character";

describe("EMOTION_LABELS", () => {
  it("全40個の表情ラベルが定義されている", () => {
    const ids = Array.from({ length: 40 }, (_, i) => i as EmotionId);
    for (const id of ids) {
      expect(EMOTION_LABELS[id]).toBeDefined();
      expect(EMOTION_LABELS[id].length).toBeGreaterThan(0);
    }
  });
});

describe("getEmotionAltText", () => {
  it("fubuki の場合「フブキ ラベル」を返す", () => {
    expect(getEmotionAltText("fubuki", 0)).toBe("フブキ にっこり");
  });

  it("miko の場合「みこ ラベル」を返す", () => {
    expect(getEmotionAltText("miko", 1)).toBe("みこ にっこりお話");
  });

  it("narration の場合は空文字を返す", () => {
    expect(getEmotionAltText("narration", 0)).toBe("");
  });

  it("CHARACTER_DISPLAY_NAMES が正しい", () => {
    expect(CHARACTER_DISPLAY_NAMES.fubuki).toBe("フブキ");
    expect(CHARACTER_DISPLAY_NAMES.miko).toBe("みこ");
  });
});
