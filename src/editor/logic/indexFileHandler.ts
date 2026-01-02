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

const scanDifficultyDirectory = async (
  diffDir: FileSystemDirectoryHandle,
  difficulty: string,
): Promise<IndexScenarioEntry[]> => {
  const scenarios: IndexScenarioEntry[] = [];

  // @ts-expect-error entriesは存在するはず
  for await (const [name, handle] of diffDir.entries()) {
    if (!name.endsWith(".json") || handle.kind !== "file") {
      // eslint-disable-next-line no-continue
      continue;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.id && data.title && data.description) {
      scenarios.push({
        id: data.id,
        title: data.title,
        description: data.description,
        path: `${difficulty}/${name}`,
      });
    }
  }

  return scenarios;
};

export const regenerateScenarioIndex = async (
  dirHandle: FileSystemDirectoryHandle,
  scenario: Scenario | null,
): Promise<void> => {
  const indexData = cloneDefaultIndex();

  if (scenario) {
    // 特定のシナリオだけを更新
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
  } else {
    // すべての難易度ディレクトリをスキャンしてindex.jsonを再生成
    const difficulties = ["beginner", "intermediate", "advanced"] as const;

    // eslint-disable-next-line no-await-in-loop
    for (const difficulty of difficulties) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const diffDir = await dirHandle.getDirectoryHandle(difficulty, {
          create: false,
        });
        // eslint-disable-next-line no-await-in-loop
        const scenarios = await scanDifficultyDirectory(diffDir, difficulty);

        if (scenarios.length > 0) {
          indexData.difficulties[difficulty] = {
            label: difficulty,
            scenarios,
          };
        }
      } catch {
        // ディレクトリが存在しない場合はスキップ
        console.warn(`難易度ディレクトリ '${difficulty}' が見つかりません`);
      }
    }
  }

  await saveIndexJson(dirHandle, indexData);
  console.warn("✅ index.json を再生成しました");
};
