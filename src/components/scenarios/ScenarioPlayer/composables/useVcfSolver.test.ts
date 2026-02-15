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
const mockHasRemainingAttacks = vi.fn((..._args: unknown[]) => true);

vi.mock("@/logic/vcfPuzzle", () => ({
  validateAttackMove: (...args: unknown[]) => mockValidateAttackMove(...args),
  getDefenseResponse: (...args: unknown[]) => mockGetDefenseResponse(...args),
  findDummyDefensePosition: (...args: unknown[]) =>
    mockFindDummyDefensePosition(...args),
  hasRemainingAttacks: (...args: unknown[]) => mockHasRemainingAttacks(...args),
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
  // eslint-disable-next-line init-declarations
  let onShowIncorrectCutin: () => void;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    onSectionComplete = vi.fn();
    onShowCorrectCutin = vi.fn();
    onShowIncorrectCutin = vi.fn();

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
        onShowIncorrectCutin,
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
        onShowIncorrectCutin,
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
        onShowIncorrectCutin,
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
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 攻撃石 + 防御石の2回addStones
      expect(mockAddStones).toHaveBeenCalledTimes(2);
      expect(onSectionComplete).not.toHaveBeenCalled();
    });

    it("通常防御後に攻め手が尽きた → 失敗", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({
        type: "blocked",
        position: { row: 7, col: 8 },
      });
      mockHasRemainingAttacks.mockReturnValue(false);

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      expect(onSectionComplete).not.toHaveBeenCalled();
      // 失敗カットイン + フィードバック
      expect(onShowIncorrectCutin).toHaveBeenCalled();
      expect(mockShowMessage).toHaveBeenCalled();
    });

    it("禁手陥穽 → 即成功", async () => {
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });
      mockGetDefenseResponse.mockReturnValue({ type: "forbidden-trap" });

      const { handleVcfPlaceStone } = useVcfSolver(
        "scenario-1",
        onSectionComplete,
        onShowCorrectCutin,
        onShowIncorrectCutin,
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
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 攻撃石 + ダミー防御石
      expect(mockAddStones).toHaveBeenCalledTimes(2);
      expect(onSectionComplete).not.toHaveBeenCalled();
    });

    it("カウンターフォー → 防御石配置のみ、プレイヤーの手を待つ", async () => {
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
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 攻撃石 + 防御石のみ（CPU五連石はまだ配置しない）
      expect(mockAddStones).toHaveBeenCalledTimes(2);
      expect(onSectionComplete).not.toHaveBeenCalled();
      expect(mockShowMessage).not.toHaveBeenCalled();
    });

    it("カウンターフォー後にプレイヤーが五連 → 成功", async () => {
      // 1手目: 四を作る → counter-five
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
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);

      // 2手目: プレイヤーが五連達成
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "five" });

      await handleVcfPlaceStone({ row: 7, col: 9 }, section, false);

      expect(onSectionComplete).toHaveBeenCalled();
      expect(onShowCorrectCutin).toHaveBeenCalled();
    });

    it("カウンターフォー後にプレイヤーが四 → CPU五連で失敗", async () => {
      // 1手目: 四を作る → counter-five
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
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);
      vi.clearAllMocks();

      // 2手目: プレイヤーが四（五連ではない）
      mockValidateAttackMove.mockReturnValue({ valid: true, type: "four" });

      await handleVcfPlaceStone({ row: 5, col: 5 }, section, false);

      // CPU五連石のみ配置（プレイヤーの石は配置しない）
      expect(mockAddStones).toHaveBeenCalledTimes(1);
      expect(onSectionComplete).not.toHaveBeenCalled();
      // 失敗カットイン + フィードバック
      expect(onShowIncorrectCutin).toHaveBeenCalled();
      expect(mockShowMessage).toHaveBeenCalled();
    });

    it("カウンターフォー後にプレイヤーが無効手 → CPU五連で失敗", async () => {
      // 1手目: 四を作る → counter-five
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
        onShowIncorrectCutin,
      );
      const section = createVcfQuestionSection();

      await handleVcfPlaceStone({ row: 7, col: 7 }, section, false);
      vi.clearAllMocks();

      // 2手目: 無効な手
      mockValidateAttackMove.mockReturnValue({
        valid: false,
        reason: "not-four",
      });

      await handleVcfPlaceStone({ row: 5, col: 5 }, section, false);

      // CPU五連石が配置される
      expect(mockAddStones).toHaveBeenCalled();
      expect(onSectionComplete).not.toHaveBeenCalled();
      // 失敗カットイン + フィードバック
      expect(onShowIncorrectCutin).toHaveBeenCalled();
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
        onShowIncorrectCutin,
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
