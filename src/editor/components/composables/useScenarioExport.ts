import { useEditorStore } from "@/editor/stores/editorStore";
import {
  validateScenarioCompletely,
  downloadScenarioAsJSON,
  scenarioToJSON,
} from "@/logic/scenarioFileHandler";

interface UseScenarioExportReturn {
  handleSave: () => void;
  handleJsonCopy: () => void;
  handleJsonPaste: () => Promise<void>;
}

export function useScenarioExport(): UseScenarioExportReturn {
  const editorStore = useEditorStore();

  /**
   * シナリオをダウンロード（バリデーション付き）
   */
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

  /**
   * JSON をクリップボードにコピー
   */
  const handleJsonCopy = (): void => {
    const json = scenarioToJSON(editorStore.scenario);
    navigator.clipboard.writeText(json).then(() => {
      console.warn("JSONをクリップボードにコピーしました");
    });
  };

  /**
   * クリップボードから JSON を読み込み
   */
  const handleJsonPaste = async (): Promise<void> => {
    try {
      console.warn("📋 クリップボードから読み込み中...");
      const text = await navigator.clipboard.readText();
      console.warn("✅ クリップボード読み込み成功");
      console.warn("📄 JSON文字列:", `${text.substring(0, 200)}...`);

      const { parseScenario } = await import("@/logic/scenarioParser");
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

  return {
    handleSave,
    handleJsonCopy,
    handleJsonPaste,
  };
}
