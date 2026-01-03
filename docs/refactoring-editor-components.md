# エディタコンポーネントのリファクタリング計画

## 進捗状況

### フェーズ1: 共通部分の整理

- [x] `textUtils.ts` を作成し、`astToText`を移動
- [x] 両ファイルで`textUtils`をimportして使用
- [x] 動作確認

### フェーズ2: ProblemSectionEditorのリファクタリング

- [x] `useSuccessConditions.ts` を作成（成功条件関連のロジック）
- [x] `SuccessConditionsEditor.vue` を作成（成功条件セクションUI）
- [x] `useFeedbackEditor.ts` を作成（フィードバック関連のロジック）
- [x] `FeedbackEditor.vue` と `FeedbackLineItem.vue` を作成
- [x] `ProblemSectionEditor.vue` をリファクタリング（子コンポーネント使用）
- [ ] 動作確認とバグ修正

### フェーズ3: DemoSectionEditorのリファクタリング

- [ ] `useBoardActions.ts` を作成（BoardActions関連の全ロジック）
- [ ] `BoardActionEditor.vue` を作成（単一アクションの編集UI）
- [ ] `BoardActionsList.vue` を作成（アクションリストの表示）
- [ ] `DialogueItemWithActions.vue` を作成（ダイアログ1行のUI）
- [ ] `DemoSectionEditor.vue` をリファクタリング（子コンポーネント使用）
- [ ] 動作確認とバグ修正

### フェーズ4: 共通コンポーネントの検討（オプション）

- [ ] `useDialogueEditor.ts` を作成して共通化
- [ ] `SectionMetaEditor.vue` を作成して共通化
- [ ] 必要に応じて他の共通化も検討

---

## 概要

エディタコンポーネントに1000行を超える大規模なSFCファイルが2つ存在し、保守性が低下している。
ScenarioPlayerで実施した手法を参考に、関心の分離によって各ファイルを400行以下に分割する。

## 対象ファイル

### 1. ProblemSectionEditor.vue (1,616行)

**現在の責務:**

- 問題セクション全体の編集UI
- セクション情報（タイトル、説明）の編集
- 初期盤面の編集
- ダイアログリストの管理（追加、削除、更新）
- 表情ピッカーの管理
- 成功条件の編集（Position/Pattern/Sequence）
  - 条件の追加・削除・タイプ変更
  - Position条件: 座標リストの管理
  - Pattern条件: パターン文字列の編集
  - Sequence条件: 手順リストの管理
- フィードバックメッセージの編集（success/failure/progress）
- 各種ヘルパー関数（astToText等）

### 2. DemoSectionEditor.vue (1,384行)

**現在の責務:**

- デモセクション全体の編集UI
- セクション情報（タイトル）の編集
- 初期盤面の編集
- ダイアログリストの管理（追加、削除、更新、並び替え）
- 表情ピッカーの管理
- BoardActionsの編集（5種類: place/remove/setBoard/mark/line）
  - 各アクションタイプごとの詳細パラメータ編集
  - アクションの追加・削除・並び替え
- 各種ヘルパー関数（astToText、createBoardAction等）

## 問題点

### 共通の問題

1. **単一ファイルが多くの責務を持ちすぎている**
   - UI表示とビジネスロジックが混在
   - テンプレートが長大で可読性が低い
   - スクリプト部分が400行超

2. **重複コードが多い**
   - `astToText`関数が両ファイルで重複
   - ダイアログ管理ロジックが類似
   - 表情ピッカー管理が同じパターン

3. **テスタビリティが低い**
   - ロジックがコンポーネントに密結合
   - 独立したテストが困難

### ProblemSectionEditor特有の問題

- 成功条件編集のロジックが複雑（3種類×複数操作）
- フィードバック編集が3種類あり、テンプレートが冗長
- 条件タイプごとの型ガードとロジックが散在

### DemoSectionEditor特有の問題

- BoardActions編集が5種類あり、それぞれ異なるパラメータ
- アクション操作関数が20個以上ある
- テンプレートのネストが深い（ダイアログ > アクション > タイプ別UI）

## リファクタリング方針

### 参考: ScenarioPlayerの成功事例

ScenarioPlayerは234行で以下の構造を実現:

- メインコンポーネント: 画面構成とコンポーネント配置のみ
- 子コンポーネント: UI部品を責務単位で分割
  - BoardSection.vue (61行)
  - DialogSection.vue (68行)
  - ControlInfo.vue (113行)
  - ScenarioInfoPanel.vue (154行)
- Composables: ロジックを機能単位で分離
  - useBoardSize.ts (55行)
  - useKeyboardNavigation.ts (121行)
  - useProblemSolver.ts (215行)
  - useScenarioNavigation.ts (393行)

### 基本戦略

1. **Composablesへのロジック切り出し**
   - 状態管理とビジネスロジックを分離
   - テスタビリティの向上
   - 再利用性の向上

2. **コンポーネントの分割**
   - UI部品を責務単位で分離
   - テンプレートの可読性向上
   - 単一責任の原則に従う

3. **共通化**
   - 重複コードを共通utilやcomposableに集約
   - DRY原則の適用

## 具体的な分割計画

### A. 共通部分の整理

#### 1. 共通ユーティリティの作成

**ファイル:** `src/editor/logic/textUtils.ts`

```typescript
// astToText関数を共通化
export function astToText(nodes: TextNode[]): string;
```

#### 2. 共通composableの作成

**ファイル:** `src/editor/composables/useDialogueEditor.ts` (150-200行想定)

```typescript
// ダイアログリスト管理の共通ロジック
export function useDialogueEditor(
  getCurrentSection: () => DemoSection | ProblemSection | null,
  updateSection: (updates: any) => void,
) {
  // ダイアログの追加・削除・更新
  // 表情ピッカー管理
  // テキスト編集（astToText使用）
}
```

### B. ProblemSectionEditorの分割

#### 1. Composables作成

**ファイル:** `src/editor/composables/useSuccessConditions.ts` (200-250行想定)

```typescript
// 成功条件の管理ロジック
export function useSuccessConditions(
  getCurrentSection: () => ProblemSection | null,
  updateSection: (updates: any) => void,
) {
  // 条件の追加・削除・タイプ変更
  // Position条件の操作
  // Pattern条件の操作
  // Sequence条件の操作
  // 型ガード関数
  return {
    addSuccessCondition,
    removeSuccessCondition,
    changeConditionType,
    // Position用
    updatePositionCondition,
    addPositionToCondition,
    updatePositionField,
    removePositionFromCondition,
    // Pattern用
    updatePatternCondition,
    // Sequence用
    addSequenceMove,
    updateSequenceMove,
    removeSequenceMove,
    toggleSequenceStrict,
    // 型ガード
    isPositionCondition,
    isPatternCondition,
    isSequenceCondition,
  };
}
```

**ファイル:** `src/editor/composables/useFeedbackEditor.ts` (100-150行想定)

```typescript
// フィードバック編集のロジック
export function useFeedbackEditor(
  getCurrentSection: () => ProblemSection | null,
  updateSection: (updates: any) => void,
) {
  // success/failure/progressの管理
  function getFeedbackLines(key: FeedbackKey): DialogueLine[];
  function updateFeedbackLines(key: FeedbackKey, lines: DialogueLine[]): void;
  function addFeedbackLine(key: FeedbackKey): void;
  function updateFeedbackLine(
    key: FeedbackKey,
    index: number,
    updates: Partial<DialogueLine>,
  ): void;
  function removeFeedbackLine(key: FeedbackKey, index: number): void;

  return {
    getFeedbackLines,
    addFeedbackLine,
    updateFeedbackLine,
    removeFeedbackLine,
  };
}
```

#### 2. コンポーネント分割

**ファイル:** `src/editor/components/ProblemSectionEditor/SuccessConditionsEditor.vue` (200-250行想定)

- 成功条件セクション全体のUI
- 条件タイプごとの編集フォーム
- useSuccessConditionsを使用

**ファイル:** `src/editor/components/ProblemSectionEditor/FeedbackEditor.vue` (150-200行想定)

- フィードバックセクション全体のUI
- success/failure/progressの3つのグループ
- useFeedbackEditorを使用

**ファイル:** `src/editor/components/ProblemSectionEditor/FeedbackLineItem.vue` (50-80行想定)

- フィードバック行単体のUI（再利用可能）
- キャラクター選択、感情、テキスト入力

**親コンポーネント:** `ProblemSectionEditor.vue` (200-250行想定)

```vue
<template>
  <div class="problem-section-editor">
    <div class="detail-grid">
      <!-- セクション情報 -->
      <SectionMetaEditor
        v-if="view !== 'content'"
        :title="currentSection.title"
        :description="currentSection.description"
        @update:title="updateSectionTitle"
        @update:description="updateDescription"
      />

      <div
        v-if="view !== 'meta'"
        class="detail-right"
      >
        <!-- 盤面 -->
        <BoardVisualEditor ... />

        <!-- ダイアログ -->
        <DialogueListEditor
          :dialogues="currentSection.dialogues"
          @add="addDialogue"
          @update="updateDialogue"
          @remove="removeDialogue"
        />

        <!-- 成功条件 -->
        <SuccessConditionsEditor
          :conditions="currentSection.successConditions"
          :operator="currentSection.successOperator"
        />

        <!-- フィードバック -->
        <FeedbackEditor :feedback="currentSection.feedback" />
      </div>
    </div>
  </div>
</template>
```

#### 分割後の構成（ProblemSectionEditor）

```
src/editor/
├── components/
│   ├── ProblemSectionEditor.vue (200-250行) ← メイン
│   └── ProblemSectionEditor/
│       ├── SuccessConditionsEditor.vue (200-250行)
│       ├── FeedbackEditor.vue (150-200行)
│       └── FeedbackLineItem.vue (50-80行)
├── composables/
│   ├── useDialogueEditor.ts (150-200行) ← 共通
│   ├── useSuccessConditions.ts (200-250行)
│   └── useFeedbackEditor.ts (100-150行)
└── logic/
    └── textUtils.ts (30-50行) ← 共通
```

### C. DemoSectionEditorの分割

#### 1. Composables作成

**ファイル:** `src/editor/composables/useBoardActions.ts` (300-400行想定)

```typescript
// BoardActions編集の全ロジック
export function useBoardActions(
  getCurrentSection: () => DemoSection | null,
  updateDialogue: (index: number, updates: Partial<DemoDialogue>) => void
) {
  // アクション操作
  function addBoardAction(dialogueIndex: number): void
  function removeBoardAction(dialogueIndex: number, actionIndex: number): void
  function moveBoardAction(dialogueIndex: number, fromIndex: number, toIndex: number): void

  // アクション更新（汎用）
  function updateBoardActionInArray(dialogueIndex: number, actionIndex: number, updates: Partial<BoardAction>): void

  // Place用
  function updateBoardActionPosition(...): void
  function updateBoardActionColor(...): void
  function updateBoardActionHighlight(...): void

  // SetBoard用
  function updateBoardActionBoard(...): void

  // Mark用
  function addBoardActionMarkPosition(...): void
  function updateBoardActionMarkPosition(...): void
  function removeBoardActionMarkPosition(...): void
  function updateBoardActionMarkMeta(...): void

  // Line用
  function updateBoardActionLine(...): void

  // ヘルパー
  function createBoardAction(type: BoardAction["type"]): BoardAction

  return { /* all functions */ }
}
```

#### 2. コンポーネント分割

**ファイル:** `src/editor/components/DemoSectionEditor/BoardActionEditor.vue` (250-300行想定)

- 単一BoardActionの編集UI
- タイプごとの編集フォーム（place/remove/setBoard/mark/line）
- Props: action, dialogueIndex, actionIndex
- Emits: update, remove, moveUp, moveDown

**ファイル:** `src/editor/components/DemoSectionEditor/BoardActionsList.vue` (100-150行想定)

- ダイアログ1つ分のBoardActionsリスト
- BoardActionEditorを繰り返し表示
- Props: dialogueIndex, boardActions
- useBoardActionsを使用

**ファイル:** `src/editor/components/DemoSectionEditor/DialogueItemWithActions.vue` (150-200行想定)

- ダイアログ1行分のUI（テキスト編集 + BoardActions）
- BoardActionsListを含む
- Props: dialogue, index
- Emits: update, remove, moveUp, moveDown

**親コンポーネント:** `DemoSectionEditor.vue` (200-250行想定)

```vue
<template>
  <div class="demo-section-editor">
    <div class="detail-grid">
      <!-- セクション情報 -->
      <SectionMetaEditor
        v-if="view !== 'content'"
        :title="currentSection.title"
        @update:title="updateSectionTitle"
      />

      <div
        v-if="view !== 'meta'"
        class="detail-right"
      >
        <!-- 盤面 -->
        <BoardVisualEditor ... />

        <!-- ダイアログリスト（BoardActions付き） -->
        <details
          class="dialogues-section"
          open
        >
          <summary>
            <span>ダイアログ</span>
            <button @click="addDialogue">+ ダイアログを追加</button>
          </summary>

          <DialogueItemWithActions
            v-for="(dialogue, index) in currentSection.dialogues"
            :key="dialogue.id"
            :dialogue="dialogue"
            :index="index"
            @update="updateDialogue"
            @remove="removeDialogue"
            @move-up="editorStore.moveDialogueUp"
            @move-down="editorStore.moveDialogueDown"
          />
        </details>
      </div>
    </div>
  </div>
</template>
```

#### 分割後の構成（DemoSectionEditor）

```
src/editor/
├── components/
│   ├── DemoSectionEditor.vue (200-250行) ← メイン
│   └── DemoSectionEditor/
│       ├── DialogueItemWithActions.vue (150-200行)
│       ├── BoardActionsList.vue (100-150行)
│       └── BoardActionEditor.vue (250-300行)
├── composables/
│   ├── useDialogueEditor.ts (150-200行) ← 共通
│   └── useBoardActions.ts (300-400行)
└── logic/
    └── textUtils.ts (30-50行) ← 共通
```

### D. さらなる共通化の可能性

#### SectionMetaEditor.vue (共通コンポーネント)

ProblemとDemoで共通のセクション情報編集UI

```vue
<!-- タイトルと説明（オプション）の編集 -->
<template>
  <div class="section-meta-editor">
    <div class="form-group">
      <label>セクションタイトル</label>
      <input
        :value="title"
        @input="$emit('update:title', $event.target.value)"
      />
    </div>
    <div
      v-if="withDescription"
      class="form-group"
    >
      <label>説明</label>
      <textarea
        :value="description"
        @input="$emit('update:description', $event.target.value)"
      />
    </div>
  </div>
</template>
```

#### DialogueListEditor.vue (共通コンポーネントの候補)

ダイアログリストの基本的なUI（BoardActions以外）

- ただし、DemoとProblemで微妙に違う部分があるため、
- 完全共通化するか、スロットで差分を吸収するか検討が必要

## リファクタリングの優先順位と手順

### フェーズ1: 共通部分の整理

1. `textUtils.ts` を作成し、`astToText`を移動
2. 両ファイルで`textUtils`をimportして使用
3. 動作確認

### フェーズ2: ProblemSectionEditorのリファクタリング

1. `useSuccessConditions.ts` を作成
   - 成功条件関連のロジックを移動
   - 型ガード関数も含める
2. `SuccessConditionsEditor.vue` を作成
   - テンプレートを移動
   - composableを使用
3. `useFeedbackEditor.ts` を作成
   - フィードバック関連のロジックを移動
4. `FeedbackEditor.vue` と `FeedbackLineItem.vue` を作成
   - テンプレートを分割
   - composableを使用
5. `ProblemSectionEditor.vue` をリファクタリング
   - 子コンポーネントを使用する形に変更
   - ロジックはcomposableに委譲
6. 動作確認とバグ修正

### フェーズ3: DemoSectionEditorのリファクタリング

1. `useBoardActions.ts` を作成
   - BoardActions関連の全ロジックを移動
2. `BoardActionEditor.vue` を作成
   - 単一アクションの編集UI
   - タイプ別のフォーム
3. `BoardActionsList.vue` を作成
   - アクションリストの表示
4. `DialogueItemWithActions.vue` を作成
   - ダイアログ1行のUI
5. `DemoSectionEditor.vue` をリファクタリング
   - 子コンポーネントを使用する形に変更
6. 動作確認とバグ修正

### フェーズ4: 共通コンポーネントの検討（オプション）

1. `useDialogueEditor.ts` を作成して共通化
2. `SectionMetaEditor.vue` を作成して共通化
3. 必要に応じて他の共通化も検討

## 期待される効果

### 定量的効果

- **ProblemSectionEditor**: 1,616行 → 約200-250行（約85%削減）
- **DemoSectionEditor**: 1,384行 → 約200-250行（約85%削減）
- 各ファイルが400行以下に収まる
- 新規作成ファイルも最大400行以内

### 定性的効果

1. **可読性の向上**
   - 各ファイルが単一責任に集中
   - テンプレートのネストが浅くなる
   - ロジックとUIが明確に分離

2. **保守性の向上**
   - 変更の影響範囲が限定的
   - バグ修正が容易
   - 機能追加がしやすい

3. **テスタビリティの向上**
   - Composableは独立してテスト可能
   - コンポーネントのユニットテストが書きやすい

4. **再利用性の向上**
   - 共通ロジックの再利用
   - 共通コンポーネントの活用

## 注意点

1. **段階的な移行**
   - 一度に全てを変更せず、フェーズごとに進める
   - 各フェーズで動作確認を徹底

2. **型安全性の維持**
   - TypeScriptの型推論を活用
   - any型の使用を最小限に

3. **パフォーマンスの確認**
   - コンポーネント分割によるオーバーヘッドを監視
   - 必要に応じて最適化

4. **既存機能の保持**
   - リファクタリング中も既存機能が動作すること
   - エディタの動作確認を十分に行う

## まとめ

2つの大規模SFCファイル（合計3,000行）を、関心の分離により約10個のファイル（各200-400行）に分割する。
Composablesによるロジック分離とコンポーネント分割により、保守性・可読性・テスタビリティを大幅に向上させる。
