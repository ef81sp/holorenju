import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-vue";
import VueKonva from "vue-konva";

import ScenarioPlayer from "./ScenarioPlayer.vue";

// テスト用シナリオデータ
const mockScenarioData = {
  id: "test-scenario",
  title: "テストシナリオ",
  difficulty: "gomoku_beginner",
  description: "テスト用",
  objectives: ["テスト"],
  sections: [
    {
      id: "demo1",
      type: "demo",
      title: "デモ",
      initialBoard: Array(15).fill("-".repeat(15)),
      dialogues: [
        {
          id: "d1",
          character: "fubuki",
          text: [{ type: "text", content: "テストメッセージ" }],
          emotion: 0,
        },
      ],
    },
  ],
};

const mockIndexData = {
  difficulties: {
    gomoku_beginner: {
      label: "五目並べ:入門",
      scenarios: [
        {
          id: "test-scenario",
          title: "テストシナリオ",
          description: "テスト用",
          path: "gomoku_beginner/test.json",
        },
      ],
    },
  },
};

// scenarioIndexStore のモック
vi.mock("@/stores/scenarioIndexStore", () => ({
  useScenarioIndexStore: () => ({
    index: mockIndexData,
    isLoading: false,
    error: null as string | null,
    loadIndex: vi.fn().mockResolvedValue(undefined),
    findScenarioPath: vi.fn().mockReturnValue("gomoku_beginner/test.json"),
  }),
}));

// fetch のモック
vi.stubGlobal(
  "fetch",
  vi.fn((url: string) => {
    if (url.includes("/scenarios/index.json")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockIndexData),
      });
    }
    if (url.includes("/scenarios/gomoku_beginner/test.json")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockScenarioData),
      });
    }
    return Promise.reject(new Error(`Unknown URL: ${url}`));
  }),
);

describe("ScenarioPlayer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("クラッシュせずにマウントできる", () => {
    const { container } = render(ScenarioPlayer, {
      props: {
        scenarioId: "test-scenario",
      },
      global: {
        plugins: [VueKonva],
      },
    });

    // コンテナが存在することを確認
    expect(container).toBeTruthy();
  });

  // FIXME: シナリオの非同期読み込みのためテストが複雑になる
  // 以下は将来の拡張用のプレースホルダー

  // it("シナリオ読み込み後にダイアログが表示される", async () => {
  //   // 実装予定: waitForでシナリオ読み込み完了を待つ
  // });

  // it("次のダイアログボタンで進行できる", async () => {
  //   // 実装予定: ダイアログナビゲーションのテスト
  // });

  // it("問題セクションで石を置ける", async () => {
  //   // 実装予定: 問題解答のテスト
  // });
});
