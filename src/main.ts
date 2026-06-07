import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";
import { createApp } from "vue";
import VueKonva from "vue-konva";

import "./style.css";
import { preloadForbiddenWasm } from "@/logic/cpu/wasm/forbiddenAdapter";

import App from "./App.vue";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(VueKonva);
app.mount("#app");

// 禁手専用 thin wasm（41KB）を非ブロッキングでプリロード（#37 P1）。
// 失敗しても isForbiddenForBlack が TS フォールバックするためクラッシュしない。
preloadForbiddenWasm().catch((e: unknown) => {
  console.error("禁手 wasm のプリロードに失敗（TS フォールバックで継続）", e);
});

const updateSW = registerSW({
  onNeedRefresh() {
    // eslint-disable-next-line no-alert
    if (window.confirm("新しいバージョンがあります。更新しますか？")) {
      updateSW(true);
    }
  },
});
