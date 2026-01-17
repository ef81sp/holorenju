import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import type { Scenario, DemoSection, QuestionSection } from "@/types/scenario";

import { useScenarioNavigation } from "./useScenarioNavigation";

// ストアモック用の変数
const mockSetCurrentScene = vi.fn();
const mockGoToScenarioList = vi.fn();
const mockResetAll = vi.fn();
const mockSetBoard = vi.fn();
const mockClearStones = vi.fn();
const mockClearMarks = vi.fn();
const mockClearLines = vi.fn();
const mockAddStones = vi.fn().mockReturnValue([]);
const mockAddMarks = vi.fn().mockReturnValue([]);
const mockAddLines = vi.fn().mockReturnValue([]);
const mockShowMessage = vi.fn();
const mockClearMessage = vi.fn();
const mockStartScenario = vi.fn();
const mockCompleteScenario = vi.fn();
const mockGetProgress = vi.fn().mockReturnValue(null);
const mockBoardData = {
  board: Array(15)
    .fill(null)
    .map(() => Array(15).fill(null)),
  stones: [] as unknown[],
  marks: [] as unknown[],
  lines: [] as unknown[],
};
// scenarioAnimationStore用のモック
const mockCancelOngoingAnimations = vi.fn();
const mockAnimateStones = vi.fn().mockResolvedValue(undefined);
const mockAnimateMarks = vi.fn().mockResolvedValue(undefined);
const mockAnimateLines = vi.fn().mockResolvedValue(undefined);

vi.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    setCurrentScene: mockSetCurrentScene,
    goToScenarioList: mockGoToScenarioList,
  }),
}));

vi.mock("@/stores/boardStore", () => ({
  useBoardStore: () => ({
    resetAll: mockResetAll,
    setBoard: mockSetBoard,
    clearStones: mockClearStones,
    clearMarks: mockClearMarks,
    clearLines: mockClearLines,
    addStones: mockAddStones,
    addMarks: mockAddMarks,
    addLines: mockAddLines,
    get board() {
      return mockBoardData.board;
    },
    get stones() {
      return mockBoardData.stones;
    },
    get marks() {
      return mockBoardData.marks;
    },
    get lines() {
      return mockBoardData.lines;
    },
  }),
}));

vi.mock("@/stores/scenarioAnimationStore", () => ({
  useScenarioAnimationStore: () => ({
    cancelOngoingAnimations: mockCancelOngoingAnimations,
    animateStones: mockAnimateStones,
    animateMarks: mockAnimateMarks,
    animateLines: mockAnimateLines,
  }),
}));

vi.mock("@/stores/dialogStore", () => ({
  useDialogStore: () => ({
    showMessage: mockShowMessage,
    clearMessage: mockClearMessage,
  }),
}));

vi.mock("@/stores/progressStore", () => ({
  useProgressStore: () => ({
    startScenario: mockStartScenario,
    completeScenario: mockCompleteScenario,
    getProgress: mockGetProgress,
  }),
}));

vi.mock("@/logic/scenarioFileHandler", () => ({
  boardStringToBoardState: vi.fn(() =>
    Array(15)
      .fill(null)
      .map(() => Array(15).fill(null)),
  ),
}));

vi.mock("@/logic/scenarioParser", () => ({
  parseScenario: vi.fn((data: unknown) => data),
}));

// scenarios/index.json のモック
vi.mock("@/data/scenarios/index.json", () => ({
  default: {
    difficulties: {
      gomoku_beginner: {
        scenarios: [{ id: "test-scenario", path: "gomoku_beginner/test.json" }],
      },
    },
  },
}));

// テスト用シナリオデータ
function createTestScenario(): Scenario {
  const demoSection: DemoSection = {
    id: "section-1",
    type: "demo",
    title: "Demo Section",
    initialBoard: Array(15).fill("-".repeat(15)),
    dialogues: [
      {
        id: "dialogue-1",
        character: "fubuki",
        emotion: 0,
        text: [{ type: "text", content: "First dialogue" }],
        boardActions: [],
      },
      {
        id: "dialogue-2",
        character: "miko",
        emotion: 0,
        text: [{ type: "text", content: "Second dialogue" }],
        boardActions: [],
      },
    ],
  };

  const questionSection: QuestionSection = {
    id: "section-2",
    type: "question",
    title: "Question Section",
    description: [{ type: "text", content: "Question description" }],
    initialBoard: Array(15).fill("-".repeat(15)),
    dialogues: [
      {
        id: "dialogue-3",
        character: "fubuki",
        emotion: 0,
        text: [{ type: "text", content: "Third dialogue" }],
        boardActions: [],
      },
    ],
    successConditions: [
      { type: "position", positions: [{ row: 7, col: 7 }], color: "black" },
    ],
    feedback: { success: [], failure: [] },
  };

  return {
    id: "test-scenario",
    title: "Test Scenario",
    difficulty: "gomoku_beginner",
    description: "A test scenario",
    objectives: ["Test objective"],
    sections: [demoSection, questionSection],
  };
}

describe("useScenarioNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockBoardData.board = Array(15)
      .fill(null)
      .map(() => Array(15).fill(null));
    mockBoardData.stones = [];
    mockBoardData.marks = [];
    mockBoardData.lines = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("初期状態", () => {
    it("scenarioはnull", () => {
      const { scenario } = useScenarioNavigation("test-scenario");

      expect(scenario.value).toBeNull();
    });

    it("currentSectionIndexは0", () => {
      const { currentSectionIndex } = useScenarioNavigation("test-scenario");

      expect(currentSectionIndex.value).toBe(0);
    });

    it("currentDialogueIndexは0", () => {
      const { currentDialogueIndex } = useScenarioNavigation("test-scenario");

      expect(currentDialogueIndex.value).toBe(0);
    });

    it("isSectionCompletedはfalse", () => {
      const { isSectionCompleted } = useScenarioNavigation("test-scenario");

      expect(isSectionCompleted.value).toBe(false);
    });

    it("allDialoguesは空配列", () => {
      const { allDialogues } = useScenarioNavigation("test-scenario");

      expect(allDialogues.value).toEqual([]);
    });

    it("demoDescriptionNodesは空配列", () => {
      const { demoDescriptionNodes } = useScenarioNavigation("test-scenario");

      expect(demoDescriptionNodes.value).toEqual([]);
    });
  });

  describe("computed values", () => {
    it("currentSectionはscenarioがnullの場合null", () => {
      const { currentSection } = useScenarioNavigation("test-scenario");

      expect(currentSection.value).toBeNull();
    });

    it("canNavigatePreviousはindex=0でfalse", () => {
      const { canNavigatePrevious } = useScenarioNavigation("test-scenario");

      expect(canNavigatePrevious.value).toBe(false);
    });

    it("canNavigateNextはallDialoguesが空でfalse", () => {
      const { canNavigateNext } = useScenarioNavigation("test-scenario");

      expect(canNavigateNext.value).toBe(false);
    });

    it("isScenarioDoneは初期状態でfalse", () => {
      const { isScenarioDone } = useScenarioNavigation("test-scenario");

      expect(isScenarioDone.value).toBe(false);
    });

    it("showNextSectionButtonはinitialでfalse", () => {
      const { showNextSectionButton } = useScenarioNavigation("test-scenario");

      expect(showNextSectionButton.value).toBe(false);
    });
  });

  describe("データセット後のcomputed values", () => {
    it("currentSectionが正しく返される", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
        {
          dialogue: testScenario.sections[1].dialogues[0],
          sectionIndex: 1,
          sectionDialogueIndex: 0,
        },
      ];

      expect(nav.currentSection.value?.id).toBe("section-1");
    });

    it("canNavigatePreviousがindex>0でtrue", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];
      nav.currentDialogueIndex.value = 1;

      expect(nav.canNavigatePrevious.value).toBe(true);
    });

    it("canNavigateNextがallDialogues未満でtrue", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];
      nav.currentDialogueIndex.value = 0;

      expect(nav.canNavigateNext.value).toBe(true);
    });

    it("isScenarioDoneは最後のデモセクションの最後のダイアログでtrue", () => {
      const nav = useScenarioNavigation("test-scenario");
      const demoOnlyScenario: Scenario = {
        id: "demo-only",
        title: "Demo Only",
        difficulty: "gomoku_beginner",
        description: "",
        objectives: [],
        sections: [
          {
            id: "section-1",
            type: "demo",
            title: "Demo",
            initialBoard: Array(15).fill("-".repeat(15)),
            dialogues: [
              {
                id: "d-1",
                character: "fubuki",
                emotion: 0,
                text: [{ type: "text", content: "End" }],
                boardActions: [],
              },
            ],
          },
        ],
      };

      nav.scenario.value = demoOnlyScenario;
      nav.allDialogues.value = [
        {
          dialogue: demoOnlyScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
      ];
      nav.currentSectionIndex.value = 0;
      nav.currentDialogueIndex.value = 0;

      expect(nav.isScenarioDone.value).toBe(true);
    });

    it("showNextSectionButtonは問題セクション完了かつ次セクションありでtrue", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      // section-2はquestion、section-1がdemoなので逆にして最初をquestionにする
      const modifiedScenario: Scenario = {
        ...testScenario,
        sections: [testScenario.sections[1], testScenario.sections[0]],
      };

      nav.scenario.value = modifiedScenario;
      nav.allDialogues.value = [
        {
          dialogue: modifiedScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: modifiedScenario.sections[1].dialogues[0],
          sectionIndex: 1,
          sectionDialogueIndex: 0,
        },
      ];
      nav.currentSectionIndex.value = 0;
      nav.isSectionCompleted.value = true;

      expect(nav.showNextSectionButton.value).toBe(true);
    });
  });

  describe("nextDialogue", () => {
    it("次のダイアログに進む", async () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];
      nav.currentDialogueIndex.value = 0;

      await nav.nextDialogue();

      expect(nav.currentDialogueIndex.value).toBe(1);
    });

    it("cancelOngoingAnimationsが呼ばれる", async () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];

      await nav.nextDialogue();

      expect(mockCancelOngoingAnimations).toHaveBeenCalled();
    });

    it("showMessageが呼ばれる", async () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];

      await nav.nextDialogue();

      expect(mockShowMessage).toHaveBeenCalled();
    });

    it("シナリオ最後で何もしない", async () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
      ];
      nav.currentDialogueIndex.value = 0;

      await nav.nextDialogue();

      expect(nav.currentDialogueIndex.value).toBe(0);
    });
  });

  describe("previousDialogue", () => {
    it("前のダイアログに戻る", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];
      nav.currentDialogueIndex.value = 1;

      nav.previousDialogue();

      expect(nav.currentDialogueIndex.value).toBe(0);
    });

    it("シナリオ最初で何もしない", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
      ];
      nav.currentDialogueIndex.value = 0;

      nav.previousDialogue();

      expect(nav.currentDialogueIndex.value).toBe(0);
    });

    it("showMessageが呼ばれる", () => {
      const nav = useScenarioNavigation("test-scenario");
      const testScenario = createTestScenario();

      nav.scenario.value = testScenario;
      nav.allDialogues.value = [
        {
          dialogue: testScenario.sections[0].dialogues[0],
          sectionIndex: 0,
          sectionDialogueIndex: 0,
        },
        {
          dialogue: testScenario.sections[0].dialogues[1],
          sectionIndex: 0,
          sectionDialogueIndex: 1,
        },
      ];
      nav.currentDialogueIndex.value = 1;

      nav.previousDialogue();

      expect(mockShowMessage).toHaveBeenCalled();
    });
  });

  describe("completeScenario", () => {
    it("progressStore.completeScenarioが呼ばれる", () => {
      const { completeScenario } = useScenarioNavigation("test-scenario");

      completeScenario();

      expect(mockCompleteScenario).toHaveBeenCalledWith("test-scenario");
    });

    it("appStore.goToScenarioListが呼ばれる", () => {
      const { completeScenario } = useScenarioNavigation("test-scenario");

      completeScenario();

      expect(mockGoToScenarioList).toHaveBeenCalled();
    });
  });

  describe("goBack", () => {
    it("appStore.goToScenarioListが呼ばれる", () => {
      const { goBack } = useScenarioNavigation("test-scenario");

      goBack();

      expect(mockGoToScenarioList).toHaveBeenCalled();
    });
  });
});
