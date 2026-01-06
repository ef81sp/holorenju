import { ref, type Ref } from "vue";

import {
  saveDirectoryHandle,
  loadDirectoryHandle,
} from "@/editor/logic/directionHandleStorage";
import { useEditorStore } from "@/editor/stores/editorStore";
import {
  validateScenarioCompletely,
  scenarioToJSON,
} from "@/logic/scenarioFileHandler";
import { parseScenario } from "@/logic/scenarioParser";

interface UseScenarioDirReturn {
  scenarioDir: Ref<FileSystemDirectoryHandle | null>;
  restoreDirectoryHandle: () => Promise<void>;
  handleSelectDirectory: () => Promise<void>;
  handleSaveToDirectory: () => Promise<void>;
  handleLoadFromDirectory: () => Promise<void>;
}

export function useScenarioDirectory(): UseScenarioDirReturn {
  const editorStore = useEditorStore();

  const scenarioDir = ref<FileSystemDirectoryHandle | null>(null);

  /**
   * IndexedDB から保存されたディレクトリハンドルを復元
   */
  const restoreDirectoryHandle = async (): Promise<void> => {
    try {
      const savedHandle = await loadDirectoryHandle();
      if (savedHandle) {
        scenarioDir.value = savedHandle;
        console.warn("保存されたディレクトリハンドルを復元しました");
      }
    } catch (error) {
      console.error("Failed to restore directory handle:", error);
    }
  };

  /**
   * ファイルシステムのディレクトリを選択
   */
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

  /**
   * 選択ディレクトリにシナリオを保存
   */
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

  /**
   * ディレクトリから最初の JSON ファイルを読み込み
   */
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
        console.warn(
          "entries() がサポートされていないディレクトリハンドルです",
        );
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

  return {
    scenarioDir,
    restoreDirectoryHandle,
    handleSelectDirectory,
    handleSaveToDirectory,
    handleLoadFromDirectory,
  };
}
