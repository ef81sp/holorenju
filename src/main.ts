import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";
import { createApp } from "vue";
import VueKonva from "vue-konva";

import "./style.css";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";

import App from "./App.vue";

// 連珠ルール判定の thin wasm（禁手 41KB / 脅威 28KB）を mount 前に await でロードする
// ブートゲート（#37 P4 #43）。アダプタは pure-wasm 化済（TS フォールバックなし）なので、
// isForbiddenForBlack / createsFour 等の同期呼び出しが走る前に wasm をロード済みにする。
// ロード失敗時は握りつぶして mount するが、その場合 wasm 依存の判定は実行時に例外となる
// （degraded mode）。本番では発生しない想定。
async function bootstrap(): Promise<void> {
  await Promise.all([
    preloadForbiddenWasm().catch((e: unknown) => {
      console.error("禁手 wasm のプリロードに失敗", e);
    }),
    preloadThreatWasm().catch((e: unknown) => {
      console.error("脅威 wasm のプリロードに失敗", e);
    }),
  ]);

  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(VueKonva);
  app.mount("#app");
}

bootstrap().catch((e: unknown) => {
  console.error("アプリの初期化に失敗しました", e);
});

const updateSW = registerSW({
  onNeedRefresh() {
    // eslint-disable-next-line no-alert
    if (window.confirm("新しいバージョンがあります。更新しますか？")) {
      updateSW(true);
    }
  },
});
