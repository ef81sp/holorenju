/**
 * 振り返り用セリフ生成Composable
 *
 * フブキが先生役としてプレイヤーの着手を評価コメント
 */

import { ref, type Ref } from "vue";

import type { EmotionId } from "@/types/character";
import type { Position } from "@/types/game";
import type { EvaluatedMove, MoveQuality } from "@/types/review";

import { formatMove } from "@/logic/gameRecordParser";
import { parseText } from "@/logic/textParser";
import { useDialogStore } from "@/stores/dialogStore";

/** 品質別のセリフテンプレート */
const QUALITY_DIALOGUES: Record<MoveQuality, string[]> = {
  excellent: ["すごい！最善手だよ！", "完璧な一手！", "これ以上ない手だね！"],
  good: ["いい手だね！", "いいところに目をつけたね！", "なかなかやるね〜"],
  inaccuracy: [
    "{bestMove}の方が良かったかも？",
    "惜しい！{bestMove}だともっと良かったよ",
    "悪くないけど、{bestMove}が強かったね",
  ],
  mistake: [
    "ここは{bestMove}が正解だったね",
    "{bestMove}に打つべきだったかも...",
    "うーん、{bestMove}の方がずっと良かったよ",
  ],
  blunder: [
    "{bestMove}じゃないと危ないよ！",
    "これは大変！{bestMove}が急所だったね",
    "{bestMove}を見逃しちゃったね...",
  ],
};

/** 品質別の表情 */
const QUALITY_EMOTIONS: Record<MoveQuality, EmotionId> = {
  excellent: 26, // 驚き・ツッコミ
  good: 0, // 通常の説明
  inaccuracy: 1, // 考え中
  mistake: 19, // 強調・指摘
  blunder: 11, // 心配
};

/** 強制勝ち種別の表示名 */
const FORCED_WIN_LABELS: Record<
  NonNullable<EvaluatedMove["forcedWinType"]>,
  string
> = {
  vcf: "四追い",
  vct: "追い詰め",
  "forbidden-trap": "禁手追い込み",
};

/** 強制勝ち検出時の追加セリフ（品質別） */
const FORCED_WIN_DIALOGUES: Record<MoveQuality, string[]> = {
  excellent: [
    "{forcedWin}を見つけたね！さすが！",
    "{forcedWin}で決められる局面、ばっちり！",
  ],
  good: ["{forcedWin}がある局面だったよ", "ここは{forcedWin}で決められたね"],
  inaccuracy: [
    "実は{forcedWin}で決められたんだよ！{bestMove}から始まるよ",
    "{forcedWin}があったね。{bestMove}が起点だよ",
  ],
  mistake: [
    "{forcedWin}を逃しちゃった！{bestMove}から決まったよ",
    "ここは{forcedWin}で勝てたね。{bestMove}がポイント！",
  ],
  blunder: [
    "{forcedWin}があったのに！{bestMove}から一気に決まったよ",
    "{forcedWin}を見逃しちゃったね...{bestMove}が急所！",
  ],
};

/**
 * ランダムに要素を選択
 */
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export interface UseReviewDialogueReturn {
  /** 現在の表情 */
  currentEmotion: Ref<EmotionId>;
  /** 品質に応じたセリフを表示 */
  showQualityDialogue: (
    quality: MoveQuality,
    bestMove: Position,
    forcedWinType?: EvaluatedMove["forcedWinType"],
  ) => void;
  /** 初期セリフを表示 */
  showInitialDialogue: () => void;
  /** 評価中セリフを表示 */
  showEvaluatingDialogue: () => void;
  /** 評価完了セリフを表示 */
  showEvaluationCompleteDialogue: (accuracy: number) => void;
  /** セリフをクリア */
  clearDialogue: () => void;
}

/**
 * 振り返り用セリフ生成Composable
 */
export function useReviewDialogue(): UseReviewDialogueReturn {
  const dialogStore = useDialogStore();
  const currentEmotion = ref<EmotionId>(0);

  function generateId(): string {
    return `review-dialog-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function showMessage(text: string, emotion: EmotionId): void {
    currentEmotion.value = emotion;
    dialogStore.showMessage({
      id: generateId(),
      character: "fubuki",
      text: parseText(text),
      emotion,
    });
  }

  function showQualityDialogue(
    quality: MoveQuality,
    bestMove: Position,
    forcedWinType?: EvaluatedMove["forcedWinType"],
  ): void {
    const templates = forcedWinType
      ? FORCED_WIN_DIALOGUES[quality]
      : QUALITY_DIALOGUES[quality];
    const template = randomChoice(templates);
    const forcedWinLabel = forcedWinType
      ? FORCED_WIN_LABELS[forcedWinType]
      : "";
    const text = template
      .replace(/\{bestMove\}/g, formatMove(bestMove))
      .replace(/\{forcedWin\}/g, forcedWinLabel);
    showMessage(text, QUALITY_EMOTIONS[quality]);
  }

  function showInitialDialogue(): void {
    showMessage("振り返りを始めるよ！←→キーで手順を確認してね", 0);
  }

  function showEvaluatingDialogue(): void {
    showMessage("解析中...ちょっと待ってね", 1);
  }

  function showEvaluationCompleteDialogue(accuracy: number): void {
    if (accuracy >= 80) {
      showMessage(`解析完了！精度${accuracy}%、すごいね！`, 26);
    } else if (accuracy >= 50) {
      showMessage(`解析完了！精度${accuracy}%、まずまずだね`, 0);
    } else {
      showMessage(`解析完了！精度${accuracy}%、もっと頑張ろう！`, 19);
    }
  }

  function clearDialogue(): void {
    dialogStore.clearMessage();
  }

  return {
    currentEmotion,
    showQualityDialogue,
    showInitialDialogue,
    showEvaluatingDialogue,
    showEvaluationCompleteDialogue,
    clearDialogue,
  };
}
