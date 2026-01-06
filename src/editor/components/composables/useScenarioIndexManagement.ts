import { ref, nextTick, type Ref } from "vue";

import { regenerateScenarioIndexWithOrder } from "@/editor/logic/indexFileHandler";

interface IndexData {
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
}

interface DialogRefType {
  showModal: () => void;
}

interface UseScenarioIndexManagementReturn {
  currentIndexData: Ref<IndexData | null>;
  handleGenerateIndex: (
    scenarioDir: FileSystemDirectoryHandle | null,
    reorderDialogRef: DialogRefType | null,
  ) => Promise<void>;
  handleReorderConfirm: (
    reorderedData: Record<string, string[]>,
    scenarioDir: FileSystemDirectoryHandle | null,
  ) => Promise<void>;
}

export function useScenarioIndexManagement(): UseScenarioIndexManagementReturn {
  const currentIndexData: Ref<IndexData | null> = ref<IndexData | null>(null);

  /**
   * Index 生成ダイアログを開く（index.json を読み込んで表示）
   */
  const handleGenerateIndex = async (
    scenarioDir: FileSystemDirectoryHandle | null,
    reorderDialogRef: DialogRefType | null,
  ): Promise<void> => {
    if (!scenarioDir) {
      console.warn("先にディレクトリを選択してください");
      return;
    }

    try {
      // 現在のindex.jsonを読み込む
      const indexHandle = await scenarioDir.getFileHandle("index.json", {
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
    reorderDialogRef?.showModal();
  };

  /**
   * シナリオの並べ替えを確定し、index.json を再生成
   */
  const handleReorderConfirm = async (
    reorderedData: Record<string, string[]>,
    scenarioDir: FileSystemDirectoryHandle | null,
  ): Promise<void> => {
    if (!scenarioDir || !currentIndexData.value) {
      console.error("Invalid state");
      return;
    }

    try {
      console.warn("🔄 index.json を再生成中...");
      await regenerateScenarioIndexWithOrder(
        scenarioDir,
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

  return {
    currentIndexData,
    handleGenerateIndex,
    handleReorderConfirm,
  };
}
