<script setup lang="ts">
import { ref, watch } from "vue";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import { regenerateScenarioIndex } from "@/editor/logic/indexFileHandler";
import type { ScenarioDifficulty } from "@/types/scenario";

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

interface Props {
  dirHandle: FileSystemDirectoryHandle | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  selected: [path: string];
  deleted: [scenarioId: string];
}>();

const dialogRef = ref<HTMLDialogElement | null>(null);
const confirmDialogRef = ref<InstanceType<typeof ConfirmDialog> | null>(null);

// State
const allDifficulties = ref<DifficultySection[]>([]);
const pendingDeleteScenario = ref<{
  scenario: ScenarioItem;
  difficulty: string;
} | null>(null);
const isDeleting = ref(false);

// index.jsonを動的に読み込む
const loadIndexFromDirectory = async (): Promise<void> => {
  if (!props.dirHandle) {
    allDifficulties.value = [];
    return;
  }

  try {
    const indexHandle = await props.dirHandle.getFileHandle("index.json");
    const file = await indexHandle.getFile();
    const text = await file.text();
    const indexData = JSON.parse(text) as {
      difficulties: Record<
        string,
        {
          label: string;
          scenarios: ScenarioItem[];
        }
      >;
    };

    const difficulties: DifficultySection[] = [];
    for (const [difficulty, data] of Object.entries(indexData.difficulties)) {
      if (data.scenarios.length > 0) {
        difficulties.push({
          difficulty,
          label: data.label || difficulty,
          scenarios: data.scenarios,
        });
      }
    }
    allDifficulties.value = difficulties;
  } catch (error) {
    console.warn("index.jsonの読み込みに失敗:", error);
    allDifficulties.value = [];
  }
};

// ダイアログが開かれた時にindex.jsonを再読み込み
watch(dialogRef, (dialog) => {
  if (dialog) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === "open" && dialog.hasAttribute("open")) {
          loadIndexFromDirectory();
        }
      }
    });
    observer.observe(dialog, { attributes: true });
  }
});

const handleSelect = (path: string): void => {
  emit("selected", path);
  dialogRef.value?.close();
};

const handleClose = (): void => {
  dialogRef.value?.close();
};

// 削除ボタンがクリックされた時
const handleDeleteClick = (
  scenario: ScenarioItem,
  difficulty: string,
  event: MouseEvent,
): void => {
  event.stopPropagation();
  pendingDeleteScenario.value = { scenario, difficulty };
  confirmDialogRef.value?.showModal();
};

// 削除確認ダイアログでキャンセルされた時
const handleDeleteCancel = (): void => {
  pendingDeleteScenario.value = null;
};

// 削除確認ダイアログで確認された時
const handleDeleteConfirm = async (): Promise<void> => {
  if (!pendingDeleteScenario.value || !props.dirHandle) {
    return;
  }

  const { scenario, difficulty } = pendingDeleteScenario.value;
  isDeleting.value = true;

  try {
    // ファイル名をパスから取得
    const fileName = scenario.path.split("/").pop();
    if (!fileName) {
      throw new Error("ファイル名が取得できません");
    }

    // 難易度ディレクトリのハンドルを取得
    const diffDir = await props.dirHandle.getDirectoryHandle(
      difficulty as ScenarioDifficulty,
    );

    // ファイルを削除
    await diffDir.removeEntry(fileName);
    console.warn(`🗑️ ファイルを削除しました: ${scenario.path}`);

    // index.jsonを再生成
    await regenerateScenarioIndex(props.dirHandle, null);

    // 親コンポーネントに削除を通知
    emit("deleted", scenario.id);

    // リストを再読み込み
    await loadIndexFromDirectory();
  } catch (error) {
    console.error("ファイルの削除に失敗しました:", error);

    alert(`ファイルの削除に失敗しました: ${(error as Error).message}`);
  } finally {
    isDeleting.value = false;
    pendingDeleteScenario.value = null;
  }
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
              <div class="scenario-row">
                <button
                  class="scenario-item"
                  @click="handleSelect(scenario.path)"
                >
                  <span class="scenario-title">{{ scenario.title }}</span>
                  <span class="scenario-description">{{
                    scenario.description
                  }}</span>
                </button>
                <button
                  v-if="dirHandle"
                  type="button"
                  class="delete-btn"
                  title="シナリオを削除"
                  :disabled="isDeleting"
                  @click="
                    handleDeleteClick(scenario, difficulty.difficulty, $event)
                  "
                >
                  🗑️
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </dialog>

  <ConfirmDialog
    ref="confirmDialogRef"
    title="シナリオを削除"
    :message="`「${pendingDeleteScenario?.scenario.title ?? ''}」を削除しますか？この操作は元に戻せません。`"
    confirm-text="削除"
    cancel-text="キャンセル"
    @confirm="handleDeleteConfirm"
    @cancel="handleDeleteCancel"
  />
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

.scenario-row {
  display: flex;
  gap: var(--size-2);
  align-items: stretch;
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

.delete-btn {
  padding: var(--size-3) var(--size-4);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-12);
  transition: all 0.2s;
  flex-shrink: 0;
}

.delete-btn:hover:not(:disabled) {
  background-color: #fee2e2;
  border-color: #ef4444;
}

.delete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
