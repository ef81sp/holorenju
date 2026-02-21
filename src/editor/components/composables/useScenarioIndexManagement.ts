import { ref, nextTick, type Ref } from "vue";

import {
  DIFFICULTY_LABELS,
  regenerateScenarioIndexWithOrder,
} from "@/editor/logic/indexFileHandler";
import { DIFFICULTIES, type ScenarioDifficulty } from "@/types/scenario";

interface IndexData {
  difficulties: Record<
    ScenarioDifficulty,
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
    reorderedData: Partial<Record<ScenarioDifficulty, string[]>>,
    scenarioDir: FileSystemDirectoryHandle | null,
  ) => Promise<void>;
}

export function useScenarioIndexManagement(): UseScenarioIndexManagementReturn {
  const currentIndexData: Ref<IndexData | null> = ref<IndexData | null>(null);

  const createEmptyIndexData = (): IndexData => ({
    difficulties: DIFFICULTIES.reduce(
      (acc, difficulty) => {
        acc[difficulty] = {
          label: DIFFICULTY_LABELS[difficulty],
          scenarios: [],
        };
        return acc;
      },
      {} as IndexData["difficulties"],
    ),
  });

  const mergeIndexData = (data: IndexData): IndexData => {
    const empty = createEmptyIndexData();
    for (const [difficulty, value] of Object.entries(data.difficulties)) {
      if (!value) {
        continue;
      }
      const key = difficulty as ScenarioDifficulty;
      empty.difficulties[key] = {
        label: value.label ?? DIFFICULTY_LABELS[key],
        scenarios: value.scenarios ?? [],
      };
    }
    return empty;
  };

  /**
   * Index 生成ダイアログを開く（index.json を読み込んで表示）
   */
  const handleGenerateIndex = async (
    scenarioDir: FileSystemDirectoryHandle | null,
    reorderDialogRef: DialogRefType | null,
  ): Promise<void> => {
    if (!scenarioDir) {
      return;
    }

    try {
      // 現在のindex.jsonを読み込む
      const indexHandle = await scenarioDir.getFileHandle("index.json", {
        create: false,
      });
      const indexFile = await indexHandle.getFile();
      const indexText = await indexFile.text();
      currentIndexData.value = mergeIndexData(
        JSON.parse(indexText) as IndexData,
      );
    } catch {
      // index.json が存在しない場合は空の状態で開始
      currentIndexData.value = createEmptyIndexData();
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
      await regenerateScenarioIndexWithOrder(
        scenarioDir,
        currentIndexData.value,
        reorderedData,
      );
    } catch (error) {
      console.error("index.json の生成に失敗しました:", error);
    }
  };

  return {
    currentIndexData,
    handleGenerateIndex,
    handleReorderConfirm,
  };
}
