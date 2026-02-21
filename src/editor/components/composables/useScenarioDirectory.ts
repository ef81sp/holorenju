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
    } catch (error) {
      const err = error as DOMException;
      // Playwright環境での傍受はテスト用なので無視
      if (err.name === "AbortError" && err.message.includes("Intercepted")) {
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
      return;
    }

    try {
      // バリデーション実行（保存時は文字数チェックも行う）
      const result = validateScenarioCompletely(editorStore.scenario, {
        checkLength: true,
      });
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

      await writable.write(json);
      await writable.close();

      // 難易度が変更された場合、古いファイルを削除
      const originalDiff = editorStore.originalDifficulty;
      const currentDiff = editorStore.scenario.difficulty;
      if (originalDiff !== null && originalDiff !== currentDiff) {
        try {
          const oldDir = await scenarioDir.value.getDirectoryHandle(
            originalDiff,
            { create: false },
          );
          await oldDir.removeEntry(fileName);
        } catch (error) {
          // NotFoundError は無視（ファイルが既に存在しない場合）
          if (
            !(error instanceof DOMException && error.name === "NotFoundError")
          ) {
            console.error("古いファイルの削除に失敗しました:", error);
          }
        }
      }

      // 保存成功後、元の難易度を更新
      editorStore.updateOriginalDifficulty(currentDiff);
      editorStore.markClean();
    } catch (error) {
      console.error("ファイル保存に失敗しました:", error);
    }
  };

  /**
   * ディレクトリから最初の JSON ファイルを読み込み
   */
  const handleLoadFromDirectory = async (): Promise<void> => {
    if (!scenarioDir.value) {
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
        return;
      }

      if (!targetDir) {
        return;
      }

      const typedTargetDir = targetDir as FileSystemDirectoryHandle & {
        entries?: () => AsyncIterable<[string, FileSystemHandle]>;
      };

      if (!typedTargetDir.entries) {
        return;
      }

      const entries: [string, FileSystemFileHandle][] = [];
      for await (const [name, handle] of typedTargetDir.entries()) {
        if (name.endsWith(".json") && handle.kind === "file") {
          entries.push([name, handle as FileSystemFileHandle]);
        }
      }

      if (entries.length === 0) {
        return;
      }

      const [firstEntry] = entries;
      if (!firstEntry) {
        return;
      }

      const [, fileHandle] = firstEntry;
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      const result = validateScenarioCompletely(data);

      if (result.isValid) {
        const scenario = parseScenario(data);
        editorStore.loadScenario(scenario);
        editorStore.clearValidationErrors();
      } else {
        editorStore.setValidationErrors(
          result.errors.map((e) => ({ path: e.path, message: e.message })),
        );
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
