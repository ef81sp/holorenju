import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";
import { createApp } from "vue";
import VueKonva from "vue-konva";

import "./style.css";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";
import { preloadThreatWasm } from "@/logic/cpu/wasm/threatAdapter";

import App from "./App.vue";

// 連珠ルール判定の thin wasm（禁手 41KB / 脅威 28KB）を mount 前に await でロードする
// ブートゲート（#37 P4 #43）。これにより isForbiddenForBlack / createsFour 等の同期
// adapter 呼び出しが「wasm 常時ロード済み」を前提にでき、TS フォールバック撤去（PR-6）の
// 安全条件を満たす。ロード失敗は握りつぶし、フォールバックが残っている間は継続可能にする。
async function bootstrap(): Promise<void> {
  await Promise.all([
    preloadForbiddenWasm().catch((e: unknown) => {
      console.error(
        "禁手 wasm のプリロードに失敗（TS フォールバックで継続）",
        e,
      );
    }),
    preloadThreatWasm().catch((e: unknown) => {
      console.error(
        "脅威 wasm のプリロードに失敗（TS フォールバックで継続）",
        e,
      );
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
