/**
 * ScenarioNavigation の関数を provide/inject で共有するためのキー
 */
import type { InjectionKey } from "vue";

export interface ScenarioNavContext {
  loadScenario: () => Promise<void>;
}

export const scenarioNavKey: InjectionKey<ScenarioNavContext> =
  Symbol("scenarioNavContext");
