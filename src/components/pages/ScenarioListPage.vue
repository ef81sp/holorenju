<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, TransitionGroup } from "vue";
import { useAppStore } from "@/stores/appStore";
import { useProgressStore } from "@/stores/progressStore";
import ScenarioCard from "./ScenarioCard.vue";
import PageHeader from "@/components/common/PageHeader.vue";
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

// ページ遷移方向
const direction = ref<'next' | 'prev'>('next');

// 現在のページに表示するシナリオ（絶対番号付き）
const displayedScenarios = computed(() => {
  const start = currentPage.value * ITEMS_PER_PAGE;
  return scenarios.value
    .slice(start, start + ITEMS_PER_PAGE)
    .map((scenario, index) => ({
      ...scenario,
      absoluteIndex: start + index + 1,
    }));
});

// ページ変更
const goToPage = (page: number) => {
  if (page < 0 || page >= totalPages.value) {
    return;
  }
  appStore.setPage(page);
};

const nextPage = () => {
  direction.value = 'next';
  goToPage(currentPage.value + 1);
};

const prevPage = () => {
  direction.value = 'prev';
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
    <PageHeader
      title="シナリオ選択"
      show-back
      @back="handleBack"
    >
      <template #right>
        <div class="page-indicator">
          {{ currentPage + 1 }} / {{ totalPages }}
        </div>
      </template>
    </PageHeader>

    <div class="content">
      <button
        class="page-button page-button-left"
        :disabled="currentPage === 0"
        :aria-label="`前へ（ページ${currentPage}/${totalPages}）`"
        @click="prevPage"
      >
        ←
      </button>

      <TransitionGroup
        :name="`slide-${direction}`"
        tag="div"
        class="scenarios-grid"
      >
        <ScenarioCard
          v-for="scenario in displayedScenarios"
          :id="scenario.id"
          :key="scenario.id + currentPage"
          :title="scenario.title"
          :description="scenario.description"
          :is-completed="isCompleted(scenario.id)"
          :scenario-index="scenario.absoluteIndex"
          @select="handleSelectScenario"
        />
      </TransitionGroup>

      <button
        class="page-button page-button-right"
        :disabled="currentPage === totalPages - 1"
        :aria-label="`次へ（ページ${currentPage + 2}/${totalPages}）`"
        @click="nextPage"
      >
        →
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
  padding: var(--size-40) var(--size-20);
  box-sizing: border-box;
}

.page-indicator {
  font-size: var(--size-20);
  color: #666;
  background: rgba(255, 255, 255, 0.8);
  padding: var(--size-8) var(--size-16);
  border-radius: var(--size-8);
  font-weight: bold;
}

.content {
  flex: 1;
  display: grid;
  grid-template-columns: var(--size-80) 1fr var(--size-80);
  gap: var(--size-20);
  align-items: center;
  padding-block: var(--size-16);
}

.scenarios-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--size-20);
  align-content: start;
  height: calc(var(--size-180) * 2 + var(--size-20));
}

/* 次へ（右から左） */
.slide-next-enter-active,
.slide-next-leave-active,
.slide-next-move {
  transition: all 0.2s ease-in-out;
}

.slide-next-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.slide-next-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

/* 戻る（左から右） */
.slide-prev-enter-active,
.slide-prev-leave-active,
.slide-prev-move {
  transition: all 0.2s ease-in-out;
}

.slide-prev-enter-from {
  opacity: 0;
  transform: translateX(-100%);
}

.slide-prev-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.page-button {
  width: var(--size-80);
  height: var(--size-80);
  background: var(--gradient-main);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: var(--size-40);
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-button:hover:not(:disabled) {
  opacity: 0.9;
  box-shadow: 0 var(--size-5) var(--size-12) rgba(102, 126, 234, 0.4);
  transform: scale(1.1);
}

.page-button:disabled {
  opacity: 0.2;
  cursor: not-allowed;
  background: #ccc;
}

.page-button-left {
  justify-self: center;
}

.page-button-right {
  justify-self: center;
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
