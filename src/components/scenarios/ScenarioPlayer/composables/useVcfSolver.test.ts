import { setActivePinia, createPinia } from "pinia";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { BoardState } from "@/types/game";
import type { QuestionSection } from "@/types/scenario";

import { useVcfSolver } from "./useVcfSolver";

// === Mocks ===

const mockBoard: BoardState = Array(15)
  .fill(null)
  .map(() => Array(15).fill(null));

const mockAddStones = vi.fn(() => [
  { id: "vcf-0-0", position: { row: 0, col: 0 }, color: "black" as const },
]);
const mockSetBoard = vi.fn();
const mockAddMarks = vi.fn(() => []);
const mockRemoveMarks = vi.fn();
const mockClearMarks = vi.fn();
const mockClearLines = vi.fn();

vi.mock("@/stores/boardStore", () => ({
  useBoardStore: () => ({
    board: mockBoard,
    addStones: mockAddStones,
    setBoard: mockSetBoard,
    addMarks: mockAddMarks,
    removeMarks: mockRemoveMarks,
    clearMarks: mockClearMarks,
    clearLines: mockClearLines,
  }),
  cloneBoard: (board: BoardState) => board.map((row) => [...row]),
}));

const mockShowMessage = vi.fn();
vi.mock("@/stores/dialogStore", () => ({
  useDialogStore: () => ({
    showMessage: mockShowMessage,
  }),
}));

const mockCompleteSection = vi.fn();
vi.mock("@/stores/progressStore", () => ({
  useProgressStore: () => ({
    completeSection: mockCompleteSection,
  }),
}));

vi.mock("@/stores/audioStore", () => ({
  useAudioStore: () => ({
    playSfx: vi.fn(),
  }),
}));

const mockAnimatingIds = new Set<string>();
vi.mock("@/stores/scenarioAnimationStore", () => ({
  useScenarioAnimationStore: () => ({
    animatingIds: mockAnimatingIds,
    prepareForAnimation: vi.fn(),
    animateStones: vi.fn(() => Promise.resolve()),
  }),
}));

// VCFロジックをモック
const mockValidateAttackMove = vi.fn();
const mockGetDefenseResponse = vi.fn();
const mockFindDummyDefensePosition = vi.fn();

vi.mock("@/logic/vcfPuzzle", () => ({
  validateAttackMove: (...args: unknown[]) => mockValidateAttackMove(...args),
  getDefenseResponse: (...args: unknown[]) => mockGetDefenseResponse(...args),
  findDummyDefensePosition: (...args: unknown[]) =>
    mockFindDummyDefensePosition(...args),
}));

// === Test helpers ===

const createVcfQuestionSection = (
  overrides: Partial<QuestionSection> = {},
): QuestionSection => ({
  id: "vcf-question-1",
  type: "question",
  title: "VCF問題",
  initialBoard: Array(15).fill("-".repeat(15)),
  description: [],
  dialogues: [
    {
      id: "d1",
      character: "fubuki",
      text: [],
      emotion: 0,
      boardActions: [],
    },
  ],
  successOperator: "or",
  successConditions: [{ type: "vcf", color: "black" }],
  feedback: {
    success: [{ character: "fubuki", text: [], emotion: 0 }],
    failure: [{ character: "miko", text: [], emotion: 1 }],
  },
  ...overrides,
});

describe("useVcfSolver", () => {
  // eslint-disable-next-line init-declarations
  let onSectionComplete: () => void;
  // eslint-disable-next-line init-declarations
  let onShowCorrectCutin: () => void;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    onSectionComplete = vi.fn();
    onShowCorrectCutin = vi.fn();

    // boardをリセット
    for (let i = 0; i < 15; i++) {
      for (let j = 0; j < 15; j++) {
        mockBoard[i][j] = null;
      }
    }

    mockAnimatingIds.clear();
  });

  describe("handleVcfPlaceStone", () => {
    it("isSectionCompleted=true の場合は何もしない", async () => {
      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, true);

      expect(mockValidateAttackMove).not.toHaveBeenCalled();
    });

    it("無効な手（not-four）→ クロスマーク表示、カットインなし", async () => {
      mockValidateAttackMove.mockReturnValue({
        valid: false,
        reason: "not-four",
      });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      expect(mockAddMarks).toHaveBeenCalled();
      expect(mockShowMessage).toHaveBeenCalled();
      expect(onShowCorrectCutin).not.toHaveBeenCalled();
    });

    it("五連達成 → 成功処理", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "five" });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      expect(mockAddStones).toHaveBeenCalled();
      expect(onSectionComplete).toHaveBeenCalled();
      expect(onShowCorrectCutin).toHaveBeenCalled();
    });

    it("有効な四 + 通常防御 → 石配置 + 防御石配置", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({
        type: "blocked",
        position: { row: 7, col: 8 },
      });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 攻撃石 + 防御石の2回addStones
      expect(mockAddStones).toHaveBeenCalledTimes(2);
      expect(onSectionComplete).not.toHaveBeenCalled();
    });

    it("禁手陥穽 → 即成功", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({ type: "forbidden-trap" });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      expect(onSectionComplete).toHaveBeenCalled();
      expect(onShowCorrectCutin).toHaveBeenCalled();
    });

    it("活四 → ダミー防御石配置、次の手を待つ", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({
        type: "open-four",
        winPositions: [
          { row: 7, col: 3 },
          { row: 7, col: 8 },
        ],
      });
      mockFindDummyDefensePosition.mockReturnValue({ row: 0, col: 0 });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 攻撃石 + ダミー防御石
      expect(mockAddStones).toHaveBeenCalledTimes(2);
      expect(onSectionComplete).not.toHaveBeenCalled();
    });

    it("カウンターフォー → 防御石+CPU五連石配置 → 失敗", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({
        type: "counter-five",
        defensePos: { row: 7, col: 8 },
        winPos: { row: 8, col: 8 },
      });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 攻撃石 + 防御石 + CPU五連石 = 3回
      expect(mockAddStones).toHaveBeenCalledTimes(3);
      expect(onSectionComplete).not.toHaveBeenCalled();
      // 失敗フィードバック
      expect(mockShowMessage).toHaveBeenCalled();
    });
  });

  describe("resetVcf", () => {
    it("初期盤面に戻る", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({
        type: "blocked",
        position: { row: 7, col: 8 },
      });

      const { handleVcfPlaceStone, resetVcf } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
      );
      const section = createVcfQuestionSection();

      // 1手打つ
      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // リセット
      resetVcf();

      expect(mockSetBoard).toHaveBeenCalled();
      expect(mockClearMarks).toHaveBeenCalled();
      expect(mockClearLines).toHaveBeenCalled();
    });
  });

  describe("isResetAvailable", () => {
    it("1手も打っていない場合はfalse", () => {
      const { isResetAvailable } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
      );

      expect(isResetAvailable.value).toBe(false);
    });
  });
});
