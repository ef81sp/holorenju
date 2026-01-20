# マークの削除アクション

## 概要

`LineAction` には `action: "draw" | "remove"` があり、ラインの追加と削除が可能だが、`MarkAction` には削除機能がない。一貫性のため、マークにも削除アクションを追加する。

## 現状の実装

### src/types/scenario.ts

```typescript
interface MarkAction {
  type: "mark";
  positions: Position[];
  markType: "circle" | "cross" | "arrow";
  label?: string;
}

interface LineAction {
  type: "line";
  fromPosition: Position;
  toPosition: Position;
  action: "draw" | "remove"; // ← ラインには action がある
  style?: "solid" | "dashed";
}
```

### boardStore.ts

マーク関連のメソッド:

- `addMarks()`: マークを追加
- `clearMarks()`: 全マークをクリア

個別のマーク削除メソッドは存在しない。

### useScenarioNavigation.ts

マークアクションは `type === "mark"` のみチェックしており、削除処理はない。

## 修正方針

1. **型定義の拡張**: `MarkAction` に `action` フィールドを追加（`"draw" | "remove"`）
2. **boardStore の拡張**: マーク削除メソッドを追加
3. **パーサーの更新**: 新しいスキーマに対応
4. **ナビゲーションの更新**: マーク削除アクションを処理
5. **エディタの更新**: マーク削除を編集可能に

## 実装詳細

### 1. src/types/scenario.ts の修正

```typescript
interface MarkAction {
  type: "mark";
  positions: Position[];
  markType: "circle" | "cross" | "arrow";
  label?: string;
  action?: "draw" | "remove"; // 追加（省略時は "draw"）
}
```

後方互換性のため `action` はオプションとし、省略時は `"draw"` として扱う。

### 2. src/stores/boardStore.ts の修正

```typescript
/**
 * 指定位置のマークを削除
 * 位置とタイプが一致するマークを全て削除
 */
function removeMarks(
  marksToRemove: {
    positions: Position[];
    markType: "circle" | "cross" | "arrow";
  }[],
): void {
  for (const markToRemove of marksToRemove) {
    // 位置配列の完全一致で比較
    marks.value = marks.value.filter((mark) => {
      if (mark.markType !== markToRemove.markType) {
        return true; // タイプが異なれば保持
      }
      // 位置配列が同じかチェック
      if (mark.positions.length !== markToRemove.positions.length) {
        return true;
      }
      const isSamePositions = mark.positions.every((pos, idx) => {
        const removePos = markToRemove.positions[idx];
        return (
          removePos && pos.row === removePos.row && pos.col === removePos.col
        );
      });
      return !isSamePositions; // 同じなら削除（false返す）
    });
  }
}
```

### 3. src/logic/scenarioParser.ts の修正

マークアクションのパース処理に `action` フィールドを追加:

```typescript
// MarkAction のパース部分
if (action.type === "mark") {
  return {
    type: "mark",
    positions: action.positions.map((pos: unknown) => parsePosition(pos)),
    markType: action.markType,
    label: action.label,
    action: action.action || "draw", // デフォルトは "draw"
  };
}
```

### 4. src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.ts の修正

```typescript
// markアクションの処理（showDialogueWithAction 内）
const markDrawActions = dialogue.boardActions.filter(
  (a) => a.type === "mark" && (a.action === "draw" || !a.action),
);
const markRemoveActions = dialogue.boardActions.filter(
  (a) => a.type === "mark" && a.action === "remove",
);

// 削除アクションを先に処理
if (markRemoveActions.length > 0) {
  boardStore.removeMarks(
    markRemoveActions.map((a) => ({
      positions: a.positions,
      markType: a.markType,
    })),
  );
}

// 追加アクションを処理
if (markDrawActions.length > 0) {
  // 既存の処理...
}
```

`applyActionsUntilDialogueIndex` 関数も同様に更新。

### 5. エディタの修正

`src/editor/composables/useBoardActions.ts` にマーク削除のUI対応を追加:

```typescript
// BoardActionEditor でマークアクション編集時
interface MarkActionFormState {
  positions: Position[];
  markType: "circle" | "cross" | "arrow";
  label?: string;
  action: "draw" | "remove"; // 追加
}
```

### 6. PreviewPanel.vue の修正

```typescript
// currentMarks computed 内
for (const action of dialogue.boardActions) {
  if (action.type === "resetAll") {
    marks.length = 0;
  } else if (action.type === "mark") {
    if (action.action === "remove") {
      // 削除アクション: 該当マークを削除
      const idx = marks.findIndex(
        (m) =>
          m.markType === action.markType &&
          m.positions.length === action.positions.length &&
          m.positions.every((pos, i) => {
            const actionPos = action.positions[i];
            return (
              actionPos &&
              pos.row === actionPos.row &&
              pos.col === actionPos.col
            );
          }),
      );
      if (idx !== -1) {
        marks.splice(idx, 1);
      }
    } else {
      // 追加アクション（デフォルト）
      marks.push({
        positions: action.positions,
        markType: action.markType,
        label: action.label,
      });
    }
  }
}
```

## 影響範囲

- `src/types/scenario.ts`
- `src/logic/scenarioParser.ts`
- `src/stores/boardStore.ts`
- `src/components/scenarios/ScenarioPlayer/composables/useScenarioNavigation.ts`
- `src/editor/composables/useBoardActions.ts`
- `src/editor/components/PreviewPanel.vue`
- `src/editor/components/sections/BoardActionEditor/` 配下

## テスト計画

1. **後方互換性テスト**
   - `action` フィールドがない既存のマークアクションが正常に動作することを確認

2. **マーク削除テスト**
   - マークを追加した後、削除アクションで正しく削除されることを確認
   - 複数マークがある状態で特定のマークのみ削除できることを確認

3. **プレビュー表示テスト**
   - エディタのプレビューで削除アクションが正しく反映されることを確認

4. **戻る操作テスト**
   - マーク削除後に前のダイアログに戻ると、マークが復元されることを確認

## JSON 例

```json
{
  "boardActions": [
    {
      "type": "mark",
      "positions": [{ "row": 7, "col": 7 }],
      "markType": "circle",
      "action": "draw"
    },
    {
      "type": "mark",
      "positions": [{ "row": 7, "col": 7 }],
      "markType": "circle",
      "action": "remove"
    }
  ]
}
```
