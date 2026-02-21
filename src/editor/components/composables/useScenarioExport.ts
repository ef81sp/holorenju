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
    // バリデーション実行（保存時は文字数チェックも行う）
    const result = validateScenarioCompletely(editorStore.scenario, {
      checkLength: true,
    });
    editorStore.setValidationErrors(
      result.errors.map((e) => ({ path: e.path, message: e.message })),
    );

    if (!result.isValid) {
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
    navigator.clipboard.writeText(json);
  };

  /**
   * クリップボードから JSON を読み込み
   */
  const handleJsonPaste = async (): Promise<void> => {
    try {
      const text = await navigator.clipboard.readText();

      const { parseScenario } = await import("@/logic/scenarioParser");
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
      console.error("クリップボードからの読み込みに失敗しました:", error);
    }
  };

  return {
    handleSave,
    handleJsonCopy,
    handleJsonPaste,
  };
}
