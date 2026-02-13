import { useDebounceFn } from "@vueuse/core";
import { ref, type ComputedRef, type Ref } from "vue";

import type { BoardState, Position } from "@/types/game";

import { formatMove } from "@/logic/gameRecordParser";
import { usePreferencesStore } from "@/stores/preferencesStore";

/** politeMessage のデバウンス遅延（ms） */
const POLITE_DEBOUNCE_MS = 400;

interface BoardAnnouncerOptions {
  board: ComputedRef<BoardState>;
  cursorPosition: Ref<Position>;
  isCursorActivated: Ref<boolean>;
}

interface BoardAnnouncerReturn {
  /** aria-live="polite" 用テキスト（カーソル移動時） */
  politeMessage: Ref<string>;
  /** aria-live="assertive" 用テキスト（CPU着手時） */
  assertiveMessage: Ref<string>;
  /** カーソル移動を読み上げる */
  announceCursorMove: () => void;
  /** CPUの着手を読み上げる */
  announceCpuMove: (position: Position) => void;
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
    let stateText: string;
    switch (cell) {
      case "black":
        stateText = "黒";
        break;
      case "white":
        stateText = "白";
        break;
      default:
        stateText = "なし";
        break;
    }

    flushPoliteMessage(`${coordinate} ${stateText}`);
  }

  function announceCpuMove(position: Position): void {
    if (!preferencesStore.boardAnnounce) {
      return;
    }
    assertiveMessage.value = `相手の着手: ${formatMove(position)}`;
  }

  return {
    politeMessage,
    assertiveMessage,
    announceCursorMove,
    announceCpuMove,
  };
}
