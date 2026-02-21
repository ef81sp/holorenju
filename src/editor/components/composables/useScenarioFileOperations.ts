import { ref, computed, type ComputedRef } from "vue";

import { useEditorStore } from "@/editor/stores/editorStore";
import {
  validateScenarioCompletely,
  scenarioToJSON,
  createEmptyScenario,
} from "@/logic/scenarioFileHandler";
import { parseScenario } from "@/logic/scenarioParser";
import { DIFFICULTIES } from "@/types/scenario";

interface UseScenarioFileOperationsReturn {
  selectedFile: ReturnType<typeof ref<File | null>>;
  jsonInput: ReturnType<typeof ref<string>>;
  showJsonInput: ReturnType<typeof ref<boolean>>;
  currentFileHandle: ComputedRef<FileSystemFileHandle | null>;
  handleFileSelect: (event: Event) => void;
  handleFileSelectFromDialog: (
    path: string,
    scenarioDir: FileSystemDirectoryHandle,
  ) => Promise<void>;
  handleCreateNew: () => void;
  reloadCurrentFile: () => Promise<boolean>;
}

export function useScenarioFileOperations(): UseScenarioFileOperationsReturn {
  const editorStore = useEditorStore();

  const selectedFile = ref<File | null>(null);
  const jsonInput = ref("");
  const showJsonInput = ref(false);

  // editorStore の currentFileHandle を参照（シナリオプレイヤーからもアクセス可能）
  const currentFileHandle = computed(() => editorStore.currentFileHandle);

  /**
   * ローカルファイルから JSON を読み込み、シナリオとしてパースする
   * ※ <input type="file"> ではファイルハンドル取得不可のため、再読み込み機能は使用不可
   */
  const handleFileSelect = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    selectedFile.value = file;
    editorStore.clearCurrentFileHandle(); // File入力ではハンドル取得不可
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        jsonInput.value = text;

        // バリデーション実行
        const result = validateScenarioCompletely(data);

        if (result.isValid) {
          const scenario = parseScenario(data);
          editorStore.loadScenario(scenario);
          editorStore.clearValidationErrors();
          showJsonInput.value = false;
        } else {
          editorStore.setValidationErrors(
            result.errors.map((e) => ({ path: e.path, message: e.message })),
          );
        }
      } catch (error) {
        console.error("ファイルの読み込みに失敗しました:", error);
      }
    };
    reader.readAsText(file);
  };

  /**
   * ファイルシステムから JSON を読み込む
   */
  const handleFileSelectFromDialog = async (
    path: string,
    scenarioDir: FileSystemDirectoryHandle,
  ): Promise<void> => {
    if (!scenarioDir) {
      return;
    }

    try {
      const pathParts = path.split("/");
      const fileName = pathParts.pop();
      const difficultyName = pathParts[0] || DIFFICULTIES[0];

      const fileHandle: FileSystemFileHandle =
        pathParts.length > 0
          ? await scenarioDir
              .getDirectoryHandle(difficultyName, { create: false })
              .then((dir) =>
                dir.getFileHandle(fileName || "", { create: false }),
              )
          : await scenarioDir.getFileHandle(fileName || "", { create: false });

      // ファイルハンドルを保存（再読み込み用）
      editorStore.setCurrentFileHandle(fileHandle);

      const file = await fileHandle.getFile();
      const text = await file.text();

      const data = JSON.parse(text);

      const result = validateScenarioCompletely(data);

      if (result.isValid) {
        const scenario = parseScenario(data);
        editorStore.loadScenario(scenario);
        editorStore.clearValidationErrors();
        jsonInput.value = text;
      } else {
        editorStore.setValidationErrors(
          result.errors.map((e) => ({ path: e.path, message: e.message })),
        );
      }
    } catch (error) {
      console.error("ファイル読み込みに失敗しました:", error);
    }
  };

  /**
   * 新規シナリオを作成
   */
  const handleCreateNew = (): void => {
    const fresh = createEmptyScenario();
    editorStore.loadScenario(fresh);
    editorStore.clearValidationErrors();
    jsonInput.value = scenarioToJSON(fresh);
    selectedFile.value = null;
    editorStore.clearCurrentFileHandle();
    editorStore.clearOriginalDifficulty(); // 新規作成時は元の難易度をクリア
    showJsonInput.value = false;
  };

  /**
   * 現在のファイルを再読み込み（表示位置を維持）
   */
  const reloadCurrentFile = async (): Promise<boolean> => {
    const fileHandle = editorStore.currentFileHandle;
    if (!fileHandle) {
      return false;
    }

    try {
      // 現在の表示状態を保存
      const currentSectionIndex = editorStore.selectedSectionIndex;
      const currentDialogueIndex = editorStore.previewDialogueIndex;

      // ファイルを読み込み
      const file = await fileHandle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);

      // バリデーション
      const result = validateScenarioCompletely(data);
      if (!result.isValid) {
        editorStore.setValidationErrors(
          result.errors.map((e) => ({ path: e.path, message: e.message })),
        );
        return false;
      }

      // シナリオを再読み込み
      const scenario = parseScenario(data);
      editorStore.loadScenario(scenario);
      editorStore.clearValidationErrors();
      jsonInput.value = text;

      // 表示状態を復元（可能な範囲で）
      if (currentSectionIndex !== null) {
        const maxSectionIndex = Math.max(0, scenario.sections.length - 1);
        const restoredSectionIndex = Math.min(
          currentSectionIndex,
          maxSectionIndex,
        );
        editorStore.selectSection(restoredSectionIndex);
        editorStore.goToDialogueIndex(currentDialogueIndex);
      }

      return true;
    } catch (error) {
      console.error("再読み込みに失敗しました:", error);
      return false;
    }
  };

  return {
    selectedFile,
    jsonInput,
    showJsonInput,
    currentFileHandle,
    handleFileSelect,
    handleFileSelectFromDialog,
    handleCreateNew,
    reloadCurrentFile,
  };
}
