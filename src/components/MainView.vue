<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAppStore, type AppState } from "@/stores/appStore";
import MenuPage from "./pages/MenuPage.vue";
import DifficultyPage from "./pages/DifficultyPage.vue";
import ScenarioListPage from "./pages/ScenarioListPage.vue";
import ScenarioPlayer from "./scenarios/ScenarioPlayer.vue";
// oxlint-disable-next-line consistent-type-imports
import ConfirmDialog from "./common/ConfirmDialog.vue";

const appStore = useAppStore();
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

const currentScene = computed(() => appStore.scene);
const selectedScenarioId = computed(() => appStore.selectedScenarioId);

// 戻る確認用の状態
const pendingPopState = ref<AppState | null>(null);

// ブラウザの戻る・進むボタン処理
const handlePopState = (event: PopStateEvent): void => {
  const state = event.state as AppState | null;

  // シナリオプレイ中の場合は確認ダイアログを表示
  if (currentScene.value === "scenarioPlay") {
    event.preventDefault();
    pendingPopState.value = state;
    confirmDialogRef.value?.showModal();
    return;
  }

  // それ以外のシーンでは直接状態を復元
  if (state) {
    appStore.restoreState(state);
  }
};

// 確認ダイアログの確認処理
const handleConfirmBack = (): void => {
  if (pendingPopState.value) {
    appStore.restoreState(pendingPopState.value);
  }
  pendingPopState.value = null;
};

// 確認ダイアログのキャンセル処理
const handleCancelBack = (): void => {
  // 履歴を進めて元に戻す
  window.history.pushState(
    {
      scene: appStore.scene,
      selectedMode: appStore.selectedMode,
      selectedDifficulty: appStore.selectedDifficulty,
      currentPage: appStore.currentPage,
      selectedScenarioId: appStore.selectedScenarioId,
    } as AppState,
    "",
    `#${appStore.scene}`,
  );
  pendingPopState.value = null;
};

onMounted(() => {
  window.addEventListener("popstate", handlePopState);

  // 初回の履歴状態を設定
  appStore.pushHistory();
});

onUnmounted(() => {
  window.removeEventListener("popstate", handlePopState);
});
</script>

<template>
  <div class="main-container">
    <MenuPage v-if="currentScene === 'menu'" />
    <DifficultyPage v-else-if="currentScene === 'difficulty'" />
    <ScenarioListPage v-else-if="currentScene === 'scenarioList'" />
    <ScenarioPlayer
      v-else-if="currentScene === 'scenarioPlay' && selectedScenarioId"
      :scenario-id="selectedScenarioId"
    />

    <!-- 戻る確認ダイアログ -->
    <ConfirmDialog
      ref="confirmDialogRef"
      title="シナリオを中断しますか？"
      message="シナリオをリセットして、一覧に戻ります。"
      confirm-text="戻る"
      cancel-text="続ける"
      @confirm="handleConfirmBack"
      @cancel="handleCancelBack"
    />
  </div>
</template>

<style scoped>
.main-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
