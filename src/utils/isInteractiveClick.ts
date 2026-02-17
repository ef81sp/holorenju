const INTERACTIVE_SELECTOR =
  "button, a, canvas, input, select, textarea, dialog, [role='button']";

/** MouseEvent のターゲットがインタラクティブ要素内かを判定 */
export function isInteractiveClick(event: MouseEvent): boolean {
  const target = event.target as Element | null;
  return Boolean(target?.closest(INTERACTIVE_SELECTOR));
}
