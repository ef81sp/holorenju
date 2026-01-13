import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { DialogMessage } from "@/types/character";

import { useDialogStore } from "./dialogStore";

describe("dialogStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  // テスト用のメッセージを作成
  const createMessage = (
    id: string,
    choices?: { id: string; text: string; nextDialogId?: string }[],
  ): DialogMessage => ({
    id,
    character: "fubuki",
    text: [{ type: "text", content: "テストメッセージ" }],
    emotion: 0,
    choices,
  });

  describe("初期状態", () => {
    it("currentMessageがnull", () => {
      const store = useDialogStore();
      expect(store.currentMessage).toBeNull();
    });

    it("historyが空配列", () => {
      const store = useDialogStore();
      expect(store.history).toEqual([]);
    });

    it("isWaitingForInputがfalse", () => {
      const store = useDialogStore();
      expect(store.isWaitingForInput).toBe(false);
    });

    it("hasActiveDialogがfalse", () => {
      const store = useDialogStore();
      expect(store.hasActiveDialog).toBe(false);
    });
  });

  describe("showMessage", () => {
    it("currentMessageを設定する", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1");

      store.showMessage(message);

      expect(store.currentMessage).toEqual(message);
    });

    it("historyに追加する", () => {
      const store = useDialogStore();
      const message1 = createMessage("msg-1");
      const message2 = createMessage("msg-2");

      store.showMessage(message1);
      store.showMessage(message2);

      expect(store.history).toHaveLength(2);
      expect(store.history[0]).toEqual(message1);
      expect(store.history[1]).toEqual(message2);
    });

    it("選択肢があればisWaitingForInputをtrueにする", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1", [
        { id: "choice-1", text: "選択肢1", nextDialogId: "msg-2" },
      ]);

      store.showMessage(message);

      expect(store.isWaitingForInput).toBe(true);
    });

    it("選択肢がなければisWaitingForInputはfalseのまま", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1");

      store.showMessage(message);

      expect(store.isWaitingForInput).toBe(false);
    });

    it("空の選択肢配列でもisWaitingForInputはfalse", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1", []);

      store.showMessage(message);

      expect(store.isWaitingForInput).toBe(false);
    });

    it("hasActiveDialogがtrueになる", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1");

      store.showMessage(message);

      expect(store.hasActiveDialog).toBe(true);
    });
  });

  describe("clearMessage", () => {
    it("currentMessageをnullにする", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1"));

      store.clearMessage();

      expect(store.currentMessage).toBeNull();
    });

    it("isWaitingForInputをfalseにする", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1", [{ id: "c1", text: "選択肢" }]));
      expect(store.isWaitingForInput).toBe(true);

      store.clearMessage();

      expect(store.isWaitingForInput).toBe(false);
    });

    it("historyは保持される", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1"));
      store.showMessage(createMessage("msg-2"));

      store.clearMessage();

      expect(store.history).toHaveLength(2);
    });

    it("hasActiveDialogがfalseになる", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1"));

      store.clearMessage();

      expect(store.hasActiveDialog).toBe(false);
    });
  });

  describe("selectChoice", () => {
    it("選択肢のnextDialogIdを返す", () => {
      const store = useDialogStore();
      store.showMessage(
        createMessage("msg-1", [
          { id: "choice-1", text: "選択肢1", nextDialogId: "msg-2" },
          { id: "choice-2", text: "選択肢2", nextDialogId: "msg-3" },
        ]),
      );

      const result = store.selectChoice("choice-1");

      expect(result).toBe("msg-2");
    });

    it("存在しないchoiceIdはnullを返す", () => {
      const store = useDialogStore();
      store.showMessage(
        createMessage("msg-1", [
          { id: "choice-1", text: "選択肢1", nextDialogId: "msg-2" },
        ]),
      );

      const result = store.selectChoice("non-existent");

      expect(result).toBeNull();
    });

    it("choicesがない場合はnullを返す", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1"));

      const result = store.selectChoice("choice-1");

      expect(result).toBeNull();
    });

    it("currentMessageがnullの場合はnullを返す", () => {
      const store = useDialogStore();

      const result = store.selectChoice("choice-1");

      expect(result).toBeNull();
    });

    it("isWaitingForInputをfalseにする", () => {
      const store = useDialogStore();
      store.showMessage(
        createMessage("msg-1", [
          { id: "choice-1", text: "選択肢1", nextDialogId: "msg-2" },
        ]),
      );
      expect(store.isWaitingForInput).toBe(true);

      store.selectChoice("choice-1");

      expect(store.isWaitingForInput).toBe(false);
    });

    it("nextDialogIdが未定義の場合もnullを返す", () => {
      const store = useDialogStore();
      store.showMessage(
        createMessage("msg-1", [
          { id: "choice-1", text: "選択肢1" }, // nextDialogIdなし
        ]),
      );

      const result = store.selectChoice("choice-1");

      expect(result).toBeNull();
    });
  });

  describe("clearHistory", () => {
    it("historyを空にする", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1"));
      store.showMessage(createMessage("msg-2"));
      expect(store.history).toHaveLength(2);

      store.clearHistory();

      expect(store.history).toEqual([]);
    });

    it("currentMessageは影響を受けない", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1");
      store.showMessage(message);

      store.clearHistory();

      expect(store.currentMessage).toEqual(message);
    });
  });

  describe("reset", () => {
    it("全ての状態を初期化する", () => {
      const store = useDialogStore();
      store.showMessage(createMessage("msg-1", [{ id: "c1", text: "選択肢" }]));
      store.showMessage(createMessage("msg-2"));
      expect(store.currentMessage).not.toBeNull();
      expect(store.history.length).toBeGreaterThan(0);

      store.reset();

      expect(store.currentMessage).toBeNull();
      expect(store.history).toEqual([]);
      expect(store.isWaitingForInput).toBe(false);
    });
  });

  describe("dialogState getter", () => {
    it("現在の状態オブジェクトを返す", () => {
      const store = useDialogStore();
      const message = createMessage("msg-1", [{ id: "c1", text: "選択肢" }]);
      store.showMessage(message);

      const state = store.dialogState;

      expect(state).toEqual({
        currentMessage: message,
        history: [message],
        isWaitingForInput: true,
      });
    });

    it("初期状態を正しく返す", () => {
      const store = useDialogStore();

      const state = store.dialogState;

      expect(state).toEqual({
        currentMessage: null,
        history: [],
        isWaitingForInput: false,
      });
    });
  });
});
