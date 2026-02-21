/**
 * Index.json の読み書きユーティリティ
 */
import {
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  type Scenario,
  type ScenarioDifficulty,
  type ScenarioMeta,
} from "@/types/scenario";

export { DIFFICULTY_LABELS };

interface IndexData {
  difficulties: Record<
    ScenarioDifficulty,
    {
      label: string;
      scenarios: ScenarioMeta[];
    }
  >;
}

const createDefaultIndexData = (): IndexData => ({
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

const DEFAULT_INDEX_DATA: IndexData = createDefaultIndexData();

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
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writable.write(json);
  await writable.close();
};

const scanDifficultyDirectory = async (
  diffDir: FileSystemDirectoryHandle,
  difficulty: ScenarioDifficulty,
): Promise<ScenarioMeta[]> => {
  const scenarios: ScenarioMeta[] = [];

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

/**
 * 指定された順序でシナリオを並び替えたindex.jsonを生成
 * 既存の順序を保持し、新規ファイルは末尾に追加、削除されたものは除去
 */
export const regenerateScenarioIndexWithOrder = async (
  dirHandle: FileSystemDirectoryHandle,
  currentIndexData: IndexData,
  reorderedData: Partial<Record<ScenarioDifficulty, string[]>>,
): Promise<void> => {
  const indexData = cloneDefaultIndex();
  const difficulties = DIFFICULTIES;

  // eslint-disable-next-line no-await-in-loop
  for (const difficulty of difficulties) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const diffDir = await dirHandle.getDirectoryHandle(difficulty, {
        create: false,
      });
      // eslint-disable-next-line no-await-in-loop
      const allScenarios = await scanDifficultyDirectory(diffDir, difficulty);

      // reorderedDataの順序に従ってソート
      const orderedIds = reorderedData[difficulty] ?? [];
      const scenarioMap = new Map(allScenarios.map((s) => [s.id, s]));

      // 指定された順序でシナリオを配置
      const orderedScenarios: ScenarioMeta[] = [];
      for (const id of orderedIds) {
        const scenario = scenarioMap.get(id);
        if (scenario) {
          orderedScenarios.push(scenario);
        }
      }

      // ファイルシステムに新規存在するがindex.jsonに載っていないものを末尾に追加
      for (const scenario of allScenarios) {
        if (!orderedIds.includes(scenario.id)) {
          orderedScenarios.push(scenario);
        }
      }

      if (orderedScenarios.length > 0) {
        indexData.difficulties[difficulty] = {
          label:
            currentIndexData.difficulties[difficulty]?.label ??
            DIFFICULTY_LABELS[difficulty],
          scenarios: orderedScenarios,
        };
      }
    } catch {
      // ディレクトリが存在しない場合はスキップ
      // ディレクトリが存在しない場合はスキップ
    }
  }

  await saveIndexJson(dirHandle, indexData);
};

export const regenerateScenarioIndex = async (
  dirHandle: FileSystemDirectoryHandle,
  scenario: Scenario | null,
): Promise<void> => {
  const indexData = cloneDefaultIndex();

  if (scenario) {
    // 特定のシナリオだけを更新
    const difficultyKey = scenario.difficulty;
    const entry: ScenarioMeta = {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      path: `${difficultyKey}/${scenario.id}.json`,
    };

    indexData.difficulties[difficultyKey] = {
      ...(indexData.difficulties[difficultyKey] ?? {
        label: DIFFICULTY_LABELS[difficultyKey] ?? difficultyKey,
        scenarios: [],
      }),
      scenarios: [entry],
    };
  } else {
    // すべての難易度ディレクトリをスキャンしてindex.jsonを再生成
    const difficulties = DIFFICULTIES;

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
            label: DIFFICULTY_LABELS[difficulty],
            scenarios,
          };
        }
      } catch {
        // ディレクトリが存在しない場合はスキップ
        // ディレクトリが存在しない場合はスキップ
      }
    }
  }

  await saveIndexJson(dirHandle, indexData);
};
