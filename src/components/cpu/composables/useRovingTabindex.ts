/**
 * Roving tabindex + 矢印キーナビゲーションの共通実装
 *
 * APG の tabs / radiogroup で共通する以下の振る舞いを提供する:
 * - 選択中要素のみ tabindex=0、その他は -1
 * - 矢印キー（horizontal: ←→ / vertical: ↑↓ / both: 全て）で移動
 * - Home / End で先頭・末尾
 * - 自動アクティベーション（移動と同時に onChange 発火）
 * - イベント伝播は自前で停止（親 window の同キーハンドラに干渉しない）
 *
 * 利用側はテンプレートで `ref="items"` を v-for に貼り、`onKeydown(event, id)`
 * を `@keydown` で呼ぶだけでよい。
 */

import { type ComputedRef, type Ref, nextTick, useTemplateRef } from "vue";

export type RovingOrientation = "horizontal" | "vertical" | "both";

interface UseRovingTabindexOptions<T> {
  /** ナビゲーション対象のアイテム配列 */
  items: Ref<T[]> | ComputedRef<T[]>;
  /** id 抽出関数 */
  getId: (item: T) => string;
  /** 移動に伴って呼ばれる選択変更コールバック */
  onChange: (id: string) => void;
  /** 矢印キーの方向（既定: horizontal） */
  orientation?: RovingOrientation;
}

interface UseRovingTabindexReturn {
  /**
   * 利用側でテンプレートに `ref="items"` として渡す ref。
   * v-for の要素配列が Vue から自動で代入される。
   */
  itemsRef: Readonly<Ref<HTMLElement[] | null>>;
  /**
   * `@keydown` ハンドラ。第二引数に現在の要素 id を渡す。
   */
  onKeydown: (event: KeyboardEvent, currentId: string) => void;
}

export function useRovingTabindex<T>(
  options: UseRovingTabindexOptions<T>,
): UseRovingTabindexReturn {
  const { items, getId, onChange, orientation = "horizontal" } = options;

  const itemsRef = useTemplateRef<HTMLElement[]>("items");

  const allowHorizontal =
    orientation === "horizontal" || orientation === "both";
  const allowVertical = orientation === "vertical" || orientation === "both";

  function focusAt(idx: number): void {
    nextTick(() => {
      itemsRef.value?.[idx]?.focus();
    });
  }

  function onKeydown(event: KeyboardEvent, currentId: string): void {
    const list = items.value;
    const currentIdx = list.findIndex((item) => getId(item) === currentId);
    if (currentIdx < 0) {
      return;
    }
    let nextIdx = -1;
    switch (event.key) {
      case "ArrowLeft":
        if (allowHorizontal) {
          nextIdx = (currentIdx - 1 + list.length) % list.length;
        }
        break;
      case "ArrowUp":
        if (allowVertical) {
          nextIdx = (currentIdx - 1 + list.length) % list.length;
        }
        break;
      case "ArrowRight":
        if (allowHorizontal) {
          nextIdx = (currentIdx + 1) % list.length;
        }
        break;
      case "ArrowDown":
        if (allowVertical) {
          nextIdx = (currentIdx + 1) % list.length;
        }
        break;
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = list.length - 1;
        break;
      default:
        return;
    }
    if (nextIdx < 0) {
      return;
    }
    // 親 window の同キーハンドラ（手数送り等）への伝播を抑止
    event.preventDefault();
    event.stopPropagation();
    const next = list[nextIdx];
    if (next) {
      onChange(getId(next));
      focusAt(nextIdx);
    }
  }

  return { itemsRef, onKeydown };
}
