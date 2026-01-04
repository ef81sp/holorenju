<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import scenariosIndex from "@/data/scenarios/index.json";

interface ScenarioItem {
  id: string;
  title: string;
  description: string;
  path: string;
}

interface DifficultySection {
  difficulty: string;
  label: string;
  scenarios: ScenarioItem[];
}

const emit = defineEmits<{
  selected: [path: string];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);

// State
const allDifficulties = computed(() => {
  const difficulties: DifficultySection[] = [];

  // 難易度ごとにデータを構築
  for (const [difficulty, data] of Object.entries(
    scenariosIndex.difficulties,
  )) {
    const typedData = data as {
      label: string;
      scenarios: {
        id: string;
        title: string;
        description: string;
        path: string;
      }[];
    };
    if (typedData.scenarios.length > 0) {
      difficulties.push({
        difficulty,
        label: typedData.label || difficulty,
        scenarios: typedData.scenarios,
      });
    }
  }

  return difficulties;
});

const handleSelect = (path: string): void => {
  emit("selected", path);
  dialogRef.value?.close();
};

const handleClose = (): void => {
  dialogRef.value?.close();
};

defineExpose({
  showModal: () => dialogRef.value?.showModal(),
  close: () => dialogRef.value?.close(),
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="file-list-dialog"
  >
    <div class="dialog-inner">
      <div class="dialog-header">
        <h2>シナリオを選択</h2>
        <button
          type="button"
          class="close-btn"
          aria-label="ダイアログを閉じる"
          @click="handleClose"
        >
          ✕
        </button>
      </div>

      <div class="dialog-content">
        <div
          v-for="difficulty in allDifficulties"
          :key="difficulty.difficulty"
          class="difficulty-section"
        >
          <h3 class="difficulty-title">{{ difficulty.label }}</h3>
          <ul class="scenario-list">
            <li
              v-for="scenario in difficulty.scenarios"
              :key="scenario.id"
            >
              <button
                class="scenario-item"
                @click="handleSelect(scenario.path)"
              >
                <span class="scenario-title">{{ scenario.title }}</span>
                <span class="scenario-description">{{
                  scenario.description
                }}</span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.file-list-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  border: none;
  border-radius: var(--size-12);
  padding: 0;
  box-shadow: 0 var(--size-10) var(--size-32) rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 700px;
  max-height: 85vh;

  transition:
    opacity 0.15s ease-out,
    transform 0.15s ease-out,
    overlay 0.15s ease-out allow-discrete,
    display 0.15s ease-out allow-discrete;

  &[open] {
    opacity: 1;

    @starting-style {
      opacity: 0;
    }
  }

  &::backdrop {
    background-color: rgba(0, 0, 0, 0.5);
    transition: background-color 0.15s ease-out allow-discrete;

    @starting-style {
      background-color: rgba(0, 0, 0, 0);
    }
  }
}

.dialog-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-5) var(--size-6);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.dialog-header h2 {
  margin: 0;
  font-size: var(--size-14);
  font-weight: 500;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: var(--size-16);
  color: var(--color-text-secondary);
  padding: 0;
  width: var(--size-24);
  height: var(--size-24);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.close-btn:hover {
  background-color: var(--color-bg-gray);
  color: var(--color-text);
}

.dialog-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--size-4);
}

.difficulty-section {
  margin-bottom: var(--size-5);
}

.difficulty-title {
  margin: 0 0 var(--size-2) 0;
  font-size: var(--size-12);
  font-weight: 500;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.scenario-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
  list-style: none;
  margin: 0;
  padding: 0;
}

.scenario-list li {
  margin: 0;
  padding: 0;
}

.scenario-item {
  padding: var(--size-3) var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  background-color: white;
  display: flex;
  align-items: center;
  gap: var(--size-3);
  font-size: var(--size-12);
  width: 100%;
  text-align: left;
  font-family: inherit;
  font-weight: inherit;
  color: inherit;
}

.scenario-item:hover {
  background-color: var(--color-bg-gray);
  border-color: #4a90e2;
}

.scenario-title {
  font-weight: 500;
  color: var(--color-text);
  font-size: var(--size-12);
  white-space: nowrap;
  flex-shrink: 0;
}

.scenario-description {
  font-size: var(--size-11);
  color: var(--color-text-secondary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
