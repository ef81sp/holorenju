<script setup lang="ts">
import { ref, computed } from "vue";

import { DIFFICULTY_LABELS } from "@/editor/logic/indexFileHandler";
import { DIFFICULTIES, type ScenarioDifficulty } from "@/types/scenario";

interface ScenarioItem {
  id: string;
  title: string;
  description: string;
  path: string;
}

type ReorderState = Partial<Record<ScenarioDifficulty, ScenarioItem[]>>;

interface Props {
  currentData: {
    difficulties: Record<
      ScenarioDifficulty,
      {
        label: string;
        scenarios: ScenarioItem[];
      }
    >;
  };
  dirHandle: FileSystemDirectoryHandle;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  confirm: [data: Record<ScenarioDifficulty, string[]>];
  cancel: [];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const state = ref<ReorderState>({});
const draggedItem = ref<{
  difficulty: ScenarioDifficulty;
  index: number;
} | null>(null);
const difficulties = DIFFICULTIES;

// Props から初期状態を計算
const initializeState = async (): Promise<void> => {
  const newState: ReorderState = difficulties.reduce((acc, difficulty) => {
    const scenarios = props.currentData.difficulties[difficulty]?.scenarios;
    acc[difficulty] = scenarios ? [...scenarios] : [];
    return acc;
  }, {} as ReorderState);

  // ファイルシステムから新規シナリオを検出して末尾に追加
  await Promise.all(
    difficulties.map(async (difficulty) => {
      try {
        const diffDir = await props.dirHandle.getDirectoryHandle(difficulty, {
          create: false,
        });
        const fileIds = new Set<string>();
        const entries: [string, FileSystemFileHandle][] = [];

        // @ts-expect-error entries は存在するはず
        for await (const [name, handle] of diffDir.entries()) {
          if (name.endsWith(".json") && handle.kind === "file") {
            entries.push([name, handle as FileSystemFileHandle]);
          }
        }

        // エントリーを順次処理
        await Promise.all(
          entries.map(async ([name, handle]) => {
            const file = await handle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.id || !data.title || !data.description) {
              return;
            }

            fileIds.add(data.id);

            // 既に存在するかチェック
            const exists = newState[difficulty]?.some((s) => s.id === data.id);
            if (exists) {
              return;
            }

            // 新規ファイルを末尾に追加
            if (!newState[difficulty]) {
              newState[difficulty] = [];
            }
            newState[difficulty]?.push({
              id: data.id,
              title: data.title,
              description: data.description,
              path: `${difficulty}/${name}`,
            });
          }),
        );

        // ファイルが削除されたシナリオを除去
        if (newState[difficulty]) {
          newState[difficulty] = newState[difficulty]?.filter((s) =>
            fileIds.has(s.id),
          );
        }
      } catch {
        // ディレクトリが存在しない場合はスキップ
        console.warn(`難易度ディレクトリ '${difficulty}' が見つかりません`);
      }
    }),
  );

  state.value = newState;
};

// 新規追加されたシナリオを検出
const hasNewScenarios = computed(() =>
  difficulties.some((difficulty) => {
    const scenarios = state.value[difficulty] ?? [];
    const currentIds =
      props.currentData.difficulties[difficulty]?.scenarios.map((s) => s.id) ??
      [];
    return scenarios.some((scenario) => !currentIds.includes(scenario.id));
  }),
);

const onDragStart = (difficulty: ScenarioDifficulty, index: number): void => {
  draggedItem.value = { difficulty, index };
};

const onDragOver = (e: DragEvent): void => {
  e.preventDefault();
};

const onDrop = (difficulty: ScenarioDifficulty, targetIndex: number): void => {
  if (!draggedItem.value) {
    return;
  }

  const { difficulty: srcDifficulty, index: srcIndex } = draggedItem.value;

  // 同じ難易度内での並び替え
  if (srcDifficulty === difficulty) {
    const items = [...(state.value[difficulty] ?? [])];
    const [item] = items.splice(srcIndex, 1);
    items.splice(targetIndex, 0, item);
    state.value[difficulty] = items;
  }

  draggedItem.value = null;
};

const moveUp = (difficulty: ScenarioDifficulty, index: number): void => {
  if (index === 0) {
    return;
  }
  const items = [...(state.value[difficulty] ?? [])];
  [items[index], items[index - 1]] = [items[index - 1], items[index]];
  state.value[difficulty] = items;
};

const moveDown = (difficulty: ScenarioDifficulty, index: number): void => {
  const items = state.value[difficulty] ?? [];
  if (index === items.length - 1) {
    return;
  }
  const itemsCopy = [...items];
  [itemsCopy[index], itemsCopy[index + 1]] = [
    itemsCopy[index + 1],
    itemsCopy[index],
  ];
  state.value[difficulty] = itemsCopy;
};

const handleConfirm = (): void => {
  // 現在のstate から ID の配列を構築
  const result = DIFFICULTIES.reduce(
    (acc, difficulty) => {
      acc[difficulty] = (state.value[difficulty] ?? []).map((s) => s.id);
      return acc;
    },
    {} as Record<ScenarioDifficulty, string[]>,
  );
  emit("confirm", result);
  dialogRef.value?.close();
};

const handleCancel = (): void => {
  emit("cancel");
  dialogRef.value?.close();
};

// 外部から開く用メソッド
const showModal = (): void => {
  initializeState().catch((error) => {
    console.error("Failed to initialize state:", error);
  });
  dialogRef.value?.showModal();
};

defineExpose({
  showModal,
});
</script>

<template>
  <dialog
    ref="dialogRef"
    class="scenario-reorder-dialog"
  >
    <div class="dialog-content">
      <h2>シナリオの並び順を設定</h2>

      <div
        v-if="hasNewScenarios"
        class="notification"
      >
        <p>✨ 新しいシナリオが検出されました（末尾に追加済み）</p>
      </div>

      <div class="difficulties-container">
        <div
          v-for="difficulty in difficulties"
          :key="difficulty"
          class="difficulty-section"
        >
          <h3>
            {{
              props.currentData.difficulties[difficulty]?.label ??
              DIFFICULTY_LABELS[difficulty]
            }}
          </h3>

          <div
            v-if="(state[difficulty] ?? []).length === 0"
            class="empty-message"
          >
            シナリオがありません
          </div>

          <ul
            v-else
            class="scenarios-list"
          >
            <li
              v-for="(scenario, index) in state[difficulty]"
              :key="scenario.id"
              draggable="true"
              :class="{
                'is-new': !props.currentData.difficulties[
                  difficulty
                ]?.scenarios.some((s) => s.id === scenario.id),
              }"
              @dragstart="onDragStart(difficulty, index)"
              @dragover="onDragOver"
              @drop="onDrop(difficulty, index)"
            >
              <div class="scenario-item">
                <div class="scenario-info">
                  <div class="scenario-title">{{ scenario.title }}</div>
                  <div class="scenario-description">
                    {{ scenario.description }}
                  </div>
                </div>
                <div class="scenario-controls">
                  <button
                    :disabled="index === 0"
                    title="上へ移動"
                    @click="moveUp(difficulty, index)"
                  >
                    ↑
                  </button>
                  <button
                    :disabled="index === (state[difficulty] ?? []).length - 1"
                    title="下へ移動"
                    @click="moveDown(difficulty, index)"
                  >
                    ↓
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div class="dialog-controls">
        <button
          class="btn-secondary"
          @click="handleCancel"
        >
          キャンセル
        </button>
        <button
          class="btn-primary"
          @click="handleConfirm"
        >
          再生成
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.scenario-reorder-dialog {
  width: var(--dialog-width);
  max-height: 80vh;
  padding: 0;
  border: none;
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  margin: auto;
}

.scenario-reorder-dialog::backdrop {
  background-color: rgba(0, 0, 0, 0.5);
}

.scenario-reorder-dialog[open] {
  animation: dialog-in 0.15s ease-out;
}

@keyframes dialog-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.dialog-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--spacing-lg);
  gap: var(--spacing-md);
  overflow: hidden;
}

h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 500;
}

.notification {
  padding: var(--spacing-md);
  background-color: #f0f7ff;
  border-left: 3px solid var(--color-holo-cyan);
  border-radius: 4px;
}

.notification p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-primary);
}

.difficulties-container {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.difficulty-section {
  display: flex;
  flex-direction: column;
}

.difficulty-section h3 {
  margin: 0 0 var(--spacing-sm) 0;
  font-size: 1rem;
  font-weight: 500;
}

.empty-message {
  padding: var(--spacing-md);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.9rem;
}

.scenarios-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.scenarios-list li {
  background: var(--color-bg-white);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: var(--spacing-md);
  cursor: grab;
  user-select: none;
  transition: all 0.2s ease;
}

.scenarios-list li:active {
  cursor: grabbing;
  opacity: 0.7;
}

.scenarios-list li.is-new {
  border-color: var(--color-holo-cyan);
  background-color: var(--color-fubuki-bg-light);
}

.scenario-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--spacing-md);
}

.scenario-info {
  flex: 1;
  min-width: 0;
}

.scenario-title {
  font-weight: 500;
  color: var(--color-text-primary);
  word-break: break-word;
}

.scenario-description {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-top: 0.25rem;
  word-break: break-word;
}

.scenario-controls {
  display: flex;
  gap: var(--spacing-sm);
  flex-shrink: 0;
}

.scenario-controls button {
  padding: 0.25rem 0.5rem;
  background: var(--color-bg-white);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s ease;
}

.scenario-controls button:hover:not(:disabled) {
  background-color: var(--color-holo-cyan);
  color: var(--color-text-primary);
}

.scenario-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dialog-controls {
  display: flex;
  gap: var(--spacing-md);
  justify-content: flex-end;
  margin-top: var(--spacing-md);
}

.btn-primary,
.btn-secondary {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-primary {
  background-color: var(--color-holo-cyan);
  color: var(--color-text-primary);
}

.btn-primary:hover {
  opacity: 0.8;
}

.btn-secondary {
  background-color: var(--color-bg-white);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background-color: var(--color-bg-gray);
}
</style>
