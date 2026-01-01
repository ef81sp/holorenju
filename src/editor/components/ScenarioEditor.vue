<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
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
import { regenerateScenarioIndex } from "@/editor/logic/indexFileHandler";
import ScenarioEditorForm from "./ScenarioEditorForm.vue";
import SectionEditor from "./SectionEditor.vue";
import ValidationPanel from "./ValidationPanel.vue";
import PreviewPanel from "./PreviewPanel.vue";

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

const handleSelectFileFromDirectory = async (): Promise<void> => {
  if (!scenarioDir.value) {
    console.warn("先にディレクトリを選択してください");
    return;
  }

  const rootDir = scenarioDir.value as FileSystemDirectoryHandle & {
    entries?: () => AsyncIterable<[string, FileSystemHandle]>;
  };

  if (!rootDir.entries) {
    console.warn("entries() がサポートされていないディレクトリハンドルです");
    return;
  }

  try {
    console.warn("📂 ディレクトリ内のファイル一覧を取得中...");
    // 選択済みディレクトリ内のJSONファイル一覧を取得（サブディレクトリも含む）
    const entries: [string, FileSystemFileHandle, string][] = []; // [相対パス, handle, ファイル名]

    // ルートディレクトリのJSONファイルを取得
    for await (const [name, handle] of rootDir.entries()) {
      if (name.endsWith(".json") && handle.kind === "file") {
        entries.push([name, handle as FileSystemFileHandle, name]);
      }
    }

    // 難易度サブディレクトリ（beginner/intermediate/advanced）を検索
    const difficultyDirs = ["beginner", "intermediate", "advanced"];
    const subDirPromises = difficultyDirs.map(async (difficultyName) => {
      try {
        if (!scenarioDir.value) {
          return [];
        }
        const difficultyDir = await scenarioDir.value.getDirectoryHandle(
          difficultyName,
          { create: false },
        );
        const typedDifficultyDir =
          difficultyDir as FileSystemDirectoryHandle & {
            entries?: () => AsyncIterable<[string, FileSystemHandle]>;
          };
        if (!typedDifficultyDir.entries) {
          return [];
        }
        const subEntries: [string, FileSystemFileHandle, string][] = [];
        for await (const [name, handle] of typedDifficultyDir.entries()) {
          if (name.endsWith(".json") && handle.kind === "file") {
            const relativePath = `${difficultyName}/${name}`;
            subEntries.push([
              relativePath,
              handle as FileSystemFileHandle,
              name,
            ]);
          }
        }
        return subEntries;
      } catch {
        return [];
      }
    });

    const subResults = await Promise.all(subDirPromises);
    subResults.forEach((subEntries) => {
      entries.push(...subEntries);
    });

    console.warn(
      `📂 ${entries.length} 個のJSONファイルが見つかりました:`,
      entries.map(([relativePath]) => relativePath),
    );

    if (entries.length === 0) {
      console.warn("ディレクトリ内にJSONファイルがありません");
      return;
    }

    // 複数ファイルがある場合は先頭を採用（UIでの選択実装は別途対応）
    const [firstEntry] = entries;
    if (!firstEntry) {
      return;
    }
    const [relativePath, fileHandle, fileName] = firstEntry;
    console.warn(`📄 ${relativePath} を読み込み中...`);
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
      console.warn(`✅ ${relativePath} を読み込みました`);
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

const handleSave = (): void => {
  console.warn("シナリオを保存します");
  // バリデーション実行
  const result = validateScenarioCompletely(editorStore.scenario);
  editorStore.setValidationErrors(
    result.errors.map((e) => ({ path: e.path, message: e.message })),
  );

  if (!result.isValid) {
    console.warn("バリデーションエラーを検出しました");
    alert(
      `バリデーションエラーがあります:\n\n${
        result.errors
          .map((e) => `[${e.type}] ${e.path}: ${e.message}`)
          .join("\n")
      }`,
    );
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

    // Index.json を更新
    await regenerateScenarioIndex(scenarioDir.value, editorStore.scenario);
    console.warn("✅ シナリオ一覧 (index.json) を再生成しました");
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
        { create: false },
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
</script>

<template>
  <div class="scenario-editor-wrapper">
    <header class="editor-header">
      <h1>シナリオエディタ</h1>
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
        <label class="file-input-label">
          <input
            type="file"
            accept=".json"
            style="display: none"
            @change="handleFileSelect"
          >
          📄 ファイル選択
        </label>
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
          title="ディレクトリから最初のJSONファイルを読み込み"
          @click="handleLoadFromDirectory"
        >
          📂 読込
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
          <h2>セクション詳細</h2>
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
  padding: calc(var(--size-unit) * 0.8);
  background-color: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.editor-header h1 {
  margin: 0;
  font-size: calc(var(--size-unit) * 1.8);
}

.header-controls {
  display: flex;
  gap: calc(var(--size-unit) * 0.4);
  flex-wrap: wrap;
}

.file-input-label {
  padding: calc(var(--size-unit) * 0.4) calc(var(--size-unit) * 0.8);
  background-color: white;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: calc(var(--size-unit) * 1.2);
}

.file-input-label:hover {
  background-color: var(--color-background-soft);
}

.btn-primary,
.btn-secondary,
.btn-small {
  padding: calc(var(--size-unit) * 0.4) calc(var(--size-unit) * 0.8);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  cursor: pointer;
  font-size: calc(var(--size-unit) * 1.2);
  transition: all 0.2s;
}

.btn-primary {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
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
  color: var(--color-primary);
  border-color: var(--color-primary);
}

.btn-secondary:hover {
  background-color: var(--color-background-soft);
}

.btn-small {
  padding: calc(var(--size-unit) * 0.3) calc(var(--size-unit) * 0.6);
  font-size: calc(var(--size-unit) * 1.1);
  background-color: white;
}

.btn-small:hover {
  background-color: var(--color-background-soft);
}

.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: calc(var(--size-unit) * 0.8);
  padding: calc(var(--size-unit) * 0.8);
  flex: 1;
  overflow: hidden;
}

.left-panel,
.right-panel {
  display: flex;
  flex-direction: column;
  gap: calc(var(--size-unit) * 0.6);
  overflow-y: auto;
  padding-right: calc(var(--size-unit) * 0.4);
  min-width: 0;
  height: 100%;
}

.preview-section {
  background-color: white;
  padding: calc(var(--size-unit) * 0.4);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.preview-section h3 {
  margin-top: 0;
  margin-bottom: calc(var(--size-unit) * 0.3);
  font-size: calc(var(--size-unit) * 1.2);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: calc(var(--size-unit) * 0.2);
}

.section-info {
  margin: 0;
  font-size: calc(var(--size-unit) * 1.1);
  color: var(--color-text-secondary);
}

.editor-section {
  background-color: white;
  padding: calc(var(--size-unit) * 0.8);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.editor-section h2 {
  margin-top: 0;
  margin-bottom: calc(var(--size-unit) * 0.6);
  font-size: calc(var(--size-unit) * 1.4);
  border-bottom: 2px solid var(--color-primary);
  padding-bottom: calc(var(--size-unit) * 0.3);
}

.editor-section summary {
  cursor: pointer;
  font-weight: 600;
  font-size: calc(var(--size-unit) * 1.4);
  padding: calc(var(--size-unit) * 0.4);
  border-bottom: 2px solid var(--color-primary);
  margin: calc(var(--size-unit) * -0.8);
  margin-bottom: 0;
  user-select: none;
}

.editor-section summary:hover {
  background-color: var(--color-background-soft);
}

.editor-section .section-content {
  padding-top: calc(var(--size-unit) * 0.6);
}

.json-panel {
  padding: calc(var(--size-unit) * 0.6);
  background-color: #f5f5f5;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  margin-bottom: calc(var(--size-unit) * 0.6);
}

.json-controls {
  display: flex;
  gap: calc(var(--size-unit) * 0.4);
  margin-bottom: calc(var(--size-unit) * 0.4);
}

.json-textarea {
  width: 100%;
  height: calc(var(--size-unit) * 20);
  padding: calc(var(--size-unit) * 0.4);
  font-family: monospace;
  font-size: calc(var(--size-unit) * 1);
  border: 1px solid var(--color-border);
  border-radius: 3px;
  resize: vertical;
}
</style>
