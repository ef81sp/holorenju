/**
 * 禁手マーク表示のcomposable
 *
 * CPU対戦で黒番プレイヤーが禁手位置に石を置こうとした際、
 * crossマークを表示して禁手であることを示す。
 */

import { onUnmounted } from "vue";

import type { Position } from "@/types/game";

import { useBoardStore } from "@/stores/boardStore";

/** CPU対戦用の特殊なdialogueIndex */
const FORBIDDEN_MARK_DIALOGUE_INDEX = -1;

/** マーク自動消去までの時間（ミリ秒） */
const FORBIDDEN_MARK_DURATION = 1000;

export interface UseForbiddenMarkOptions {
  /** マーク自動消去までの時間（ミリ秒）。デフォルト: 1000 */
  duration?: number;
}

export interface UseForbiddenMarkReturn {
  /** 禁手マークを表示（一定時間後に自動消去） */
  showForbiddenMark: (position: Position) => void;
  /** 禁手マークを即座にクリア */
  clearForbiddenMark: () => void;
  /** クリーンアップ（タイマーをクリア） */
  cleanup: () => void;
}

export function useForbiddenMark(
  options: UseForbiddenMarkOptions = {},
): UseForbiddenMarkReturn {
  const boardStore = useBoardStore();
  const duration = options.duration ?? FORBIDDEN_MARK_DURATION;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearForbiddenMark(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    boardStore.clearMarks();
  }

  function showForbiddenMark(position: Position): void {
    // 既存のマークとタイマーをクリア
    clearForbiddenMark();

    // 禁手位置にcrossマークを追加
    boardStore.addMarks(
      [{ positions: [position], markType: "cross" }],
      FORBIDDEN_MARK_DIALOGUE_INDEX,
    );

    // 一定時間後にマークを消去
    timer = setTimeout(() => {
      boardStore.clearMarks();
      timer = null;
    }, duration);
  }

  function cleanup(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  // コンポーネントのアンマウント時に自動クリーンアップ
  onUnmounted(() => {
    cleanup();
  });

  return {
    showForbiddenMark,
    clearForbiddenMark,
    cleanup,
  };
}
