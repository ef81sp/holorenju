# 問題セクション連続時の進行制御

## 概要

問題セクションが連続する場合、矢印キーを使うと回答していなくても次のセクションに進めてしまう問題がある。問題に回答しないと先に進めないように制御する必要がある。

## 現状の実装

### useKeyboardNavigation.ts (59-68行目)

```typescript
case "arrowleft":
case "arrowright":
  // 矢印キーでの会話送りは常に有効
  event.preventDefault();
  if (onDialogueNavigate) {
    onDialogueNavigate(
      key.toLowerCase() === "arrowleft" ? "previous" : "next",
    );
  }
  break;
```

矢印キー（左右）による会話送りは `isDisabled` フラグを無視して**常に有効**になっている。これは意図的な設計だが、問題セクションでは未回答のまま次のセクションに進めてしまう。

### useScenarioNavigation.ts

`nextDialogue()` 関数はセクションをまたぐナビゲーションを処理している。現状では問題セクションの回答状態をチェックせずに次のダイアログに進める。

## 修正方針

1. **問題セクションでの進行ブロック**: 問題セクションにいる場合、正解するまで次のセクションに進めないようにする
2. **正解済み問題セクションの再通過**: 一度正解した問題セクションに戻った場合は、再度回答しなくても先に進めるようにする
3. **同一セクション内のナビゲーション**: デモダイアログ間の移動は自由に許可
4. **戻る操作**: 前のセクションへ戻る操作は常に許可

## 実装詳細

### 0. 完了セクションの追跡

セクションごとの完了状態を記録するための state を追加:

```typescript
// 完了した問題セクションのインデックスを記録
const completedSectionIndices = ref<Set<number>>(new Set());

// セクション完了時に記録
const markSectionAsCompleted = (sectionIndex: number): void => {
  completedSectionIndices.value.add(sectionIndex);
};

// セクションが完了済みかチェック
const isSectionAlreadyCompleted = (sectionIndex: number): boolean => {
  return completedSectionIndices.value.has(sectionIndex);
};
```

問題セクション正解時に `markSectionAsCompleted()` を呼び出す。

### 1. useScenarioNavigation.ts の修正

`nextDialogue()` 関数にセクション境界チェックを追加:

```typescript
const nextDialogue = async (): Promise<void> => {
  animationStore.cancelOngoingAnimations();

  if (currentDialogueIndex.value < allDialogues.value.length - 1) {
    const nextMapping = allDialogues.value[currentDialogueIndex.value + 1];
    const currentMapping = allDialogues.value[currentDialogueIndex.value];

    if (!nextMapping || !currentMapping) {
      return;
    }

    // セクション境界を越える場合のチェック
    if (nextMapping.sectionIndex !== currentMapping.sectionIndex) {
      const currentSection =
        scenario.value?.sections[currentMapping.sectionIndex];

      // 現在のセクションが問題セクションの場合
      if (currentSection?.type === "question") {
        // 今回正解した、または過去に正解済みなら通過可能
        const canPass =
          isSectionCompleted.value ||
          isSectionAlreadyCompleted(currentMapping.sectionIndex);
        if (!canPass) {
          return; // 進行をブロック
        }
      }
    }

    // 以下、既存の処理...
    currentDialogueIndex.value += 1;
    // ...
  }
};
```

### 2. canNavigateNext computed の修正

セクション境界での進行可否を考慮した computed プロパティ:

```typescript
const canNavigateNext = computed(() => {
  if (currentDialogueIndex.value >= allDialogues.value.length - 1) {
    return false;
  }

  const nextMapping = allDialogues.value[currentDialogueIndex.value + 1];
  const currentMapping = allDialogues.value[currentDialogueIndex.value];

  if (!nextMapping || !currentMapping) {
    return false;
  }

  // セクション境界を越える場合
  if (nextMapping.sectionIndex !== currentMapping.sectionIndex) {
    const currentSection =
      scenario.value?.sections[currentMapping.sectionIndex];
    // 問題セクションの場合、今回または過去に正解済みかチェック
    if (currentSection?.type === "question") {
      const canPass =
        isSectionCompleted.value ||
        isSectionAlreadyCompleted(currentMapping.sectionIndex);
      if (!canPass) {
        return false;
      }
    }
  }

  return true;
});
```

### 3. useKeyboardNavigation.ts の修正（オプション）

`canNavigateNext` の状態を渡して、キーボード操作時に視覚的フィードバックを提供することも検討:

```typescript
export const useKeyboardNavigation = (
  onPlaceStone: () => void,
  onDialogueNavigate?: (direction: "next" | "previous") => void,
  isDisabled?: Ref<boolean> | ComputedRef<boolean>,
  canNavigateNext?: ComputedRef<boolean>,  // 追加
): { ... }
```

## 影響範囲

- `src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.ts`
- `src/components/scenarios/ScenarioPlayer/ScenarioPlayer.vue`（必要に応じて）
- `src/components/scenarios/ScenarioPlayer/composables/useKeyboardNavigation.ts`（オプション）

## テスト計画

1. **問題セクション連続テスト**
   - 問題セクション→問題セクションの構成で、1つ目を未回答のまま右矢印キーを押す
   - 期待: 次のセクションに進めない

2. **デモセクションの動作確認**
   - デモセクション間は自由に移動できることを確認

3. **問題正解後の進行確認**
   - 問題に正解した後は次のセクションに進めることを確認

4. **戻る操作の確認**
   - 左矢印キーでの戻る操作は常に可能であることを確認

5. **正解済み問題セクションの再通過テスト**
   - 問題1→問題2の構成で、問題1に正解して問題2に進む
   - 問題2から問題1に戻る
   - 問題1で再度回答せずに右矢印キーを押す
   - 期待: 問題2に進めること（一度正解しているため）

## 備考

- UIでの視覚的フィードバック（「問題に回答してください」等のメッセージ表示）も検討の余地あり
- 矢印キー操作時に進めない場合の効果音やアニメーションも UX 向上に寄与する可能性
