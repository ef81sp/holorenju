import { useDebounceFn } from "@vueuse/core";
import { ref, type ComputedRef, type Ref } from "vue";

import type { BoardState, Position } from "@/types/game";

import { formatMove } from "@/logic/gameRecordParser";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** politeMessage のデバウンス遅延（ms） */
const POLITE_DEBOUNCE_MS = 400;

function getStoneStateText(cell: "black" | "white" | null | undefined): string {
  switch (cell) {
    case "black":
      return "黒";
    case "white":
      return "白";
    default:
      return "なし";
  }
}

interface BoardAnnouncerOptions {
  board: ComputedRef<BoardState>;
  cursorPosition: Ref<Position>;
  isCursorActivated: Ref<boolean>;
}

interface BoardAnnouncerReturn {
  /** aria-live="polite" 用テキスト（カーソル移動時） */
  politeMessage: Ref<string>;
  /** aria-live="assertive" 用テキスト（CPU着手時・勝敗確定時） */
  assertiveMessage: Ref<string>;
  /** カーソル移動を読み上げる */
  announceCursorMove: () => void;
  /** CPUの着手を読み上げる */
  announceCpuMove: (position: Position) => void;
  /** プレイヤーの着手を読み上げる */
  announcePlayerMove: (position: Position) => void;
  /** 勝敗結果を読み上げる */
  announceGameResult: (result: "win" | "lose" | "draw") => void;
}

/**
 * 連珠盤のスクリーンリーダー向け読み上げ管理
 *
 * ARIAライブリージョンで読み上げるテキストを管理する。
 * - カーソル移動時: 座標 + 盤面状態（polite）
 * - CPU着手時: 「相手の着手: 座標」（assertive）
 */
export function useBoardAnnouncer(
  options: BoardAnnouncerOptions,
): BoardAnnouncerReturn {
  const { board, cursorPosition, isCursorActivated } = options;
  const preferencesStore = usePreferencesStore();

  const politeMessage = ref("");
  const assertiveMessage = ref("");

  // 同一テキスト対策用のトグル
  let zwspToggle = false;

  /** デバウンス付きで politeMessage を更新する */
  const flushPoliteMessage = useDebounceFn((text: string) => {
    zwspToggle = !zwspToggle;
    politeMessage.value = zwspToggle ? `${text}\u200B` : text;
  }, POLITE_DEBOUNCE_MS);

  function announceCursorMove(): void {
    if (!preferencesStore.boardAnnounce || !isCursorActivated.value) {
      return;
    }

    const pos = cursorPosition.value;
    const coordinate = formatMove(pos);

    const cell = board.value[pos.row]?.[pos.col];
    const stateText = getStoneStateText(cell);

    flushPoliteMessage(`${coordinate} ${stateText}`);
  }

  function announceCpuMove(position: Position): void {
    if (!preferencesStore.boardAnnounce) {
      return;
    }
    assertiveMessage.value = `相手の着手: ${formatMove(position)}`;
  }

  function announcePlayerMove(position: Position): void {
    if (!preferencesStore.boardAnnounce) {
      return;
    }
    politeMessage.value = `${formatMove(position)}に着手しました`;
  }

  const GAME_RESULT_TEXT: Record<"win" | "lose" | "draw", string> = {
    win: "あなたの勝ちです",
    lose: "相手の勝ちです",
    draw: "引き分けです",
  };

  function announceGameResult(result: "win" | "lose" | "draw"): void {
    if (!preferencesStore.boardAnnounce) {
      return;
    }
    assertiveMessage.value = GAME_RESULT_TEXT[result];
  }

  return {
    politeMessage,
    assertiveMessage,
    announceCursorMove,
    announceCpuMove,
    announcePlayerMove,
    announceGameResult,
  };
}
