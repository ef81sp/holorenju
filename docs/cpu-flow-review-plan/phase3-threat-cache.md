# Phase 3: `detectOpponentThreats` 重複解消 [R-1]

**目的**: 同一盤面での二重呼び出しを解消

**対象ファイル**: `src/logic/cpu/search/iterativeDeepening.ts`

## 背景

`detectOpponentThreats` が2回呼ばれている:

- 1回目: `findPreSearchMove` 内（L126）— 活四・止四の防御判定に使用。`openThrees` は取得するが捨てる。
- 2回目: メイン関数（L392）— 活三防御セットの構築に使用。

同一盤面に対して同じ結果を返すため、1回目の結果をキャッシュして2回目を不要にする。

## 変更内容

1. `PreSearchResult` に `openThrees: Position[]` フィールドを追加
2. `findPreSearchMove` 内の L126 で取得した `threats.openThrees` を返却に含める
3. メイン関数 L390-407 の `detectOpponentThreats` 呼び出しを削除し、`preSearchResult.openThrees` を使用

## 実装結果

### 変更内容

1. `PreSearchResult` に `opponentOpenThrees: Position[]` フィールドを追加（プラン時の `openThrees` から命名変更。既存の `opponentVCFFirstMove` と命名を合わせた）
2. `findPreSearchMove` の返却に `opponentOpenThrees: threats.openThrees` を追加
3. メイン関数の `detectOpponentThreats` + `getOppositeColor` 呼び出しを削除し、`preSearchResult.opponentOpenThrees ?? []` を使用

### テスト結果

- [x] 既存テスト全1409パス
- [x] `pnpm check-fix` パス（0 errors）

## リスク

- **最小**: 純粋なデータ受け渡しの変更。盤面は変更されていないため結果は同一。
