/**
 * CPU対戦用セリフ・表情管理Composable
 *
 * 難易度に応じたキャラクター割り当て、シチュエーション別セリフ・表情を管理
 */

import { ref, type Ref } from "vue";

import type { CharacterType, EmotionId } from "@/types/character";
import type { CpuDifficulty } from "@/types/cpu";

import { parseText } from "@/logic/textParser";
import { useDialogStore } from "@/stores/dialogStore";

/**
 * セリフ表示シチュエーション
 */
export type CpuDialogueSituation =
  | "gameStart" // ゲーム開始
  | "cpuThinking" // CPU思考中
  | "playerGoodMove" // プレイヤー好手
  | "cpuAdvantage" // CPU優勢
  | "playerWin" // プレイヤー勝利
  | "cpuWin"; // CPU勝利

/**
 * 難易度とキャラクターのマッピング
 */
const DIFFICULTY_CHARACTER_MAP: Record<CpuDifficulty, CharacterType> = {
  beginner: "miko", // かんたん → ミコ
  easy: "miko", // やさしい → ミコ
  medium: "fubuki", // ふつう → フブキ
  hard: "fubuki", // むずかしい → フブキ
};

/**
 * シチュエーション別の表情マッピング（フブキ）
 */
const FUBUKI_EMOTIONS: Record<CpuDialogueSituation, EmotionId> = {
  gameStart: 0, // 通常の説明・挨拶
  cpuThinking: 1, // 提案・考え中
  playerGoodMove: 26, // 驚き・ツッコミ
  cpuAdvantage: 19, // 強調・重要な説明
  playerWin: 11, // 心配・不安
  cpuWin: 37, // 笑い・楽しい
};

/**
 * シチュエーション別の表情マッピング（ミコ）
 */
const MIKO_EMOTIONS: Record<CpuDialogueSituation, EmotionId> = {
  gameStart: 32, // 興奮・やる気
  cpuThinking: 23, // 困惑・考え中
  playerGoodMove: 13, // 驚愕
  cpuAdvantage: 35, // 感心・理解
  playerWin: 28, // 落ち込み・悲しみ
  cpuWin: 4, // 感嘆・喜び
};

/**
 * キャラクター別・シチュエーション別のセリフパターン
 */
const CPU_DIALOGUES: Record<
  Exclude<CharacterType, "narration">,
  Record<CpuDialogueSituation, string[]>
> = {
  fubuki: {
    gameStart: ["よろしくお願いします！", "がんばるよ〜", "いい勝負しようね！"],
    cpuThinking: [
      "うーん、どこに置こうかな...",
      "ちょっと待ってね...",
      "ここかな...",
    ],
    playerGoodMove: ["おっ、いい手だね！", "やるじゃん！", "さすがだね〜"],
    cpuAdvantage: [
      "ふふっ、見えてるよ〜",
      "こっちも負けないよ！",
      "いい感じ！",
    ],
    playerWin: ["わぁ、負けちゃった...", "くやしいなぁ...", "次はがんばるよ〜"],
    cpuWin: [
      "やったー！勝っちゃった！",
      "フブキの勝ち！",
      "ありがとう、楽しかった！",
    ],
  },
  miko: {
    gameStart: [
      "いくよー！",
      "よっしゃおらぁ！",
      "エリートみこちの実力見せるよ！",
    ],
    cpuThinking: ["えーっと...", "んー、ここかな...", "どこがいいかな〜"],
    playerGoodMove: ["うわっ、やるじゃん！", "おおー！", "えっ、うまい！？"],
    cpuAdvantage: [
      "ふふん、みこちの番だよ〜",
      "いけるいける！",
      "見てて見てて！",
    ],
    playerWin: ["あー負けた〜...", "くっそー...", "もう一回やろ！"],
    cpuWin: ["やったー！みこちの勝ちー！", "エリートだからね！", "どうだ〜！"],
  },
};

/**
 * ランダムに要素を選択
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

/**
 * 一意なIDを生成
 */
function generateDialogId(): string {
  return `cpu-dialog-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface UseCpuDialogueReturn {
  cpuCharacter: Ref<CharacterType>;
  currentEmotion: Ref<EmotionId>;
  showDialogue: (situation: CpuDialogueSituation) => void;
  clearDialogue: () => void;
  initCharacter: (difficulty: CpuDifficulty) => void;
}

/**
 * CPU対戦用セリフ・表情管理Composable
 */
export function useCpuDialogue(): UseCpuDialogueReturn {
  const dialogStore = useDialogStore();

  const cpuCharacter = ref<CharacterType>("fubuki");
  const currentEmotion = ref<EmotionId>(0);

  /**
   * 難易度からキャラクターを初期化
   */
  function initCharacter(difficulty: CpuDifficulty): void {
    cpuCharacter.value = DIFFICULTY_CHARACTER_MAP[difficulty];
    currentEmotion.value = 0;
  }

  /**
   * シチュエーションに応じたセリフを表示
   */
  function showDialogue(situation: CpuDialogueSituation): void {
    const character = cpuCharacter.value;

    // narrationは対象外
    if (character === "narration") {
      return;
    }

    // 表情を更新
    const emotionMap = character === "fubuki" ? FUBUKI_EMOTIONS : MIKO_EMOTIONS;
    currentEmotion.value = emotionMap[situation];

    // セリフを選択
    const dialogues = CPU_DIALOGUES[character][situation];
    const text = randomChoice(dialogues);

    // dialogStoreにメッセージを表示
    dialogStore.showMessage({
      id: generateDialogId(),
      character,
      text: parseText(text),
      emotion: currentEmotion.value,
    });
  }

  /**
   * セリフをクリア
   */
  function clearDialogue(): void {
    dialogStore.clearMessage();
  }

  return {
    cpuCharacter,
    currentEmotion,
    showDialogue,
    clearDialogue,
    initCharacter,
  };
}
