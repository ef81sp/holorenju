# テスト追加計画 Phase 2 - Tier 2（中テスト容易性）

## 対象ファイル（6ファイル）

| #   | ファイル                     | 依存                    | モック戦略                |
| --- | ---------------------------- | ----------------------- | ------------------------- |
| 6   | useCutinDisplay.ts           | Popover API, タイマー   | vi.useFakeTimers          |
| 7   | useQuestionSolver.ts         | 3ストア                 | 複数ストアモック          |
| 8   | useFullscreenPrompt.ts       | navigator, localStorage | vi.stubGlobal             |
| 9   | useScenarioExport.ts         | clipboard API           | navigator.clipboardモック |
| 10  | useScenarioFileOperations.ts | FileReader              | FileReaderモック          |
| 11  | scenarioFileHandler.ts       | File API, DOM           | File/DOMモック            |

---

## 6. useCutinDisplay.test.ts

**パス**: `src/components/scenarios/ScenarioPlayer/composables/useCutinDisplay.test.ts`

**特徴**: フェイクタイマーとPopover APIのモック

### テストケース

```typescript
describe("useCutinDisplay", () => {
  describe("showCutin", () => {
    it("popoverのshowPopoverが呼ばれる");
    it("isCutinVisibleがtrueになる");
    it("correctタイプでcutinTypeが設定される");
    it("wrongタイプでcutinTypeが設定される");
  });

  describe("自動非表示", () => {
    it("800ms後にhidePopoverが呼ばれる");
    it("タイマー中にhideCutinで即座に非表示");
  });

  describe("キーボードスキップ", () => {
    it("任意のキーでカットインが閉じる");
    it("非表示時はイベントリスナーが削除される");
  });

  describe("クリーンアップ", () => {
    it("onUnmountedでタイマーがクリアされる");
    it("onUnmountedでイベントリスナーが削除される");
  });
});
```

### モック例

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const mockCutinRef = {
  value: {
    showPopover: vi.fn(),
    hidePopover: vi.fn(),
  },
};

// タイマーテスト
showCutin("correct");
vi.advanceTimersByTime(800);
expect(mockCutinRef.value.hidePopover).toHaveBeenCalled();
```

---

## 7. useQuestionSolver.test.ts

**パス**: `src/components/scenarios/ScenarioPlayer/composables/useQuestionSolver.test.ts`

**特徴**: 複数ストアのモック、条件評価ロジック

### テストケース

```typescript
describe("useQuestionSolver", () => {
  describe("handlePlaceStone", () => {
    it("空セルに石を配置できる");
    it("占有セルには配置できない");
    it("配置後に条件評価が実行される");
  });

  describe("条件評価", () => {
    it("OR条件: いずれか1つ満たせば正解");
    it("AND条件: 全て満たさないと不正解");
    it("条件なしの場合は常に不正解");
  });

  describe("正解時", () => {
    it("onShowCorrectCutinコールバックが呼ばれる");
    it("successフィードバックが表示される");
    it("progressStoreに記録される");
  });

  describe("不正解時", () => {
    it("onShowIncorrectCutinコールバックが呼ばれる");
    it("failureフィードバックが表示される");
    it("盤面が復元される");
  });

  describe("盤面復元", () => {
    it("不正解時に元の盤面状態に戻る");
    it("複数手打った後も初期状態に戻る");
  });
});
```

### モック例

```typescript
vi.mock("@/stores/boardStore", () => ({
  useBoardStore: () => ({
    placeStone: vi.fn(() => ({ success: true })),
    board: Array(15)
      .fill(null)
      .map(() => Array(15).fill(null)),
    setBoard: vi.fn(),
  }),
}));

vi.mock("@/stores/dialogStore", () => ({
  useDialogStore: () => ({
    showMessage: vi.fn(),
  }),
}));

vi.mock("@/stores/progressStore", () => ({
  useProgressStore: () => ({
    recordSectionComplete: vi.fn(),
  }),
}));
```

---

## 8. useFullscreenPrompt.test.ts

**パス**: `src/logic/useFullscreenPrompt.test.ts`

**特徴**: ブラウザAPI（navigator, localStorage）のモック

### テストケース

```typescript
describe("useFullscreenPrompt", () => {
  describe("isMobile", () => {
    it("タッチポイントありでtrue");
    it("hover: noneでtrue");
    it("デスクトップでfalse");
  });

  describe("shouldShowPrompt", () => {
    it("モバイルで未dismissならtrue");
    it("dismiss済みならfalse");
    it("デスクトップならfalse");
  });

  describe("showPromptIfNeeded", () => {
    it("条件を満たせばshowModalが呼ばれる");
    it("条件を満たさなければ何もしない");
  });

  describe("dismissPrompt", () => {
    it("localStorageに保存される");
    it("neverShowAgain=trueでフラグが保存される");
  });
});
```

### モック例

```typescript
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

Object.defineProperty(navigator, "maxTouchPoints", {
  value: 1,
  writable: true,
});

vi.mock("@vueuse/core", () => ({
  useMediaQuery: vi.fn(() => ref(true)), // hover: none
}));
```

---

## 9. useScenarioExport.test.ts

**パス**: `src/editor/components/composables/useScenarioExport.test.ts`

**特徴**: clipboard APIのモック

### テストケース

```typescript
describe("useScenarioExport", () => {
  describe("handleSave", () => {
    it("バリデーション成功でダウンロードが実行される");
    it("バリデーション失敗でエラーが設定される");
  });

  describe("handleJsonCopy", () => {
    it("clipboardにJSONがコピーされる");
    it("成功メッセージが表示される");
  });

  describe("handleJsonPaste", () => {
    it("clipboardからJSONを読み込む");
    it("パース成功でシナリオが設定される");
    it("パース失敗でエラーが表示される");
    it("不正なJSONでエラーが表示される");
  });
});
```

### モック例

```typescript
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
  readText: vi.fn().mockResolvedValue('{"id":"test","title":"Test"}'),
};

Object.defineProperty(navigator, "clipboard", {
  value: mockClipboard,
  writable: true,
});
```

---

## 10. useScenarioFileOperations.test.ts

**パス**: `src/editor/components/composables/useScenarioFileOperations.test.ts`

**特徴**: FileReader APIのモック

### テストケース

```typescript
describe("useScenarioFileOperations", () => {
  describe("handleFileSelect", () => {
    it("有効なJSONファイルを読み込む");
    it("無効なJSONでエラーが設定される");
    it("バリデーション失敗でエラーが設定される");
  });

  describe("handleCreateNew", () => {
    it("空のシナリオが作成される");
    it("editorStoreに設定される");
  });

  describe("状態管理", () => {
    it("selectedFileが更新される");
    it("jsonInputが更新される");
    it("showJsonInputが切り替わる");
  });
});
```

### モック例

```typescript
class MockFileReader {
  result: string | null = null;
  onload: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;

  readAsText(file: File) {
    setTimeout(() => {
      this.result = '{"id":"test"}';
      this.onload?.({ target: this });
    }, 0);
  }
}

vi.stubGlobal("FileReader", MockFileReader);
```

---

## 11. scenarioFileHandler.test.ts

**パス**: `src/logic/scenarioFileHandler.test.ts`

**特徴**: 多数のユーティリティ関数、File/DOM API

### テストケース

```typescript
describe("scenarioFileHandler", () => {
  describe("parseScenarioFromText", () => {
    it("有効なJSONをパースする");
    it("無効なJSONでエラー");
  });

  describe("scenarioToJSON", () => {
    it("シナリオをJSON文字列に変換");
    it("整形されたJSONを出力");
  });

  describe("validateScenarioCompletely", () => {
    it("有効なシナリオでisValid=true");
    it("必須フィールド欠如でエラー");
    it("不正な値でエラー");
  });

  describe("ID生成", () => {
    it("generateScenarioIdでユニークID");
    it("generateSectionIdで連番ID");
    it("generateDialogueIdで連番ID");
  });

  describe("ファクトリ関数", () => {
    it("createEmptyScenarioで空シナリオ");
    it("createEmptyDemoSectionで空デモセクション");
    it("createEmptyQuestionSectionで空問題セクション");
  });

  describe("盤面変換", () => {
    it("boardToASCIIでASCII表示");
    it("boardStringToArrayで配列変換");
    it("boardStringToBoardStateで状態変換");
    it("boardArrayToStringで文字列変換");
  });

  describe("セルアクセス", () => {
    it("getBoardCellでセル取得");
    it("setBoardCellでセル設定");
    it("cycleBoardCellで状態サイクル");
  });
});
```

### モック例

```typescript
// File APIモック
const mockFile = new File(['{"id":"test"}'], "scenario.json", {
  type: "application/json",
});

// DOM download モック
const mockLink = { click: vi.fn(), href: "", download: "" };
vi.spyOn(document, "createElement").mockReturnValue(mockLink as any);
vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:url");
vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

// Date/Mathモック（ID生成用）
vi.useFakeTimers();
vi.setSystemTime(new Date("2024-01-01"));
vi.spyOn(Math, "random").mockReturnValue(0.123456);
```

---

## 実装順序

6. **useCutinDisplay.test.ts** - フェイクタイマー
7. **useQuestionSolver.test.ts** - 複数ストアモック
8. **useFullscreenPrompt.test.ts** - ブラウザAPIモック
9. **useScenarioExport.test.ts** - clipboardモック
10. **useScenarioFileOperations.test.ts** - FileReaderモック
11. **scenarioFileHandler.test.ts** - File/DOMモック

## 完了条件

- [ ] 全6ファイルのテスト作成
- [ ] `pnpm test` パス
- [ ] `pnpm check-fix` パス
