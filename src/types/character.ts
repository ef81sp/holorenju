/**
 * キャラクター関連の型定義
 */

import type { TextNode } from "./text";

// キャラクターの種類
type CharacterType = "fubuki" | "miko" | "narration";

// 表情ID: 0-39の連番
// 画像セット1の表情 0-7、画像セット2の表情 8-15、...、画像セット5の表情 32-39
type EmotionId =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27
  | 28
  | 29
  | 30
  | 31
  | 32
  | 33
  | 34
  | 35
  | 36
  | 37
  | 38
  | 39;

// 表情座標情報（事前計算した定数）
interface EmotionCoord {
  imageSet: 1 | 2 | 3 | 4 | 5;
  spriteIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  x: string; // Background-position x座標
  y: string; // Background-position y座標
}

// 40個全表情の座標定数テーブル
const EMOTION_COORDS = {
  0: { imageSet: 1, spriteIndex: 0, x: "0px", y: "0px" },
  1: { imageSet: 1, spriteIndex: 1, x: "-144px", y: "0px" },
  2: { imageSet: 1, spriteIndex: 2, x: "-288px", y: "0px" },
  3: { imageSet: 1, spriteIndex: 3, x: "-432px", y: "0px" },
  4: { imageSet: 1, spriteIndex: 4, x: "0px", y: "-144px" },
  5: { imageSet: 1, spriteIndex: 5, x: "-144px", y: "-144px" },
  6: { imageSet: 1, spriteIndex: 6, x: "-288px", y: "-144px" },
  7: { imageSet: 1, spriteIndex: 7, x: "-432px", y: "-144px" },
  8: { imageSet: 2, spriteIndex: 0, x: "0px", y: "0px" },
  9: { imageSet: 2, spriteIndex: 1, x: "-144px", y: "0px" },
  10: { imageSet: 2, spriteIndex: 2, x: "-288px", y: "0px" },
  11: { imageSet: 2, spriteIndex: 3, x: "-432px", y: "0px" },
  12: { imageSet: 2, spriteIndex: 4, x: "0px", y: "-144px" },
  13: { imageSet: 2, spriteIndex: 5, x: "-144px", y: "-144px" },
  14: { imageSet: 2, spriteIndex: 6, x: "-288px", y: "-144px" },
  15: { imageSet: 2, spriteIndex: 7, x: "-432px", y: "-144px" },
  16: { imageSet: 3, spriteIndex: 0, x: "0px", y: "0px" },
  17: { imageSet: 3, spriteIndex: 1, x: "-144px", y: "0px" },
  18: { imageSet: 3, spriteIndex: 2, x: "-288px", y: "0px" },
  19: { imageSet: 3, spriteIndex: 3, x: "-432px", y: "0px" },
  20: { imageSet: 3, spriteIndex: 4, x: "0px", y: "-144px" },
  21: { imageSet: 3, spriteIndex: 5, x: "-144px", y: "-144px" },
  22: { imageSet: 3, spriteIndex: 6, x: "-288px", y: "-144px" },
  23: { imageSet: 3, spriteIndex: 7, x: "-432px", y: "-144px" },
  24: { imageSet: 4, spriteIndex: 0, x: "0px", y: "0px" },
  25: { imageSet: 4, spriteIndex: 1, x: "-144px", y: "0px" },
  26: { imageSet: 4, spriteIndex: 2, x: "-288px", y: "0px" },
  27: { imageSet: 4, spriteIndex: 3, x: "-432px", y: "0px" },
  28: { imageSet: 4, spriteIndex: 4, x: "0px", y: "-144px" },
  29: { imageSet: 4, spriteIndex: 5, x: "-144px", y: "-144px" },
  30: { imageSet: 4, spriteIndex: 6, x: "-288px", y: "-144px" },
  31: { imageSet: 4, spriteIndex: 7, x: "-432px", y: "-144px" },
  32: { imageSet: 5, spriteIndex: 0, x: "0px", y: "0px" },
  33: { imageSet: 5, spriteIndex: 1, x: "-144px", y: "0px" },
  34: { imageSet: 5, spriteIndex: 2, x: "-288px", y: "0px" },
  35: { imageSet: 5, spriteIndex: 3, x: "-432px", y: "0px" },
  36: { imageSet: 5, spriteIndex: 4, x: "0px", y: "-144px" },
  37: { imageSet: 5, spriteIndex: 5, x: "-144px", y: "-144px" },
  38: { imageSet: 5, spriteIndex: 6, x: "-288px", y: "-144px" },
  39: { imageSet: 5, spriteIndex: 7, x: "-432px", y: "-144px" },
} as const satisfies Record<EmotionId, EmotionCoord>;

// 対話メッセージ
interface DialogMessage {
  id: string;
  character: CharacterType;
  text: TextNode[];
  emotion: EmotionId;
  choices?: DialogChoice[];
}

// 対話の選択肢
interface DialogChoice {
  id: string;
  text: string;
  nextDialogId?: string;
}

// 対話の状態
interface DialogState {
  currentMessage: DialogMessage | null;
  history: DialogMessage[];
  isWaitingForInput: boolean;
}

// 表情ラベルマップ（全40個）
const EMOTION_LABELS = {
  0: "おだやかな笑顔",
  1: "嬉しい",
  2: "とまどい",
  3: "心配",
  4: "びっくり",
  5: "しょんぼり",
  6: "おろおろ",
  7: "落ち込み",
  8: "にこにこ",
  9: "苦笑い",
  10: "真顔",
  11: "クール",
  12: "感動",
  13: "うっとり",
  14: "感激",
  15: "見とれる",
  16: "不満",
  17: "ショック",
  18: "怒り",
  19: "むくれ",
  20: "気まずい",
  21: "放心",
  22: "ぼんやり",
  23: "興味",
  24: "わくわく",
  25: "はしゃぎ",
  26: "大はしゃぎ",
  27: "したり顔",
  28: "おそるおそる",
  29: "不安",
  30: "心細い",
  31: "途方にくれる",
  32: "激怒",
  33: "くやしい",
  34: "泣き",
  35: "照れ",
  36: "安心",
  37: "にんまり",
  38: "ほんわか",
  39: "大笑い",
} as const satisfies Record<EmotionId, string>;

// キャラクター表示名
const CHARACTER_DISPLAY_NAMES = {
  fubuki: "フブキ",
  miko: "みこ",
} as const;

// alt テキスト生成（narration は空文字）
const getEmotionAltText = (
  character: CharacterType,
  emotionId: EmotionId,
): string => {
  if (character === "narration") {
    return "";
  }
  return `${CHARACTER_DISPLAY_NAMES[character]} ${EMOTION_LABELS[emotionId]}`;
};

export type {
  CharacterType,
  EmotionId,
  EmotionCoord,
  DialogMessage,
  DialogChoice,
  DialogState,
};

export {
  EMOTION_COORDS,
  EMOTION_LABELS,
  CHARACTER_DISPLAY_NAMES,
  getEmotionAltText,
};
