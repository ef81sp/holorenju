import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-vue";
import VueKonva from "vue-konva";

import RenjuBoard from "./RenjuBoard.vue";

describe("RenjuBoard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("クラッシュせずにマウントできる", () => {
    const { container } = render(RenjuBoard, {
      props: {
        stageSize: 480,
      },
      global: {
        plugins: [VueKonva],
      },
    });

    // コンテナが存在することを確認
    expect(container).toBeTruthy();
    // .renju-board クラスを持つ要素が存在することを確認
    expect(container.querySelector(".renju-board")).toBeTruthy();
  });

  it("カスタムの盤面状態でレンダリングできる", () => {
    const boardState = new Array(15)
      .fill(null)
      .map(() => new Array(15).fill(null));
    boardState[7][7] = "black";

    const { container } = render(RenjuBoard, {
      props: {
        stageSize: 480,
        boardState,
      },
      global: {
        plugins: [VueKonva],
      },
    });

    expect(container.querySelector(".renju-board")).toBeTruthy();
  });

  it("disabled時もマウントできる", () => {
    const { container } = render(RenjuBoard, {
      props: {
        stageSize: 480,
        disabled: true,
      },
      global: {
        plugins: [VueKonva],
      },
    });

    expect(container.querySelector(".renju-board")).toBeTruthy();
  });
});
