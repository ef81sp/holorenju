import type { Scene } from "@/stores/appStore";

export const SCENE_TITLES: Record<Scene, string> = {
  menu: "メニュー",
  difficulty: "ステップ選択",
  scenarioList: "シナリオ選択",
  scenarioPlay: "シナリオプレイ",
  cpuSetup: "ホロメン対戦",
  cpuPlay: "対戦中",
  cpuReview: "振り返り",
};

export const APP_NAME = "ホロ連珠";
