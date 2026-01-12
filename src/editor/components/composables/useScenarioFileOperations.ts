import { ref } from "vue";

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
  handleFileSelect: (event: Event) => void;
  handleFileSelectFromDialog: (
    path: string,
    scenarioDir: FileSystemDirectoryHandle,
  ) => Promise<void>;
  handleCreateNew: () => void;
}

export function useScenarioFileOperations(): UseScenarioFileOperationsReturn {
  const editorStore = useEditorStore();

  const selectedFile = ref<File | null>(null);
  const jsonInput = ref("");
  const showJsonInput = ref(false);

  /**
   * ローカルファイルから JSON を読み込み、シナリオとしてパースする
   */
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

  /**
   * ファイルシステムから JSON を読み込む
   */
  const handleFileSelectFromDialog = async (
    path: string,
    scenarioDir: FileSystemDirectoryHandle,
  ): Promise<void> => {
    if (!scenarioDir) {
      console.warn("先にディレクトリを選択してください");
      return;
    }

    try {
      console.warn(`📄 ファイル読み込み開始: ${path}`);
      const pathParts = path.split("/");
      const fileName = pathParts.pop();
      const difficultyName = pathParts[0] || DIFFICULTIES[0];

      let fileHandle: FileSystemFileHandle =
        null as unknown as FileSystemFileHandle;

      if (pathParts.length > 0) {
        // サブディレクトリに含まれるファイル
        const difficultyDir = await scenarioDir.getDirectoryHandle(
          difficultyName,
          { create: false },
        );
        fileHandle = (await difficultyDir.getFileHandle(fileName || "", {
          create: false,
        })) as FileSystemFileHandle;
      } else {
        // ルートディレクトリのファイル
        fileHandle = (await scenarioDir.getFileHandle(fileName || "", {
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

  /**
   * 新規シナリオを作成
   */
  const handleCreateNew = (): void => {
    const fresh = createEmptyScenario();
    editorStore.loadScenario(fresh);
    editorStore.clearValidationErrors();
    jsonInput.value = scenarioToJSON(fresh);
    selectedFile.value = null;
    showJsonInput.value = false;
  };

  return {
    selectedFile,
    jsonInput,
    showJsonInput,
    handleFileSelect,
    handleFileSelectFromDialog,
    handleCreateNew,
  };
}
