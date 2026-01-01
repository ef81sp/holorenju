/**
 * キャラクター関連の型定義
 */

// キャラクターの種類
type CharacterType = "fubuki" | "miko" | "narration";

// キャラクターの表情
type Emotion = "normal" | "happy" | "thinking" | "surprised" | "explaining";

// キャラクター情報
interface Character {
  type: CharacterType;
  name: string;
  emotion: Emotion;
  avatarUrl: string;
}

// 対話メッセージ
interface DialogMessage {
  id: string;
  character: CharacterType;
  text: string;
  emotion: Emotion;
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
  Emotion,
  Character,
  DialogMessage,
  DialogChoice,
  DialogState,
};
