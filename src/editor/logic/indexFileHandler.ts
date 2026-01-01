/**
 * Index.json の読み書きユーティリティ
 */
import type { Scenario } from "@/types/scenario";

interface IndexScenarioEntry {
  id: string;
  title: string;
  description: string;
  path: string;
}

interface IndexData {
  difficulties: Record<
    string,
    {
      label: string;
      scenarios: IndexScenarioEntry[];
    }
  >;
}

const DEFAULT_INDEX_DATA: IndexData = {
  difficulties: {
    beginner: {
      label: "入門",
      scenarios: [],
    },
    intermediate: {
      label: "初級",
      scenarios: [],
    },
    advanced: {
      label: "中級",
      scenarios: [],
    },
  },
};

const cloneDefaultIndex = (): IndexData =>
  JSON.parse(JSON.stringify(DEFAULT_INDEX_DATA)) as IndexData;

const saveIndexJson = async (
  dirHandle: FileSystemDirectoryHandle,
  data: IndexData,
): Promise<void> => {
  const indexHandle = await dirHandle.getFileHandle("index.json", {
    create: true,
  });
  const writable = await indexHandle.createWritable();
  const json = JSON.stringify(data, null, 2);
  console.warn("📄 index.json 内容:", `${json.substring(0, 200)}...`);
  await writable.write(json);
  await writable.close();
};

export const regenerateScenarioIndex = async (
  dirHandle: FileSystemDirectoryHandle,
  scenario: Scenario,
): Promise<void> => {
  const indexData = cloneDefaultIndex();
  const difficultyKey = scenario.difficulty;
  const entry: IndexScenarioEntry = {
    id: scenario.id,
    title: scenario.title,
    description: scenario.description,
    path: `${difficultyKey}/${scenario.id}.json`,
  };

  indexData.difficulties[difficultyKey] = {
    ...(indexData.difficulties[difficultyKey] ?? {
      label: difficultyKey,
      scenarios: [],
    }),
    scenarios: [entry],
  };

  await saveIndexJson(dirHandle, indexData);
  console.warn("✅ index.json を再生成しました");
};
