<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, Transition, watch } from "vue";
import { useAppStore, type AppState, type Scene } from "@/stores/appStore";
import { APP_NAME, SCENE_TITLES } from "@/constants/sceneTitles";
import MenuPage from "./pages/MenuPage.vue";
import DifficultyPage from "./pages/DifficultyPage.vue";
import ScenarioListPage from "./pages/ScenarioListPage.vue";
import { ScenarioPlayer } from "./scenarios/ScenarioPlayer";
// oxlint-disable-next-line consistent-type-imports
import ConfirmDialog from "./common/ConfirmDialog.vue";
import CpuSetupPage from "./cpu/CpuSetupPage.vue";
import CpuGamePlayer from "./cpu/CpuGamePlayer.vue";
import CpuReviewPlayer from "./cpu/CpuReviewPlayer.vue";

const appStore = useAppStore();
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

const currentScene = computed(() => appStore.scene);
const selectedScenarioId = computed(() => appStore.selectedScenarioId);
const transitionName = computed(() =>
  appStore.transitionDirection === "back"
    ? "scale-fade-back"
    : "scale-fade-forward",
);

// --- 確認ダイアログの Promise 化 ---
let pendingResolve: ((value: boolean) => void) | null = null;

function showConfirmDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    pendingResolve = resolve;
    confirmDialogRef.value?.showModal();
  });
}

const handleConfirmBack = (): void => {
  pendingResolve?.(true);
  pendingResolve = null;
};

const handleCancelBack = (): void => {
  pendingResolve?.(false);
  pendingResolve = null;
};

function isGameScene(): boolean {
  return (
    currentScene.value === "scenarioPlay" || currentScene.value === "cpuPlay"
  );
}

// --- Navigation API ハンドラー ---
const handleNavigate = (event: NavigateEvent): void => {
  // 戻る/進む（traverse）のみ処理。push は appStore のアクションが処理済み
  if (event.navigationType !== "traverse" || !event.canIntercept) {
    return;
  }

  event.intercept({
    focusReset: "manual",
    async handler() {
      const state = event.destination.getState() as AppState | null;

      // ゲーム中は確認ダイアログ
      if (isGameScene()) {
        const confirmed = await showConfirmDialog();
        if (!confirmed) {
          // 現在のシーンに戻す（traverseはキャンセル不可のため新規pushで対応）
          appStore.pushHistory();
          return;
        }
      }

      if (state) {
        appStore.restoreState(state);
      }
    },
  });
};

// --- popstate フォールバック ---
const pendingPopState = ref<AppState | null>(null);

const handlePopState = (event: PopStateEvent): void => {
  const state = event.state as AppState | null;

  if (isGameScene()) {
    event.preventDefault();
    pendingPopState.value = state;
    showConfirmDialog().then((confirmed) => {
      if (confirmed && pendingPopState.value) {
        appStore.restoreState(pendingPopState.value);
      } else if (!confirmed) {
        appStore.pushHistory();
      }
      pendingPopState.value = null;
    });
    return;
  }

  if (state) {
    appStore.restoreState(state);
  }
};

// トランジション完了後にフォーカスを移動
const GAME_SCENES: Scene[] = ["scenarioPlay", "cpuPlay", "cpuReview"];

const handleAfterEnter = (el: Element): void => {
  // ゲーム画面は各コンポーネントがボードフォーカスを管理するので介入しない
  if (GAME_SCENES.includes(currentScene.value)) {
    return;
  }

  const heading = (el as HTMLElement).querySelector("h1");
  heading?.focus({ preventScroll: true });
};

// document.title を現在のシーンに連動して更新
watch(
  currentScene,
  (scene) => {
    document.title = `${SCENE_TITLES[scene]} - ${APP_NAME}`;
  },
  { immediate: true },
);

onMounted(() => {
  if (window.navigation) {
    window.navigation.addEventListener("navigate", handleNavigate);
  } else {
    window.addEventListener("popstate", handlePopState);
  }

  // リロードやハッシュ直指定からの復元を試みる
  if (!appStore.tryRestoreFromBrowser()) {
    appStore.pushHistory();
  }
});

onUnmounted(() => {
  if (window.navigation) {
    window.navigation.removeEventListener("navigate", handleNavigate);
  } else {
    window.removeEventListener("popstate", handlePopState);
  }
});
</script>

<template>
  <main class="main-container">
    <Transition
      :name="transitionName"
      @after-enter="handleAfterEnter"
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
      <CpuReviewPlayer v-else-if="currentScene === 'cpuReview'" />
    </Transition>
  </main>

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
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 遷移中は両コンポーネントを重ねて表示（mode="out-in" 不使用のため） */
.scale-fade-forward-leave-active,
.scale-fade-back-leave-active {
  position: absolute;
  inset: 0;
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
