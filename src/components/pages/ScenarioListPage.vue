<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useProgressStore } from "@/stores/progressStore";
import ScenarioCard from "./ScenarioCard.vue";
import scenariosIndex from "@/data/scenarios/index.json";

const appStore = useAppStore();
const progressStore = useProgressStore();

// シナリオ一覧を取得
const scenarios = computed(() => {
  if (!appStore.selectedDifficulty) {
    return [];
  }
  const diffData = scenariosIndex.difficulties[appStore.selectedDifficulty];
  return diffData?.scenarios || [];
});

// ページング設定（後で調整可能）
const ITEMS_PER_PAGE = 6;
const currentPage = computed(() => appStore.currentPage);
const totalPages = computed(() =>
  Math.ceil(scenarios.value.length / ITEMS_PER_PAGE),
);

// 現在のページに表示するシナリオ
const displayedScenarios = computed(() => {
  const start = currentPage.value * ITEMS_PER_PAGE;
  return scenarios.value.slice(start, start + ITEMS_PER_PAGE);
});

// ページ変更
const goToPage = (page: number) => {
  if (page < 0 || page >= totalPages.value) {
    return;
  }
  appStore.setPage(page);
};

const nextPage = () => {
  goToPage(currentPage.value + 1);
};

const prevPage = () => {
  goToPage(currentPage.value - 1);
};

// キーボード操作
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "ArrowLeft") {
    prevPage();
  } else if (e.key === "ArrowRight") {
    nextPage();
  }
};

// タッチ操作用
const touchStartX = ref(0);
const touchEndX = ref(0);

const handleTouchStart = (e: TouchEvent) => {
  touchStartX.value = e.touches[0].clientX;
};

const handleTouchEnd = (e: TouchEvent) => {
  touchEndX.value = e.changedTouches[0].clientX;
  const diff = touchStartX.value - touchEndX.value;

  if (Math.abs(diff) > 50) {
    // 50px以上のスワイプで反応
    if (diff > 0) {
      nextPage();
    } // 左スワイプ
    else {
      prevPage();
    } // 右スワイプ
  }
};

// ホイール操作
const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  if (e.deltaY > 0) {
    nextPage();
  } else if (e.deltaY < 0) {
    prevPage();
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

// シナリオ選択
const handleSelectScenario = (scenarioId: string) => {
  appStore.selectScenario(scenarioId);
};

// 戻る
const handleBack = () => {
  appStore.goToDifficulty();
};

// クリア状態チェック
const isCompleted = (scenarioId: string) =>
  progressStore.completedScenarios.includes(scenarioId);
</script>

<template>
  <div
    class="scenario-list-page"
    @touchstart="handleTouchStart"
    @touchend="handleTouchEnd"
    @wheel.passive="handleWheel"
  >
    <button
      class="back-button"
      @click="handleBack"
    >
      ← 戻る
    </button>

    <div class="header">
      <h1 class="title">シナリオ選択</h1>
      <div class="page-indicator">{{ currentPage + 1 }} / {{ totalPages }}</div>
    </div>

    <div class="scenarios-grid">
      <ScenarioCard
        v-for="scenario in displayedScenarios"
        :id="scenario.id"
        :key="scenario.id"
        :title="scenario.title"
        :description="scenario.description"
        :is-completed="isCompleted(scenario.id)"
        @select="handleSelectScenario"
      />
    </div>

    <div class="pagination">
      <button
        class="page-button"
        :disabled="currentPage === 0"
        @click="prevPage"
      >
        ← 前へ
      </button>
      <div class="page-dots">
        <span
          v-for="i in totalPages"
          :key="i"
          class="dot"
          :class="{ active: i - 1 === currentPage }"
          @click="goToPage(i - 1)"
        />
      </div>
      <button
        class="page-button"
        :disabled="currentPage >= totalPages - 1"
        @click="nextPage"
      >
        次へ →
      </button>
    </div>
  </div>
</template>

<style scoped>
.scenario-list-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  padding: var(--size-32);
  position: relative;
  overflow: hidden;
}

.back-button {
  position: absolute;
  top: var(--size-32);
  left: var(--size-32);
  padding: var(--size-12) var(--size-24);
  background: rgba(255, 255, 255, 0.9);
  border: var(--size-2) solid #ddd;
  border-radius: var(--size-8);
  cursor: pointer;
  font-size: var(--size-16);
  font-weight: bold;
  transition: all 0.2s ease;
  z-index: 10;
}

.back-button:hover {
  background: white;
  border-color: #999;
  transform: translateX(calc(-1 * var(--size-5)));
}

.header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-32);
  margin-bottom: var(--size-32);
}

.title {
  font-size: var(--size-32);
  font-weight: bold;
  color: #333;
  margin: 0;
}

.page-indicator {
  font-size: var(--size-20);
  color: #666;
  background: rgba(255, 255, 255, 0.8);
  padding: var(--size-8) var(--size-16);
  border-radius: var(--size-8);
  font-weight: bold;
}

.scenarios-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--size-350), 1fr));
  gap: var(--size-24);
  overflow-y: auto;
  padding: var(--size-16);
}

.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--size-32);
  margin-top: var(--size-32);
}

.page-button {
  padding: var(--size-12) var(--size-24);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: var(--size-8);
  font-size: var(--size-16);
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
}

.page-button:hover:not(:disabled) {
  transform: scale(1.05);
  box-shadow: 0 var(--size-5) var(--size-12) rgba(102, 126, 234, 0.4);
}

.page-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  background: #ccc;
}

.page-dots {
  display: flex;
  gap: var(--size-8);
}

.dot {
  width: var(--size-12);
  height: var(--size-12);
  border-radius: 50%;
  background: #ddd;
  cursor: pointer;
  transition: all 0.2s ease;
}

.dot.active {
  background: #667eea;
  transform: scale(1.3);
}

.dot:hover {
  background: #999;
}
</style>
