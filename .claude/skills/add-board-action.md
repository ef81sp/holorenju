# ボードアクションの追加手順

## 概要

シナリオの盤面操作に新しい種類のアクションを追加する際の手順とポイント。

## 修正対象ファイル一覧

| ファイル | 役割 |
|---------|------|
| `src/types/scenario.ts` | 型定義（BoardAction union型） |
| `src/stores/boardStore.ts` | 盤面操作の実装 |
| `useScenarioNavigation.ts` | シナリオ再生時の処理 |
| `BoardActionEditor/types.ts` | エディタ用型エイリアス |
| `useBoardActions.ts` | エディタでのアクション生成 |
| `XxxActionForm.vue` | エディタUI（新規作成） |
| `BoardActionEditor.vue` | エディタUI統合 |
| `PreviewPanel.vue` | プレビュー処理 |

## 手順詳細

### 1. 型定義 (`src/types/scenario.ts`)

1. 新しい interface を定義（例: `ResetMarkLineAction`）
2. `BoardAction` union型に追加
3. export に追加

```
interface XxxAction {
  type: "xxx";
  // フィールドがあれば追加
}

type BoardAction = ... | XxxAction;

export type { ..., XxxAction };
```

### 2. boardStore (`src/stores/boardStore.ts`)

1. 新しいメソッドを追加（例: `resetMarkLine()`）
2. return文でメソッドを公開

### 3. useScenarioNavigation.ts

2箇所のswitch文に追加が必要:

1. `showDialogueWithAction()` 内のswitch文 - アニメーション付き再生時
2. `applyBoardAction()` 内のswitch文 - アニメーションなし再構築時

> **重要**: `assertNever(action)` がdefaultにあるため、すべてのアクションタイプを網羅しないと型エラーになる

### 4. エディタ: types.ts

型エイリアスを追加:

```
export type XxxAction = Extract<BoardAction, { type: "xxx" }>;
```

### 5. エディタ: useBoardActions.ts

`createBoardAction()` のswitch文にcase追加。デフォルト値を持つオブジェクトを返す。

### 6. エディタ: XxxActionForm.vue（新規作成）

- フィールドがない場合: 説明メッセージのみ表示（`ResetAllActionForm.vue` を参考）
- フィールドがある場合: 適切なフォームコンポーネント（`PlaceActionForm.vue` 等を参考）

### 7. エディタ: BoardActionEditor.vue

4箇所の修正:

1. import追加
2. `isXxxAction` computed追加
3. `<select>` に `<option>` 追加
4. template内に条件分岐追加

### 8. PreviewPanel.vue

3箇所のswitch文に追加:

1. `applyBoardAction()` - 盤面（石）への影響
2. `currentMarks` computed - マークへの影響
3. `currentLines` computed - ラインへの影響

> 影響しない項目は既存のcaseとまとめてfall-through可能

## 検証

1. `pnpm check-fix` を実行して型エラー・lint問題がないことを確認
2. エディタでアクションを選択・追加できることを確認
3. プレビューで意図通りの動作を確認
4. 実際のシナリオプレイで動作確認

## ポイント

- **assertNever**: switch文のdefaultで使用されているため、caseの追加漏れは型エラーで検出される
- **fall-through**: 同じ処理のアクションはcaseをまとめて記述可能（例: `case "resetAll": case "resetMarkLine":`）
- **アニメーション**: 石・マーク・ラインの追加はアニメーション処理が別にあるため、switch文では他のアクションのみ処理
