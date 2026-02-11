import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { shallowRef } from "vue";

import { useLightDismiss } from "./useLightDismiss";

// onMounted/onUnmounted をモック
let mountedCallback: (() => void) | null = null;
let unmountedCallback: (() => void) | null = null;

vi.mock("vue", async () => {
  const actual = await vi.importActual("vue");
  return {
    ...actual,
    onMounted: vi.fn((cb: () => void) => {
      mountedCallback = cb;
    }),
    onUnmounted: vi.fn((cb: () => void) => {
      unmountedCallback = cb;
    }),
  };
});

describe("useLightDismiss", () => {
  let mockDialog: {
    close: Mock;
    addEventListener: Mock;
    removeEventListener: Mock;
    getBoundingClientRect: Mock;
  };

  beforeEach(() => {
    mountedCallback = null;
    unmountedCallback = null;
    mockDialog = {
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({
        left: 100,
        right: 400,
        top: 50,
        bottom: 350,
      })),
    };
  });

  it("onMounted でクリックイベントリスナーを登録する", () => {
    const dialogRef = shallowRef(mockDialog as unknown as HTMLDialogElement);
    useLightDismiss(dialogRef);

    expect(mountedCallback).not.toBeNull();
    mountedCallback!();

    expect(mockDialog.addEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );
  });

  it("onUnmounted でクリックイベントリスナーを解除する", () => {
    const dialogRef = shallowRef(mockDialog as unknown as HTMLDialogElement);
    useLightDismiss(dialogRef);

    mountedCallback!();
    unmountedCallback!();

    expect(mockDialog.removeEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
    );
  });

  it("ダイアログ外側のクリックで close() が呼ばれる", () => {
    const dialogRef = shallowRef(mockDialog as unknown as HTMLDialogElement);
    useLightDismiss(dialogRef);
    mountedCallback!();

    // addEventListener に渡されたハンドラーを取得
    const handler = mockDialog.addEventListener.mock.calls[0][1] as (
      event: MouseEvent,
    ) => void;

    // ダイアログ要素自体がターゲットで、座標がダイアログ外
    const event = {
      target: mockDialog,
      clientX: 10, // left=100 の外側
      clientY: 10, // top=50 の外側
    } as unknown as MouseEvent;

    handler(event);
    expect(mockDialog.close).toHaveBeenCalled();
  });

  it("ダイアログ内側のクリックで close() が呼ばれない", () => {
    const dialogRef = shallowRef(mockDialog as unknown as HTMLDialogElement);
    useLightDismiss(dialogRef);
    mountedCallback!();

    const handler = mockDialog.addEventListener.mock.calls[0][1] as (
      event: MouseEvent,
    ) => void;

    // ダイアログ要素自体がターゲットだが、座標はダイアログ内
    const event = {
      target: mockDialog,
      clientX: 200, // left=100 と right=400 の間
      clientY: 200, // top=50 と bottom=350 の間
    } as unknown as MouseEvent;

    handler(event);
    expect(mockDialog.close).not.toHaveBeenCalled();
  });

  it("子要素のクリックで close() が呼ばれない", () => {
    const dialogRef = shallowRef(mockDialog as unknown as HTMLDialogElement);
    useLightDismiss(dialogRef);
    mountedCallback!();

    const handler = mockDialog.addEventListener.mock.calls[0][1] as (
      event: MouseEvent,
    ) => void;

    // ターゲットがダイアログ要素自体ではない（子要素）
    const childElement = {} as HTMLElement;
    const event = {
      target: childElement,
      clientX: 200,
      clientY: 200,
    } as unknown as MouseEvent;

    handler(event);
    expect(mockDialog.close).not.toHaveBeenCalled();
  });

  it("closedBy プロパティが存在する場合はフォールバック不要で close() が呼ばれない", () => {
    const dialogWithClosedBy = {
      ...mockDialog,
      closedBy: "any",
    };
    const dialogRef = shallowRef(
      dialogWithClosedBy as unknown as HTMLDialogElement,
    );
    useLightDismiss(dialogRef);
    mountedCallback!();

    const handler = dialogWithClosedBy.addEventListener.mock.calls[0][1] as (
      event: MouseEvent,
    ) => void;

    // ダイアログ外側のクリック
    const event = {
      target: dialogWithClosedBy,
      clientX: 10,
      clientY: 10,
    } as unknown as MouseEvent;

    handler(event);
    expect(dialogWithClosedBy.close).not.toHaveBeenCalled();
  });

  it("dialogRef が null の場合はイベントリスナーを登録しない", () => {
    const dialogRef = shallowRef<HTMLDialogElement | null>(null);
    useLightDismiss(dialogRef);
    mountedCallback!();

    expect(mockDialog.addEventListener).not.toHaveBeenCalled();
  });
});
