/**
 * ゲームブラウザのデータ読み込み・フィルタ・再生ロジック
 */

import type {
  AnalysisResult,
  BrowseFilter,
  GameAnalysis,
  MoveAnalysis,
} from "@scripts/types/analysis";

import { matchesFilter } from "@scripts/lib/gameFilter";
import { computed, ref, watch } from "vue";

import type { StoneLabel } from "@/components/game/RenjuBoard/RenjuBoard.vue";
import type { BoardState, StoneColor } from "@/types/game";

function createEmptyBoard(): BoardState {
  return Array.from({ length: 15 }, () =>
    Array.from<StoneColor | null>({ length: 15 }).fill(null),
  );
}

function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => [...row]);
}

export function useGameBrowser() {
  // ===== データ読み込み =====
  const analysisResult = ref<AnalysisResult | null>(null);
  const availableFiles = ref<string[]>([]);
  const selectedFile = ref<string | null>(null);
  const isLoading = ref(false);
  const loadError = ref<string | null>(null);

  const loadFile = async (filename: string): Promise<void> => {
    isLoading.value = true;
    loadError.value = null;
    selectedFile.value = filename;
    selectedGameIndex.value = null;
    try {
      const dataRes = await fetch(`/api/analysis-data/${filename}`);
      analysisResult.value = await dataRes.json();
    } catch (e) {
      loadError.value = `読み込みエラー: ${e}`;
    } finally {
      isLoading.value = false;
    }
  };

  const loadLatestAnalysis = async (): Promise<void> => {
    isLoading.value = true;
    loadError.value = null;
    try {
      const res = await fetch("/api/analysis-files");
      const files = (await res.json()) as string[];
      availableFiles.value = files;
      if (files.length === 0) {
        loadError.value = "分析ファイルが見つかりません";
        return;
      }
      const latest = files[files.length - 1]!;
      await loadFile(latest);
    } catch (e) {
      loadError.value = `読み込みエラー: ${e}`;
    } finally {
      isLoading.value = false;
    }
  };

  // ===== フィルタ =====
  const filter = ref<BrowseFilter>({});

  const allGames = computed(() => analysisResult.value?.games ?? []);

  const filteredGames = computed(() =>
    allGames.value.filter((game) => matchesFilter(game, filter.value)),
  );

  // フィルタ選択肢の計算
  const availableMatchups = computed(() => {
    const set = new Set(allGames.value.map((g) => g.matchup));
    return [...set].sort();
  });

  const availableJushu = computed(() => {
    const set = new Set<string>();
    for (const g of allGames.value) {
      if (g.opening?.jushu) {
        set.add(g.opening.jushu);
      }
    }
    return [...set].sort();
  });

  const availableTags = computed(() => {
    const counts = new Map<string, number>();
    for (const g of allGames.value) {
      for (const tag of g.gameTags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  });

  const availableSourceFiles = computed(() => {
    const set = new Set(allGames.value.map((g) => g.sourceFile));
    return [...set].sort().reverse();
  });

  // ===== ゲーム選択・再生 =====
  const selectedGameIndex = ref<number | null>(null);
  const moveIndex = ref(0);

  const selectedGame = computed<GameAnalysis | null>(() => {
    if (selectedGameIndex.value === null) {
      return null;
    }
    return filteredGames.value[selectedGameIndex.value] ?? null;
  });

  const selectGame = (index: number): void => {
    selectedGameIndex.value = index;
    moveIndex.value = 0;
  };

  // ゲーム選択が変わったら手数をリセット
  watch(selectedGameIndex, () => {
    moveIndex.value = 0;
  });

  // 全手順の盤面を事前計算
  const allBoards = computed<BoardState[]>(() => {
    const game = selectedGame.value;
    if (!game) {
      return [createEmptyBoard()];
    }

    const boards: BoardState[] = [createEmptyBoard()];
    for (const move of game.moves) {
      const prev = boards[boards.length - 1]!;
      const next = cloneBoard(prev);
      const row = next[move.position.row];
      if (row) {
        row[move.position.col] = move.color;
      }
      boards.push(next);
    }
    return boards;
  });

  const currentBoard = computed<BoardState>(
    () => allBoards.value[moveIndex.value] ?? createEmptyBoard(),
  );

  const totalMoves = computed(() => selectedGame.value?.moves.length ?? 0);

  const currentMoveAnalysis = computed<MoveAnalysis | null>(() => {
    if (moveIndex.value === 0) {
      return null;
    }
    return selectedGame.value?.moves[moveIndex.value - 1] ?? null;
  });

  // 手番号ラベル
  const stoneLabels = computed(() => {
    const labels = new Map<string, StoneLabel>();
    const game = selectedGame.value;
    if (!game) {
      return labels;
    }

    for (let i = 0; i < moveIndex.value && i < game.moves.length; i++) {
      const move = game.moves[i]!;
      const key = `${move.position.row},${move.position.col}`;
      labels.set(key, {
        text: String(i + 1),
        color: move.color === "black" ? "white" : "black",
      });
    }
    return labels;
  });

  // ナビゲーション
  const goToFirst = (): void => {
    moveIndex.value = 0;
  };
  const goToPrev = (): void => {
    if (moveIndex.value > 0) {
      moveIndex.value--;
    }
  };
  const goToNext = (): void => {
    if (moveIndex.value < totalMoves.value) {
      moveIndex.value++;
    }
  };
  const goToLast = (): void => {
    moveIndex.value = totalMoves.value;
  };
  const goToMove = (n: number): void => {
    moveIndex.value = Math.max(0, Math.min(n, totalMoves.value));
  };

  return {
    // データ
    isLoading,
    loadError,
    loadLatestAnalysis,
    analysisResult,
    // フィルタ
    filter,
    filteredGames,
    availableMatchups,
    availableJushu,
    availableTags,
    availableSourceFiles,
    // ゲーム選択・再生
    selectedGameIndex,
    selectedGame,
    selectGame,
    moveIndex,
    totalMoves,
    currentBoard,
    currentMoveAnalysis,
    stoneLabels,
    // ナビゲーション
    goToFirst,
    goToPrev,
    goToNext,
    goToLast,
    goToMove,
  };
}
