import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";
import { createApp } from "vue";
import VueKonva from "vue-konva";

import "./style.css";
import App from "./App.vue";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(VueKonva);
app.mount("#app");

const updateSW = registerSW({
  onNeedRefresh() {
    // eslint-disable-next-line no-alert
    if (window.confirm("新しいバージョンがあります。更新しますか？")) {
      updateSW(true);
    }
  },
});
