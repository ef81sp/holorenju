<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, Transition } from "vue";
import { useAppStore, type AppState } from "@/stores/appStore";
import MenuPage from "./pages/MenuPage.vue";
import DifficultyPage from "./pages/DifficultyPage.vue";
import ScenarioListPage from "./pages/ScenarioListPage.vue";
import { ScenarioPlayer } from "./scenarios/ScenarioPlayer";
// oxlint-disable-next-line consistent-type-imports
import ConfirmDialog from "./common/ConfirmDialog.vue";
import ScenarioEditor from "@/editor/components/ScenarioEditor.vue";
import CpuSetupPage from "./cpu/CpuSetupPage.vue";
import CpuGamePlayer from "./cpu/CpuGamePlayer.vue";

const appStore = useAppStore();
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

const currentScene = computed(() => appStore.scene);
const selectedScenarioId = computed(() => appStore.selectedScenarioId);
const transitionName = computed(() =>
  appStore.transitionDirection === "back"
    ? "scale-fade-back"
    : "scale-fade-forward",
);

// 戻る確認用の状態
const pendingPopState = ref<AppState | null>(null);

// ブラウザの戻る・進むボタン処理
const handlePopState = (event: PopStateEvent): void => {
  const state = event.state as AppState | null;

  // シナリオプレイ中またはCPU対戦中の場合は確認ダイアログを表示
  if (
    currentScene.value === "scenarioPlay" ||
    currentScene.value === "cpuPlay"
  ) {
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
      cpuDifficulty: appStore.cpuDifficulty,
      cpuPlayerFirst: appStore.cpuPlayerFirst,
      reviewRecordId: appStore.reviewRecordId,
    } satisfies AppState,
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
    <Transition
      :name="transitionName"
      mode="out-in"
    >
      <MenuPage v-if="currentScene === 'menu'" />
      <DifficultyPage v-else-if="currentScene === 'difficulty'" />
      <ScenarioListPage v-else-if="currentScene === 'scenarioList'" />
      <ScenarioPlayer
        v-else-if="currentScene === 'scenarioPlay' && selectedScenarioId"
        :scenario-id="selectedScenarioId"
      />
      <CpuSetupPage v-else-if="currentScene === 'cpuSetup'" />
      <CpuGamePlayer v-else-if="currentScene === 'cpuPlay'" />
      <ScenarioEditor v-else-if="currentScene === 'editor'" />
    </Transition>
  </div>

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
</template>

<style scoped>
.main-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 前進アニメーション（拡大して退場） */
.scale-fade-forward-enter-active,
.scale-fade-forward-leave-active {
  transition:
    opacity 0.15s ease-out 0.05s,
    transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) 0.05s;
}

.scale-fade-forward-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.scale-fade-forward-enter-to {
  opacity: 1;
  transform: scale(1);
}

.scale-fade-forward-leave-from {
  opacity: 1;
  transform: scale(1);
}

.scale-fade-forward-leave-to {
  opacity: 0;
  transform: scale(1.1);
}

/* 後退アニメーション（縮小して退場） */
.scale-fade-back-enter-active,
.scale-fade-back-leave-active {
  transition:
    opacity 0.15s ease-out 0.05s,
    transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) 0.05s;
}

.scale-fade-back-enter-from {
  opacity: 0;
  transform: scale(1.1);
}

.scale-fade-back-enter-to {
  opacity: 1;
  transform: scale(1);
}

.scale-fade-back-leave-from {
  opacity: 1;
  transform: scale(1);
}

.scale-fade-back-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
