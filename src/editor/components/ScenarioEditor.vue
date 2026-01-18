<script setup lang="ts">
import { watch, onMounted, ref } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import { validateScenarioCompletely } from "@/logic/scenarioFileHandler";
import { useScenarioFileOperations } from "./composables/useScenarioFileOperations";
import { useScenarioExport } from "./composables/useScenarioExport";
import { useScenarioDirectory } from "./composables/useScenarioDirectory";
import { useScenarioIndexManagement } from "./composables/useScenarioIndexManagement";
import ScenarioEditorForm from "./ScenarioEditorForm.vue";
import SectionEditor from "./SectionEditor.vue";
import ValidationPanel from "./ValidationPanel.vue";
import PreviewPanel from "./PreviewPanel.vue";
import FileListDialog from "./FileListDialog.vue";
import ScenarioReorderDialog from "./ScenarioReorderDialog.vue";

// File System Access API の型定義
declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
  }
}

const editorStore = useEditorStore();

// Composables
const fileOps = useScenarioFileOperations();
const exportOps = useScenarioExport();
const dirOps = useScenarioDirectory();
const indexOps = useScenarioIndexManagement();

// State
const fileListDialogRef = ref<InstanceType<typeof FileListDialog> | null>(null);
const reorderDialogRef = ref<InstanceType<typeof ScenarioReorderDialog> | null>(
  null,
);
let validationTimer: number | null = null;

// マウント時にIndexedDBから保存されたディレクトリハンドルを復元
onMounted(async () => {
  await dirOps.restoreDirectoryHandle();
});

watch(
  () => editorStore.scenario,
  (value) => {
    if (validationTimer) {
      window.clearTimeout(validationTimer);
    }
    validationTimer = window.setTimeout(() => {
      const result = validateScenarioCompletely(value);
      editorStore.setValidationErrors(
        result.errors.map((e) => ({ path: e.path, message: e.message })),
      );
    }, 200);
  },
  { deep: true, immediate: true },
);

// Methods
const handleOpenFileListDialog = (): void => {
  if (!dirOps.scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }
  fileListDialogRef.value?.showModal();
};

const handleFileSelectFromDialog = async (path: string): Promise<void> => {
  if (!dirOps.scenarioDir.value) {
    return;
  }
  await fileOps.handleFileSelectFromDialog(path, dirOps.scenarioDir.value);
  fileListDialogRef.value?.close();
};

const handleGenerateIndex = async (): Promise<void> => {
  await indexOps.handleGenerateIndex(
    dirOps.scenarioDir.value,
    reorderDialogRef.value,
  );
};

const handleReorderConfirm = async (
  reorderedData: Record<string, string[]>,
): Promise<void> => {
  await indexOps.handleReorderConfirm(reorderedData, dirOps.scenarioDir.value);
};

// ファイルが削除された時のハンドラ
const handleFileDeleted = (deletedScenarioId: string): void => {
  // 現在編集中のシナリオが削除された場合は新規作成にリセット
  if (editorStore.scenario.id === deletedScenarioId) {
    fileOps.handleCreateNew();
  }
};
</script>

<template>
  <div class="scenario-editor-wrapper">
    <header class="editor-header">
      <div class="header-title">
        <h1>シナリオエディタ</h1>
        <span
          v-if="editorStore.scenario.id"
          class="scenario-title"
          :class="{ unsaved: editorStore.isDirty }"
        >
          - {{ editorStore.scenario.title }}{{ editorStore.isDirty ? "*" : "" }}
        </span>
      </div>
      <div class="header-controls">
        <button
          class="btn-secondary"
          @click="fileOps.handleCreateNew"
        >
          🆕 新規
        </button>
        <button
          class="btn-secondary"
          :title="
            dirOps.scenarioDir.value
              ? 'ディレクトリ選択済み'
              : 'ディレクトリ選択'
          "
          @click="dirOps.handleSelectDirectory"
        >
          {{ dirOps.scenarioDir.value ? "📁 (選択済み)" : "📁 ディレクトリ" }}
        </button>
        <button
          class="btn-secondary"
          :disabled="!dirOps.scenarioDir.value"
          title="シナリオを選択して開く"
          @click="handleOpenFileListDialog"
        >
          📄 ファイル選択
        </button>
        <button
          class="btn-primary"
          :disabled="!dirOps.scenarioDir.value"
          title="選択したディレクトリにシナリオを保存"
          @click="dirOps.handleSaveToDirectory"
        >
          💾 保存
        </button>

        <button
          class="btn-secondary"
          :disabled="!dirOps.scenarioDir.value"
          title="index.json を再生成"
          @click="handleGenerateIndex"
        >
          🔄 Index生成
        </button>
        <button
          class="btn-secondary"
          @click="
            () => (fileOps.showJsonInput.value = !fileOps.showJsonInput.value)
          "
        >
          {{ fileOps.showJsonInput.value ? "閉じる" : "JSON入出力" }}
        </button>
      </div>
    </header>

    <div class="editor-layout">
      <!-- 左パネル -->
      <div class="left-panel">
        <PreviewPanel />

        <!-- 基本情報 -->
        <details class="editor-section">
          <summary>シナリオ基本情報</summary>
          <div class="section-content">
            <ScenarioEditorForm />
          </div>
        </details>

        <!-- セクション管理（一覧） -->
        <section class="editor-section">
          <h2>セクション管理</h2>
          <SectionEditor mode="list" />
        </section>

        <!-- セクション詳細（タイトル・説明） -->
        <section class="editor-section">
          <SectionEditor
            mode="detail"
            detail-part="meta"
          />
        </section>

        <!-- エラーパネル -->
        <ValidationPanel v-if="editorStore.hasErrors" />

        <!-- JSONパネル -->
        <div
          v-if="fileOps.showJsonInput.value"
          class="json-panel"
        >
          <div class="json-controls">
            <button
              class="btn-small"
              @click="exportOps.handleJsonCopy"
            >
              📋 コピー
            </button>
            <button
              class="btn-small"
              @click="exportOps.handleJsonPaste"
            >
              📌 貼り付け
            </button>
          </div>
          <textarea
            v-model="fileOps.jsonInput.value"
            class="json-textarea"
            readonly
          />
        </div>
      </div>

      <!-- 右パネル -->
      <div class="right-panel">
        <section class="editor-section">
          <h2>セクション詳細（盤面・条件など）</h2>
          <SectionEditor
            mode="detail"
            detail-part="content"
          />
        </section>
      </div>
    </div>

    <FileListDialog
      ref="fileListDialogRef"
      :dir-handle="dirOps.scenarioDir.value"
      @selected="handleFileSelectFromDialog"
      @deleted="handleFileDeleted"
    />
    <ScenarioReorderDialog
      v-if="indexOps.currentIndexData.value && dirOps.scenarioDir.value"
      ref="reorderDialogRef"
      :current-data="indexOps.currentIndexData.value"
      :dir-handle="dirOps.scenarioDir.value"
      @confirm="handleReorderConfirm"
      @cancel="() => {}"
    />
  </div>
</template>

<style scoped>
.scenario-editor-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--color-background);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--size-8);
  background-color: var(--color-bg-gray);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.header-title {
  display: flex;
  align-items: center;
  gap: var(--size-5);
}

.header-title h1 {
  margin: 0;
  font-size: var(--size-20);
}

.scenario-title {
  font-size: var(--size-14);
  color: var(--color-text-secondary);
}

.scenario-title.unsaved {
  font-weight: 500;
}

.header-controls {
  display: flex;
  gap: var(--size-5);
  flex-wrap: wrap;
}

.file-input-label {
  padding: var(--size-5) var(--size-8);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: var(--size-12);
}

.file-input-label:hover {
  background-color: var(--color-bg-gray);
}

.btn-primary,
.btn-secondary,
.btn-small {
  padding: var(--size-5) var(--size-8);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--size-12);
  transition: all 0.2s;
}

.btn-primary {
  background-color: #4a90e2;
  border-color: #4a90e2;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: white;
  color: #4a90e2;
  border-color: #4a90e2;
}

.btn-secondary:hover {
  background-color: var(--color-bg-gray);
}

.btn-small {
  padding: var(--size-2) var(--size-6);
  font-size: var(--size-12);
  background-color: white;
}

.btn-small:hover {
  background-color: var(--color-bg-gray);
}

.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: var(--size-8);
  padding: var(--size-8);
  flex: 1;
  overflow: hidden;
}

.left-panel,
.right-panel {
  display: flex;
  flex-direction: column;
  gap: var(--size-6);
  overflow-y: auto;
  padding-right: var(--size-5);
  min-width: 0;
  height: 100%;
}

.preview-section {
  background-color: white;
  padding: var(--size-5);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.preview-section h3 {
  margin-top: 0;
  margin-bottom: var(--size-2);
  font-size: var(--size-12);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--size-2);
}

.section-info {
  margin: 0;
  font-size: var(--size-12);
  color: var(--color-text-secondary);
}

.editor-section {
  background-color: white;
  padding: var(--size-8);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.editor-section h2 {
  margin-top: 0;
  margin-bottom: var(--size-6);
  font-size: var(--size-14);
  border-bottom: 2px solid #4a90e2;
  padding-bottom: var(--size-2);
}

.editor-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: var(--size-14);
  padding: var(--size-5);
  border-bottom: 2px solid #4a90e2;
  margin: calc(var(--size-8) * -1);
  margin-bottom: 0;
  user-select: none;
}

.editor-section summary:hover {
  background-color: var(--color-bg-gray);
}

.editor-section .section-content {
  padding-top: var(--size-6);
}

.json-panel {
  padding: var(--size-6);
  background-color: #f5f5f5;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  margin-bottom: var(--size-6);
}

.json-controls {
  display: flex;
  gap: var(--size-5);
  margin-bottom: var(--size-5);
}

.json-textarea {
  width: 100%;
  height: 200px;
  padding: var(--size-5);
  font-family: monospace;
  font-size: var(--size-10);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  resize: vertical;
}
</style>
