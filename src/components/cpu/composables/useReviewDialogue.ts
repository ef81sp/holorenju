/**
 * 振り返り用セリフ生成Composable
 *
 * フブキが先生役としてプレイヤーの着手を評価コメント
 */

import { ref, type Ref } from "vue";

import type { EmotionId } from "@/types/character";
import type { BattleResult } from "@/types/cpu";
import type { Position } from "@/types/game";
import type { EvaluatedMove, MoveQuality } from "@/types/review";

import { FULL_LABELS } from "@/logic/forcedTypeLabels";
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
    "ここは{bestMove}が正解だったね",
    "{bestMove}に打つべきだったかも...",
    "うーん、{bestMove}の方がずっと良かったよ",
  ],
};

/** 品質別の表情 */
const QUALITY_EMOTIONS: Record<MoveQuality, EmotionId> = {
  excellent: 26, // 驚き・ツッコミ
  good: 0, // 通常の説明
  inaccuracy: 1, // 考え中
  mistake: 19, // 強調・指摘
  blunder: 19, // 強調・指摘（mistakeと同じ）
};

/** 負け確定（相手の必勝手順あり）時のセリフ（品質別） */
const FORCED_LOSS_DIALOGUES: Record<MoveQuality, string[]> = {
  excellent: ["最善は尽くしたけど、相手の{forcedLoss}は防げないよ..."],
  good: ["悪くないけど、相手に{forcedLoss}があるよ..."],
  inaccuracy: ["この手で相手に{forcedLoss}を許しちゃったかも"],
  mistake: [
    "この手で相手に{forcedLoss}を許しちゃったよ！{bestMove}ならまだ粘れたかも",
  ],
  blunder: [
    "この手で相手に{forcedLoss}を許しちゃったよ！{bestMove}ならまだ粘れたかも",
  ],
};

/** 負け確定時の表情 */
const FORCED_LOSS_EMOTIONS: Record<MoveQuality, EmotionId> = {
  excellent: 1, // 考え中（仕方ない）
  good: 1, // 考え中
  inaccuracy: 11, // 心配
  mistake: 11, // 心配
  blunder: 11, // 心配
};

/** 敗着（勝負の分かれ目）のセリフ — bestMove ≠ 打った手の場合 */
const LOSING_MOVE_DIALOGUES: string[] = [
  "ここが勝負の分かれ目だったね。{bestMove}なら粘れたかも",
  "この手が敗着だね...{bestMove}に打っていれば...",
];

/** 敗着だが最善手 = 打った手の場合（minimax的には最善だが追詰を許した） */
const LOSING_MOVE_BEST_DIALOGUES: string[] = [
  "ここが勝負の分かれ目だったね...",
  "この局面が敗着だね...難しい局面だった",
];

/** 敗着以降（既に負けが決まっている局面）のセリフ */
const ALREADY_LOST_DIALOGUES: string[] = [
  "もう相手の{forcedLoss}が決まっているよ...",
  "この局面は相手の{forcedLoss}を防げないね...",
];

/** CPU手のセリフ */
const CPU_MOVE_DIALOGUES = ["相手の一手だよ", "相手の手だね"];

/** CPU手で強制勝ち（プレイヤー負け確定）時のセリフ */
const CPU_FORCED_WIN_DIALOGUES = [
  "相手の{forcedWin}が決まっているよ...",
  "ここから相手の{forcedWin}だよ...",
];

/** 五連（決着）時のセリフ */
const GAME_END_DIALOGUES: Record<BattleResult, string[]> = {
  win: ["五連！見事な勝利だね！", "やったね、五連完成！"],
  lose: ["相手に五連を決められちゃった...", "五連...負けちゃったね"],
  draw: ["引き分けだね、いい勝負だった！", "引き分け！お互い譲らなかったね"],
};

/** 五連時の表情 */
const GAME_END_EMOTIONS: Record<BattleResult, EmotionId> = {
  win: 26, // 驚き・ツッコミ
  lose: 11, // 心配
  draw: 0, // 通常
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
    "{forcedWin}を逃しちゃった！{bestMove}から決まったよ",
    "ここは{forcedWin}で勝てたね。{bestMove}がポイント！",
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
    forcedLossType?: EvaluatedMove["forcedLossType"],
    missedDoubleMise?: Position[],
    isAlreadyLost?: boolean,
    isLosingMove?: boolean,
  ) => void;
  /** CPU手のセリフを表示 */
  showCpuMoveDialogue: (forcedWinType?: EvaluatedMove["forcedWinType"]) => void;
  /** 五連（決着）セリフを表示 */
  showGameEndDialogue: (result: BattleResult) => void;
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

  /** 優先順に応じたテンプレートと表情を選択 */
  function selectTemplateAndEmotion(
    quality: MoveQuality,
    forcedWinType?: EvaluatedMove["forcedWinType"],
    forcedLossType?: EvaluatedMove["forcedLossType"],
    isAlreadyLost?: boolean,
    isLosingMove?: boolean,
  ): { templates: string[]; emotion: EmotionId } {
    if (forcedWinType) {
      return {
        templates: FORCED_WIN_DIALOGUES[quality],
        emotion: QUALITY_EMOTIONS[quality],
      };
    }
    if (isLosingMove) {
      return {
        templates:
          quality === "excellent"
            ? LOSING_MOVE_BEST_DIALOGUES
            : LOSING_MOVE_DIALOGUES,
        emotion: 11, // 心配
      };
    }
    if (isAlreadyLost && forcedLossType) {
      return {
        templates: ALREADY_LOST_DIALOGUES,
        emotion: 1, // 考え中（仕方ない）
      };
    }
    if (forcedLossType) {
      return {
        templates: FORCED_LOSS_DIALOGUES[quality],
        emotion: FORCED_LOSS_EMOTIONS[quality],
      };
    }
    return {
      templates: QUALITY_DIALOGUES[quality],
      emotion: QUALITY_EMOTIONS[quality],
    };
  }

  function showQualityDialogue(
    quality: MoveQuality,
    bestMove: Position,
    forcedWinType?: EvaluatedMove["forcedWinType"],
    forcedLossType?: EvaluatedMove["forcedLossType"],
    missedDoubleMise?: Position[],
    isAlreadyLost?: boolean,
    isLosingMove?: boolean,
  ): void {
    // 両ミセ局面だが打った手は両ミセではない場合の専用セリフ
    // quality が good 以上（excellent→good ダウングレード含む）の場合のみ
    if (
      (quality === "excellent" || quality === "good") &&
      forcedWinType === "double-mise" &&
      missedDoubleMise &&
      missedDoubleMise.length > 0
    ) {
      const label = FULL_LABELS[forcedWinType];
      const text = `いい手！でも${formatMove(bestMove)}の${label}の方が速いよ`;
      showMessage(text, QUALITY_EMOTIONS.good);
      return;
    }

    // 両ミセを打てているときは通常の品質セリフ（「すごい！最善手だよ！」等）
    const effectiveForcedWinType =
      forcedWinType === "double-mise" &&
      (!missedDoubleMise || missedDoubleMise.length === 0)
        ? undefined
        : forcedWinType;

    const { templates, emotion } = selectTemplateAndEmotion(
      quality,
      effectiveForcedWinType,
      forcedLossType,
      isAlreadyLost,
      isLosingMove,
    );
    const template = randomChoice(templates);
    const forcedWinLabel = forcedWinType ? FULL_LABELS[forcedWinType] : "";
    const forcedLossLabel = forcedLossType ? FULL_LABELS[forcedLossType] : "";
    const text = template
      .replace(/\{bestMove\}/g, formatMove(bestMove))
      .replace(/\{forcedWin\}/g, forcedWinLabel)
      .replace(/\{forcedLoss\}/g, forcedLossLabel);
    showMessage(text, emotion);
  }

  function showCpuMoveDialogue(
    forcedWinType?: EvaluatedMove["forcedWinType"],
  ): void {
    if (forcedWinType) {
      const template = randomChoice(CPU_FORCED_WIN_DIALOGUES);
      const text = template.replace(
        /\{forcedWin\}/g,
        FULL_LABELS[forcedWinType],
      );
      showMessage(text, 11);
    } else {
      showMessage(randomChoice(CPU_MOVE_DIALOGUES), 0);
    }
  }

  function showGameEndDialogue(result: BattleResult): void {
    showMessage(
      randomChoice(GAME_END_DIALOGUES[result]),
      GAME_END_EMOTIONS[result],
    );
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
    showCpuMoveDialogue,
    showGameEndDialogue,
    showInitialDialogue,
    showEvaluatingDialogue,
    showEvaluationCompleteDialogue,
    clearDialogue,
  };
}
