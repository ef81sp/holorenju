import { createPinia } from "pinia";
import { createApp } from "vue";
import VueKonva from "vue-konva";

import "./style.css";
import ScenarioEditor from "./editor/components/ScenarioEditor.vue";

const app = createApp(ScenarioEditor);
const pinia = createPinia();

app.use(pinia);
app.use(VueKonva);
app.mount("#editor-app");
