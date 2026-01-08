# 説明テキスト表示ロジック再設計

## 現状の問題点（実装前）

### 1. 設定忘れが発生しやすい

- デフォルトが「継続表示」のため、テキストを入力しても手動で「新規表示」を選ばないと前の説明に追記される
- エディタで毎回手動設定が必要で、忘れやすい

### 2. 「戻る」時の状態復元バグ

- `dl1: 空白 → dl2: 説明あり` で dl2→dl1 に戻ると説明が維持されてしまう
- 原因: `updateDemoDescription()` で `description` が undefined の場合、前の状態を保持するロジック

### 3. データ構造の複雑さ

- `type: "new" | "continue"` は「テキストがあるかどうか」と実質重複
- テキストがあれば新規表示、なければ維持/クリアのどちらかで十分

## あるべき動作

```
1.進む(説明なし) → 2.進む(説明あり) → 3.進む(説明維持) → 4.進む(説明クリア)
4.戻る(説明クリア) → 3.戻る(説明維持) → 2.戻る(説明あり) → 1.戻る(説明なし)
```

- 各ダイアログは自身の説明状態を持つ
- 前進時: そのダイアログの説明を適用
- 後退時: 戻った先のダイアログの説明状態を復元

## 設計方針

### 核心: clearフラグ式データ構造

```typescript
interface DemoDialogue {
  // ... 既存フィールド
  description?: {
    text: TextNode[];
    clear?: boolean; // trueの場合、説明をクリア
  };
}
```

| 条件                        | 動作                                 |
| --------------------------- | ------------------------------------ |
| `description` がない        | 前の説明を維持                       |
| `text` がある（空でない）   | 新規表示（前の説明をクリアして表示） |
| `text` が空 + `clear: true` | 説明をクリア（空白にする）           |
| `text` が空 + `clear` なし  | 前の説明を維持                       |

### メリット

- `type` フィールドが不要になり、シンプル化
- テキストがあれば自動的に新規表示になるため、設定忘れがなくなる
- `clear` フラグは明示的にクリアしたい時だけ指定

### 説明状態のスナップショット化

**要件**: 「戻る」操作で各ダイアログの説明状態を正しく再現する

**解決**: `BoardSnapshot` に `descriptionNodes` を追加

```typescript
interface BoardSnapshot {
  board: BoardState;
  stones: Stone[];
  marks: Mark[];
  lines: Line[];
  descriptionNodes: TextNode[]; // 追加
}
```

### 責務の整理

| 責務             | 担当                  |
| ---------------- | --------------------- |
| ダイアログ管理   | useScenarioNavigation |
| 説明状態管理     | useScenarioNavigation |
| スナップショット | useScenarioNavigation |
| 説明表示         | ScenarioInfoPanel     |

- 説明状態を `ScenarioPlayer.vue` から `useScenarioNavigation` に移動
- スナップショットとの一貫性を確保

## 実装詳細

### useScenarioNavigation.ts

```typescript
// 説明状態を追加
const demoDescriptionNodes = ref<TextNode[]>([]);

// ダイアログ表示時に説明を更新
const updateDescriptionForDialogue = (dialogue: DemoDialogue): void => {
  if (!dialogue.description) {
    // undefinedなら前の状態を維持（何もしない）
    return;
  }

  const { text, clear } = dialogue.description;

  if (text.length > 0) {
    // テキストがあれば新規表示
    demoDescriptionNodes.value = [...text];
  } else if (clear) {
    // テキストなし + clear: true → クリア
    demoDescriptionNodes.value = [];
  }
  // テキストなし + clear なし → 前の状態を維持（何もしない）
};

// スナップショット保存
const saveBoardSnapshot = (
  sectionIndex: number,
  dialogueIndex: number,
): void => {
  const key = `${sectionIndex}-${dialogueIndex}`;
  boardSnapshots.value.set(key, {
    board: boardStore.board.value,
    stones: [...boardStore.stones.value],
    marks: [...boardStore.marks.value],
    lines: [...boardStore.lines.value],
    descriptionNodes: [...demoDescriptionNodes.value], // 追加
  });
};

// スナップショット復元
const restoreBoardSnapshot = (...): boolean => {
  // ... 既存の復元に加えて
  demoDescriptionNodes.value = [...snapshot.descriptionNodes];
  return true;
};
```

### ScenarioPlayer.vue

```typescript
// 削除: const demoDescriptionNodes = ref<TextNode[]>([]);
// 削除: const updateDemoDescription = (): void => { ... }
// 削除: watch(() => scenarioNav.currentDialogueIndex.value, ...)

// scenarioNavから取得
const { demoDescriptionNodes } = scenarioNav;
```

### DialogueItemWithActions.vue（エディタ）

```vue
<!-- セレクトボックスを削除 -->
<!-- テキストが空の場合のみ「クリア」チェックボックスを表示 -->
<label class="field">
  <span>説明テキスト</span>
  <textarea
    :value="descriptionText"
    placeholder="説明を入力"
    rows="3"
    @change="handleDescriptionChange"
  />
</label>

<label v-if="!hasDescriptionText" class="field checkbox">
  <input
    type="checkbox"
    :checked="dialogue.description?.clear === true"
    @change="handleClearChange"
  />
  <span>説明をクリア</span>
</label>
```

## ファイル変更一覧

| ファイル                                                                       | 変更内容                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------- |
| `src/types/scenario.ts`                                                        | 型定義: `type` を削除、`clear?: boolean` 追加 |
| `src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.ts` | 説明状態管理、スナップショット拡張            |
| `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue`                   | ローカル状態削除、composable利用              |
| `src/editor/components/DemoSectionEditor/DialogueItemWithActions.vue`          | セレクト削除、clearチェックボックス追加       |
| `src/editor/composables/useDialogueEditor.ts`                                  | デフォルト値変更                              |
| `src/data/scenarios/beginner/*.json`                                           | マイグレーション                              |

## マイグレーションルール

| 変更前                          | 変更後                         |
| ------------------------------- | ------------------------------ |
| `type: "continue", text: []`    | `description` を削除           |
| `type: "continue", text: [...]` | `type` を削除、`text` のみ保持 |
| `type: "new", text: []`         | `{ text: [], clear: true }`    |
| `type: "new", text: [...]`      | `type` を削除、`text` のみ保持 |

## 期待される効果

1. **設定忘れの防止**: テキストがあれば自動的に新規表示
2. **「戻る」の正常動作**: スナップショットで各ダイアログの説明状態を復元
3. **シンプルなデータ構造**: `type` フィールドが不要に
4. **直感的なエディタUI**: テキストありなら表示、なければクリアかどうかのみ選択
