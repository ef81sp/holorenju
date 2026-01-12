<script setup lang="ts">
import { DIFFICULTY_LABELS } from "@/editor/logic/indexFileHandler";
import { useEditorStore } from "@/editor/stores/editorStore";
import { DIFFICULTIES } from "@/types/scenario";

const editorStore = useEditorStore();

const difficultyOptions = DIFFICULTIES.map((difficulty) => ({
  value: difficulty,
  label: DIFFICULTY_LABELS[difficulty],
}));

// Methods
const updateScenarioInfo = (key: string, value: unknown): void => {
  editorStore.updateScenarioInfo({
    [key]: value,
  } as Parameters<typeof editorStore.updateScenarioInfo>[0]);
};

const addObjective = (): void => {
  const newObjectives = [...editorStore.scenario.objectives, ""];
  updateScenarioInfo("objectives", newObjectives);
};

const removeObjective = (index: number): void => {
  const newObjectives = editorStore.scenario.objectives.filter(
    (_, i) => i !== index,
  );
  updateScenarioInfo("objectives", newObjectives);
};

const updateObjective = (index: number, value: string): void => {
  const newObjectives = [...editorStore.scenario.objectives];
  newObjectives[index] = value;
  updateScenarioInfo("objectives", newObjectives);
};
</script>

<template>
  <form class="scenario-form">
    <!-- ID (自動採番、編集不可) -->
    <div class="form-group">
      <label for="scenario-id">ID (自動採番)</label>
      <input
        id="scenario-id"
        type="text"
        :value="editorStore.scenario.id"
        readonly
        class="form-input"
        style="background-color: var(--color-bg-secondary); cursor: not-allowed"
      />
    </div>

    <!-- Title -->
    <div class="form-group">
      <label for="scenario-title">タイトル</label>
      <input
        id="scenario-title"
        type="text"
        :value="editorStore.scenario.title"
        class="form-input"
        @input="
          (e) =>
            updateScenarioInfo('title', (e.target as HTMLInputElement).value)
        "
      />
    </div>

    <!-- Difficulty -->
    <div class="form-group">
      <label for="scenario-difficulty">難易度</label>
      <select
        id="scenario-difficulty"
        :value="editorStore.scenario.difficulty"
        class="form-input"
        @change="
          (e) =>
            updateScenarioInfo(
              'difficulty',
              (e.target as HTMLSelectElement).value,
            )
        "
      >
        <option
          v-for="option in difficultyOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </div>

    <!-- Description -->
    <div class="form-group">
      <label for="scenario-description">説明</label>
      <textarea
        id="scenario-description"
        :value="editorStore.scenario.description"
        class="form-textarea"
        rows="4"
        @input="
          (e) =>
            updateScenarioInfo(
              'description',
              (e.target as HTMLTextAreaElement).value,
            )
        "
      />
    </div>

    <!-- Objectives -->
    <div class="form-group">
      <label>目標 (Objectives)</label>
      <div class="objectives-list">
        <div
          v-for="(objective, index) in editorStore.scenario.objectives"
          :key="index"
          class="objective-item"
        >
          <input
            type="text"
            :value="objective"
            class="form-input"
            placeholder="目標を入力"
            @input="
              (e) =>
                updateObjective(index, (e.target as HTMLInputElement).value)
            "
          />
          <button
            class="btn-remove"
            @click="removeObjective(index)"
          >
            ✕
          </button>
        </div>
      </div>
      <button
        type="button"
        class="btn-add"
        @click="addObjective"
      >
        + 目標を追加
      </button>
    </div>
  </form>
</template>

<style scoped>
.scenario-form {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.form-group label {
  font-weight: 600;
  font-size: var(--size-12);
  color: var(--color-text);
}

.form-input,
.form-textarea {
  padding: var(--size-2);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  font-size: var(--size-12);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: #4a90e2;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.05);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.objectives-list {
  display: flex;
  flex-direction: column;
  gap: var(--size-2);
}

.objective-item {
  display: flex;
  gap: var(--size-2);
  align-items: center;
}

.objective-item .form-input {
  flex: 1;
}

.btn-remove {
  padding: var(--size-2) var(--size-5);
  background-color: #ff6b6b;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-10);
  transition: opacity 0.2s;
}

.btn-remove:hover {
  opacity: 0.8;
}

.btn-add {
  padding: var(--size-2) var(--size-6);
  background-color: #4a90e2;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-12);
  transition: opacity 0.2s;
  align-self: flex-start;
}

.btn-add:hover {
  opacity: 0.9;
}
</style>
