<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import { useEditorStore } from "@/editor/stores/editorStore";
import {
  validateScenarioCompletely,
  downloadScenarioAsJSON,
  scenarioToJSON,
  createEmptyScenario,
} from "@/logic/scenarioFileHandler";
import { parseScenario } from "@/logic/scenarioParser";
import {
  saveDirectoryHandle,
  loadDirectoryHandle,
  removeDirectoryHandle,
} from "@/editor/logic/directionHandleStorage";
import {
  regenerateScenarioIndexWithOrder,
} from "@/editor/logic/indexFileHandler";
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

// State
const jsonInput = ref("");
const showJsonInput = ref(false);
const selectedFile = ref<File | null>(null);
const scenarioDir = ref<FileSystemDirectoryHandle | null>(null);
const fileListDialogRef = ref<InstanceType<typeof FileListDialog> | null>(null);
const reorderDialogRef = ref<InstanceType<typeof ScenarioReorderDialog> | null>(
  null,
);
const currentIndexData = ref<{
  difficulties: Record<
    string,
    {
      label: string;
      scenarios: {
        id: string;
        title: string;
        description: string;
        path: string;
      }[];
    }
  >;
} | null>(null);
let validationTimer: number | null = null;

// マウント時にIndexedDBから保存されたディレクトリハンドルを復元
onMounted(async () => {
  try {
    const savedHandle = await loadDirectoryHandle();
    if (savedHandle) {
      scenarioDir.value = savedHandle;
      console.warn("保存されたディレクトリハンドルを復元しました");
    }
  } catch (error) {
    console.error("Failed to restore directory handle:", error);
  }
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
const handleFileSelect = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  selectedFile.value = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target?.result as string;
      console.warn("📄 ファイル読み込み開始");
      const data = JSON.parse(text);
      console.warn("✅ JSON パース成功:", data);
      jsonInput.value = text;

      // バリデーション実行
      console.warn("🔍 バリデーション開始...");
      const result = validateScenarioCompletely(data);
      console.warn("🔍 バリデーション結果:", result);

      if (result.isValid) {
        console.warn("✅ バリデーション成功 - シナリオをパース中...");
        // ParseScenarioで型付きオブジェクトを得る
        const scenario = parseScenario(data);
        console.warn("✅ パース成功:", scenario);
        editorStore.loadScenario(scenario);
        editorStore.clearValidationErrors();
        showJsonInput.value = false;
        console.warn("✅ シナリオ読み込み完了");
      } else {
        console.warn("❌ バリデーションエラーを検出しました:");
        result.errors.forEach((error) => {
          console.warn(`  [${error.type}] ${error.path}: ${error.message}`);
        });
        editorStore.setValidationErrors(
          result.errors.map((e) => ({ path: e.path, message: e.message })),
        );
      }
    } catch (error) {
      console.error("❌ ファイルの読み込みに失敗しました:", error);
      if (error instanceof Error) {
        console.error("エラー詳細:", error.message);
        console.error("スタックトレース:", error.stack);
      }
    }
  };
  reader.readAsText(file);
};

const handleFileSelectFromDialog = async (path: string): Promise<void> => {
  if (!scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }

  try {
    console.warn(`📄 ファイル読み込み開始: ${path}`);
    const pathParts = path.split("/");
    const fileName = pathParts.pop();
    const difficultyName = pathParts[0] || "beginner";

    let fileHandle: FileSystemFileHandle =
      null as unknown as FileSystemFileHandle;

    if (pathParts.length > 0) {
      // サブディレクトリに含まれるファイル
      const difficultyDir = await scenarioDir.value.getDirectoryHandle(
        difficultyName,
        { create: false },
      );
      fileHandle = (await difficultyDir.getFileHandle(fileName || "", {
        create: false,
      })) as FileSystemFileHandle;
    } else {
      // ルートディレクトリのファイル
      fileHandle = (await scenarioDir.value.getFileHandle(fileName || "", {
        create: false,
      })) as FileSystemFileHandle;
    }

    const file = await fileHandle.getFile();
    const text = await file.text();
    console.warn("✅ ファイル読み込み成功");
    console.warn("📄 JSON文字列:", `${text.substring(0, 200)}...`);

    const data = JSON.parse(text);
    console.warn("✅ JSON パース成功:", data);

    console.warn("🔍 バリデーション開始...");
    const result = validateScenarioCompletely(data);
    console.warn("🔍 バリデーション結果:", result);

    if (result.isValid) {
      console.warn("✅ バリデーション成功 - シナリオをパース中...");
      const scenario = parseScenario(data);
      console.warn("✅ パース成功:", scenario);
      editorStore.loadScenario(scenario);
      editorStore.clearValidationErrors();
      jsonInput.value = text;
      fileListDialogRef.value?.close();
      console.warn(`✅ ${path} を読み込みました`);
    } else {
      console.warn("❌ JSONにエラーがあります:");
      result.errors.forEach((error) => {
        console.warn(`  [${error.type}] ${error.path}: ${error.message}`);
      });
      editorStore.setValidationErrors(
        result.errors.map((e) => ({ path: e.path, message: e.message })),
      );
    }
  } catch (error) {
    console.error("❌ ファイル読み込みに失敗しました:", error);
    if (error instanceof Error) {
      console.error("エラー詳細:", error.message);
      console.error("スタックトレース:", error.stack);
    }
  }
};

const handleOpenFileListDialog = (): void => {
  if (!scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }
  fileListDialogRef.value?.showModal();
};

const handleSave = (): void => {
  console.warn("シナリオを保存します");
  // バリデーション実行
  const result = validateScenarioCompletely(editorStore.scenario);
  editorStore.setValidationErrors(
    result.errors.map((e) => ({ path: e.path, message: e.message })),
  );

  if (!result.isValid) {
    const errorMessage = `バリデーションエラーがあります:\n\n${result.errors
      .map((e) => `[${e.type}] ${e.path}: ${e.message}`)
      .join("\n")}`;
    console.warn("バリデーションエラーを検出しました");
    console.error(errorMessage);
    return;
  }

  downloadScenarioAsJSON(editorStore.scenario);
  editorStore.markClean();
};

const handleJsonCopy = (): void => {
  const json = scenarioToJSON(editorStore.scenario);
  navigator.clipboard.writeText(json).then(() => {
    console.warn("JSONをクリップボードにコピーしました");
  });
};

const handleJsonPaste = async (): Promise<void> => {
  try {
    console.warn("📋 クリップボードから読み込み中...");
    const text = await navigator.clipboard.readText();
    console.warn("✅ クリップボード読み込み成功");
    console.warn("📄 JSON文字列:", `${text.substring(0, 200)}...`);

    const data = JSON.parse(text);
    console.warn("✅ JSON パース成功:", data);

    console.warn("🔍 バリデーション開始...");
    const result = validateScenarioCompletely(data);
    console.warn("🔍 バリデーション結果:", result);

    if (result.isValid) {
      console.warn("✅ バリデーション成功 - シナリオをパース中...");
      const scenario = parseScenario(data);
      console.warn("✅ パース成功:", scenario);
      editorStore.loadScenario(scenario);
      editorStore.clearValidationErrors();
      showJsonInput.value = false;
      console.warn("✅ クリップボードから読み込み完了");
    } else {
      console.warn("❌ クリップボードのJSONにエラーがあります:");
      result.errors.forEach((error) => {
        console.warn(`  [${error.type}] ${error.path}: ${error.message}`);
      });
      editorStore.setValidationErrors(
        result.errors.map((e) => ({ path: e.path, message: e.message })),
      );
    }
  } catch (error) {
    console.error("❌ クリップボードからの読み込みに失敗しました:", error);
    if (error instanceof Error) {
      console.error("エラー詳細:", error.message);
      console.error("スタックトレース:", error.stack);
    }
  }
};

const handleCreateNew = (): void => {
  const fresh = createEmptyScenario();
  editorStore.loadScenario(fresh);
  editorStore.clearValidationErrors();
  jsonInput.value = scenarioToJSON(fresh);
  selectedFile.value = null;
  showJsonInput.value = false;
};

const handleSelectDirectory = async (): Promise<void> => {
  // File System Access API のサポート確認
  if (!window.showDirectoryPicker) {
    console.error(
      "このブラウザは File System Access API をサポートしていません。Chrome/Edge 86 以上が必要です。",
    );
    return;
  }

  try {
    const dirHandle = await window.showDirectoryPicker();
    scenarioDir.value = dirHandle;
    // IndexedDB に保存
    await saveDirectoryHandle(dirHandle);
    console.warn("シナリオ保存先ディレクトリを選択しました:", dirHandle.name);
  } catch (error) {
    const err = error as DOMException;
    // Playwright環境での傍受はテスト用なので無視
    if (err.name === "AbortError" && err.message.includes("Intercepted")) {
      console.warn("ディレクトリピッカーが傍受されました（Playwright環境）");
      return;
    }
    // その他のエラーは報告
    console.error("ディレクトリ選択エラー:", {
      name: err.name,
      message: err.message,
      code: err.code,
    });
  }
};

const handleSaveToDirectory = async (): Promise<void> => {
  if (!scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }

  try {
    console.warn("💾 保存開始...");
    console.warn("📋 シナリオデータ:", editorStore.scenario);

    // バリデーション実行
    const result = validateScenarioCompletely(editorStore.scenario);
    if (!result.isValid) {
      const errorMessages = result.errors
        .map((e) => `[${e.type}] ${e.path}: ${e.message}`)
        .join("\n");
      // oxlint-disable-next-line no-alert
      alert(`❌ バリデーションエラーがあります:\n\n${errorMessages}`);
      editorStore.setValidationErrors(
        result.errors.map((e) => ({ path: e.path, message: e.message })),
      );
      return;
    }

    editorStore.clearValidationErrors();

    const fileName = `${editorStore.scenario.id}.json`;
    console.warn(
      `💾 ファイル名: ${editorStore.scenario.difficulty}/${fileName}`,
    );

    // 難易度に対応したディレクトリを取得（自動作成）
    const difficultyDir = await scenarioDir.value.getDirectoryHandle(
      editorStore.scenario.difficulty,
      { create: true },
    );
    const fileHandle = await difficultyDir.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();
    const json = scenarioToJSON(editorStore.scenario);
    console.warn("📄 JSON文字列:", `${json.substring(0, 200)}...`);

    await writable.write(json);
    await writable.close();
    editorStore.markClean();
    console.warn(
      `✅ ${editorStore.scenario.difficulty}/${fileName} を保存しました`,
    );
  } catch (error) {
    console.error("❌ ファイル保存に失敗しました:", error);
    if (error instanceof Error) {
      console.error("エラー詳細:", error.message);
      console.error("スタックトレース:", error.stack);
    }
  }
};

const handleLoadFromDirectory = async (): Promise<void> => {
  if (!scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }

  try {
    // 難易度ディレクトリを取得（存在しない場合はスキップ）
    let targetDir: FileSystemDirectoryHandle | null = null;
    try {
      targetDir = await scenarioDir.value.getDirectoryHandle(
        editorStore.scenario.difficulty,
        {
          create: false,
        },
      );
    } catch {
      console.warn(
        `難易度ディレクトリ '${editorStore.scenario.difficulty}' が見つかりません`,
      );
      return;
    }

    if (!targetDir) {
      return;
    }

    const typedTargetDir = targetDir as FileSystemDirectoryHandle & {
      entries?: () => AsyncIterable<[string, FileSystemHandle]>;
    };

    if (!typedTargetDir.entries) {
      console.warn("entries() がサポートされていないディレクトリハンドルです");
      return;
    }

    const entries: [string, FileSystemFileHandle][] = [];
    for await (const [name, handle] of typedTargetDir.entries()) {
      if (name.endsWith(".json") && handle.kind === "file") {
        entries.push([name, handle as FileSystemFileHandle]);
      }
    }

    if (entries.length === 0) {
      console.warn(
        `難易度ディレクトリ '${editorStore.scenario.difficulty}' にJSONファイルが見つかりません`,
      );
      return;
    }

    const [firstEntry] = entries;
    if (!firstEntry) {
      return;
    }

    const [fileName, fileHandle] = firstEntry;
    const file = await fileHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    const result = validateScenarioCompletely(data);

    if (result.isValid) {
      const scenario = parseScenario(data);
      editorStore.loadScenario(scenario);
      editorStore.clearValidationErrors();
      jsonInput.value = text;
      console.warn(
        `${editorStore.scenario.difficulty}/${fileName} を読み込みました`,
      );
    } else {
      editorStore.setValidationErrors(
        result.errors.map((e) => ({ path: e.path, message: e.message })),
      );
      console.warn("JSONにエラーがあります");
    }
  } catch (error) {
    console.error("ファイル読み込みに失敗しました:", error);
  }
};

const handleGenerateIndex = async (): Promise<void> => {
  if (!scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }

  try {
    // 現在のindex.jsonを読み込む
    const indexHandle = await scenarioDir.value.getFileHandle("index.json", {
      create: false,
    });
    const indexFile = await indexHandle.getFile();
    const indexText = await indexFile.text();
    currentIndexData.value = JSON.parse(indexText);
  } catch {
    // index.json が存在しない場合は空の状態で開始
    currentIndexData.value = {
      difficulties: {
        beginner: { label: "入門", scenarios: [] },
        intermediate: { label: "初級", scenarios: [] },
        advanced: { label: "中級", scenarios: [] },
      },
    };
  }

  // DOMの更新を待ってからダイアログを開く
  await nextTick();
  reorderDialogRef.value?.showModal();
};

const handleReorderConfirm = async (
  reorderedData: Record<string, string[]>,
): Promise<void> => {
  if (!scenarioDir.value || !currentIndexData.value) {
    console.error("Invalid state");
    return;
  }

  try {
    console.warn("🔄 index.json を再生成中...");
    await regenerateScenarioIndexWithOrder(
      scenarioDir.value,
      currentIndexData.value,
      reorderedData,
    );
    console.warn("✅ index.json を再生成しました");
  } catch (error) {
    console.error("❌ index.json の生成に失敗しました:", error);
    if (error instanceof Error) {
      console.error("エラー詳細:", error.message);
    }
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
          @click="handleCreateNew"
        >
          🆕 新規
        </button>
        <button
          class="btn-secondary"
          :title="scenarioDir ? 'ディレクトリ選択済み' : 'ディレクトリ選択'"
          @click="handleSelectDirectory"
        >
          {{ scenarioDir ? "📁 (選択済み)" : "📁 ディレクトリ" }}
        </button>
        <button
          class="btn-secondary"
          :disabled="!scenarioDir"
          title="シナリオを選択して開く"
          @click="handleOpenFileListDialog"
        >
          📄 ファイル選択
        </button>
        <button
          class="btn-primary"
          :disabled="!scenarioDir"
          title="選択したディレクトリにシナリオを保存"
          @click="handleSaveToDirectory"
        >
          💾 保存
        </button>

        <button
          class="btn-secondary"
          :disabled="!scenarioDir"
          title="index.json を再生成"
          @click="handleGenerateIndex"
        >
          🔄 Index生成
        </button>
        <button
          class="btn-secondary"
          @click="() => (showJsonInput = !showJsonInput)"
        >
          {{ showJsonInput ? "閉じる" : "JSON入出力" }}
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
          v-if="showJsonInput"
          class="json-panel"
        >
          <div class="json-controls">
            <button
              class="btn-small"
              @click="handleJsonCopy"
            >
              📋 コピー
            </button>
            <button
              class="btn-small"
              @click="handleJsonPaste"
            >
              📌 貼り付け
            </button>
          </div>
          <textarea
            v-model="jsonInput"
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
      @selected="handleFileSelectFromDialog"
    />
    <ScenarioReorderDialog
      v-if="currentIndexData && scenarioDir"
      ref="reorderDialogRef"
      :current-data="currentIndexData"
      :dir-handle="scenarioDir"
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
