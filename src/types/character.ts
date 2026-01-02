/**
 * キャラクター関連の型定義
 */

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
  text: string;
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

export type {
  CharacterType,
  EmotionId,
  EmotionCoord,
  DialogMessage,
  DialogChoice,
  DialogState,
};

export { EMOTION_COORDS };
