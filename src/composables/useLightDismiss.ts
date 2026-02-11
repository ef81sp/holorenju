import { onMounted, onUnmounted, type Ref } from "vue";

/**
 * <dialog> 要素に light dismiss（外側クリックで閉じる）を追加する composable
 *
 * ブラウザが closedby="any" をサポートしている場合はネイティブ機能を利用し、
 * サポートしていない場合は backdrop クリックのフォールバックを設定します。
 *
 * closedby 属性はテンプレート側で設定してください。
 * この composable はフォールバック用の click イベントリスナーのみを管理します。
 */
export function useLightDismiss(
  dialogRef: Ref<HTMLDialogElement | null>,
): void {
  const handleClick = (event: MouseEvent): void => {
    const dialog = dialogRef.value;
    if (!dialog) {
      return;
    }

    // closedby をネイティブサポートしている場合はフォールバック不要
    if ("closedBy" in dialog) {
      return;
    }

    // <dialog> 要素自体がクリックターゲットの場合、
    // backdrop 領域（padding 外側）がクリックされたと判断する
    if (event.target !== dialog) {
      return;
    }

    // クリック位置がダイアログの content box 内かどうかを判定
    const rect = dialog.getBoundingClientRect();
    const isInsideContent =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!isInsideContent) {
      dialog.close();
    }
  };

  onMounted(() => {
    dialogRef.value?.addEventListener("click", handleClick);
  });

  onUnmounted(() => {
    dialogRef.value?.removeEventListener("click", handleClick);
  });
}
