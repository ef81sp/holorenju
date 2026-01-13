# テスト追加計画 Phase 2 - Tier 3（低テスト容易性）

## 対象ファイル（4ファイル）

| #   | ファイル                      | 依存                   | テスト方針                 |
| --- | ----------------------------- | ---------------------- | -------------------------- |
| 12  | useRenjuBoardAnimation.ts     | Konva.Tween            | 呼び出し検証               |
| 13  | useScenarioNavigation.ts      | 動的import, 4ストア    | ナビゲーションロジックのみ |
| 14  | useScenarioDirectory.ts       | File System Access API | ハンドルモック             |
| 15  | useScenarioIndexManagement.ts | File System Access API | ハンドルモック             |

**方針**: これらのファイルは複雑な外部依存があるため、完全なユニットテストではなく、呼び出し検証レベルに留める。

---

## 12. useRenjuBoardAnimation.test.ts

**パス**: `src/components/game/RenjuBoard/composables/useRenjuBoardAnimation.test.ts`

**特徴**: Konva.Tweenへの重度の依存

### テスト方針

- Konva.Tweenをモッククラスで置き換え
- アニメーション開始/完了の呼び出しを検証
- 実際のアニメーション動作はテストしない

### テストケース

```typescript
describe("useRenjuBoardAnimation", () => {
  describe("animateStone", () => {
    it("Konva.Tweenが生成される");
    it("playが呼ばれる");
    it("アニメーション完了でPromiseが解決する");
  });

  describe("animateMark", () => {
    it("マーク用のTweenが生成される");
    it("正しいイージングが設定される");
  });

  describe("animateLine", () => {
    it("ライン用のTweenが生成される");
  });

  describe("finishAllAnimations", () => {
    it("全てのアクティブなTweenのfinishが呼ばれる");
    it("activeTweensがクリアされる");
  });

  describe("refの管理", () => {
    it("stoneRefsにrefが登録される");
    it("markRefsにrefが登録される");
    it("lineRefsにrefが登録される");
  });
});
```

### モック例

```typescript
const tweenInstances: any[] = [];

vi.mock("konva", () => ({
  default: {
    Tween: class MockTween {
      config: any;
      constructor(config: any) {
        this.config = config;
        tweenInstances.push(this);
      }
      play() {
        // 即座に完了をシミュレート
        Promise.resolve().then(() => this.config.onFinish?.());
      }
      finish() {
        this.config.onFinish?.();
      }
    },
    Easings: {
      EaseOut: "easeOut",
      BackEaseOut: "backEaseOut",
    },
  },
}));

// Pinia storeモック
vi.mock("@/stores/preferencesStore", () => ({
  usePreferencesStore: () => ({
    stoneAnimationDuration: 0.2,
    markAnimationDuration: 0.25,
    lineAnimationDuration: 0.2,
  }),
}));
```

---

## 13. useScenarioNavigation.test.ts

**パス**: `src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.test.ts`

**特徴**: 動的import + 4つのストア依存

### テスト方針

- 動的importはモック不可のため、loadScenarioはスキップ
- ナビゲーションロジック（nextDialogue, previousDialogue等）のみテスト
- シナリオデータは事前にセットした状態でテスト

### テストケース

```typescript
describe("useScenarioNavigation", () => {
  // loadScenarioは動的importのためスキップ

  describe("nextDialogue", () => {
    it("次のダイアログに進む");
    it("セクション最後で次セクションに進む");
    it("シナリオ最後で何もしない");
  });

  describe("previousDialogue", () => {
    it("前のダイアログに戻る");
    it("セクション最初で前セクションに戻る");
    it("シナリオ最初で何もしない");
  });

  describe("computed values", () => {
    it("canNavigateNextが正しく計算される");
    it("canNavigatePreviousが正しく計算される");
    it("isScenarioDoneが正しく計算される");
    it("currentSectionが正しく返される");
  });

  describe("セクション遷移", () => {
    it("nextSectionで次セクションに進む");
    it("セクション変更時にboardStoreがリセットされる");
  });

  describe("盤面スナップショット", () => {
    it("スナップショットが保存される");
    it("戻った時にスナップショットが復元される");
  });
});
```

### モック例

```typescript
// 4つのストアをモック
vi.mock("@/stores/appStore", () => ({
  useAppStore: () => ({
    setCurrentScene: vi.fn(),
  }),
}));

vi.mock("@/stores/boardStore", () => ({
  useBoardStore: () => ({
    resetAll: vi.fn(),
    setBoard: vi.fn(),
    addStones: vi.fn(),
    addMarks: vi.fn(),
    addLines: vi.fn(),
    board: Array(15).fill(null).map(() => Array(15).fill(null)),
  }),
}));

vi.mock("@/stores/dialogStore", () => ({
  useDialogStore: () => ({
    showMessage: vi.fn(),
    clearMessage: vi.fn(),
  }),
}));

vi.mock("@/stores/progressStore", () => ({
  useProgressStore: () => ({
    getProgress: vi.fn(() => null),
  }),
}));

// テスト用にシナリオデータを直接セット
const mockScenario = {
  id: "test-scenario",
  sections: [
    { id: "section-1", type: "demo", dialogues: [...] },
    { id: "section-2", type: "question", dialogues: [...] },
  ],
};
```

---

## 14. useScenarioDirectory.test.ts

**パス**: `src/editor/components/composables/useScenarioDirectory.test.ts`

**特徴**: File System Access APIへの重度の依存

### テスト方針

- FileSystemDirectoryHandleをモック
- API呼び出しの検証のみ
- 実際のファイル操作はテストしない

### テストケース

```typescript
describe("useScenarioDirectory", () => {
  describe("handleSelectDirectory", () => {
    it("showDirectoryPickerが呼ばれる");
    it("選択されたハンドルがscenarioDirに設定される");
    it("ハンドルがIndexedDBに保存される");
    it("キャンセル時は何もしない");
  });

  describe("restoreDirectoryHandle", () => {
    it("IndexedDBからハンドルを復元する");
    it("復元失敗時はnullのまま");
  });

  describe("handleSaveToDirectory", () => {
    it("getFileHandleが呼ばれる");
    it("createWritableが呼ばれる");
    it("writeとcloseが呼ばれる");
    it("ディレクトリ未選択時はエラー");
  });

  describe("handleLoadFromDirectory", () => {
    it("ディレクトリ内のJSONファイルを列挙する");
    it("選択されたファイルが読み込まれる");
  });
});
```

### モック例

```typescript
const mockWritable = {
  write: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockFileHandle = {
  getFile: vi.fn().mockResolvedValue({
    text: vi.fn().mockResolvedValue('{"id":"test"}'),
  }),
  createWritable: vi.fn().mockResolvedValue(mockWritable),
};

const mockDirHandle = {
  getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  getDirectoryHandle: vi.fn().mockResolvedValue({
    getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
  }),
  entries: vi.fn().mockReturnValue({
    [Symbol.asyncIterator]: async function* () {
      yield ["scenario.json", mockFileHandle];
    },
  }),
};

vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(mockDirHandle));

// IndexedDBモック
vi.mock("@/editor/utils/directoryHandleStorage", () => ({
  saveDirectoryHandle: vi.fn().mockResolvedValue(undefined),
  loadDirectoryHandle: vi.fn().mockResolvedValue(mockDirHandle),
}));
```

---

## 15. useScenarioIndexManagement.test.ts

**パス**: `src/editor/components/composables/useScenarioIndexManagement.test.ts`

**特徴**: File System Access API + インデックスファイル管理

### テスト方針

- File System Access APIをモック
- ヘルパー関数（createEmptyIndexData, mergeIndexData）は完全テスト
- ファイル操作は呼び出し検証のみ

### テストケース

```typescript
describe("useScenarioIndexManagement", () => {
  describe("ヘルパー関数", () => {
    it("createEmptyIndexDataで空のIndexDataを生成");
    it("mergeIndexDataで既存データとマージ");
  });

  describe("handleGenerateIndex", () => {
    it("index.jsonの読み込みを試みる");
    it("存在しない場合は空のIndexDataを使用");
    it("ダイアログが表示される");
  });

  describe("handleReorderConfirm", () => {
    it("regenerateScenarioIndexWithOrderが呼ばれる");
    it("index.jsonが更新される");
    it("currentIndexDataがクリアされる");
  });

  describe("currentIndexData", () => {
    it("初期値はnull");
    it("handleGenerateIndex後に値が設定される");
  });
});
```

### モック例

```typescript
vi.mock("@/editor/utils/indexFileHandler", () => ({
  DIFFICULTY_LABELS: {
    easy: "初級",
    normal: "中級",
    hard: "上級",
  },
  regenerateScenarioIndexWithOrder: vi.fn().mockResolvedValue(undefined),
}));

const mockDialogRef = {
  showModal: vi.fn(),
};

// File System Access APIは useScenarioDirectory と同様のモック
```

---

## 実装順序

12. **useRenjuBoardAnimation.test.ts** - Konva.Tweenモック
13. **useScenarioNavigation.test.ts** - ナビゲーションロジックのみ
14. **useScenarioDirectory.test.ts** - FSAハンドルモック
15. **useScenarioIndexManagement.test.ts** - FSAハンドルモック

## 完了条件

- [ ] 全4ファイルのテスト作成
- [ ] `pnpm test` パス
- [ ] `pnpm check-fix` パス

## 注意事項

- これらのテストは呼び出し検証が中心のため、カバレッジは低めになる
- 実際の動作確認はE2E/統合テストで補完することを推奨
- リファクタリングにより依存を分離できれば、より詳細なテストが可能になる
