/**
 * シナリオを再読み込みする機能（デバッグ用）
 *
 * @param loadScenario - シナリオを読み込む関数（useScenarioNavigation から）
 */
export const useScenarioReload = (
  loadScenario: () => Promise<void>,
): {
  reload: () => Promise<void>;
} => {
  const reload = async (): Promise<void> => {
    console.warn("🔃 シナリオを再読み込み中...");
    await loadScenario();
    console.warn("✅ シナリオを再読み込みしました");
  };

  return { reload };
};
