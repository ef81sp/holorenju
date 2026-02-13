# Phase 6: 死コード削除 [R-4]

**目的**: 無効化されたボーナス変数を削除

**対象ファイル**: `src/logic/cpu/evaluation/positionEvaluation.ts`

## 背景

以下の変数が `0` にハードコードされており、スコア計算に寄与していない:

- `const vctBonus = 0` (L258) — コメント: 「ルートレベルでのみ判定するため無効化」
- `const fukumiBonus = 0` (L246) — コメント: 「ルートレベルでのみ判定するため無効化」

スコア計算式（L328-333）にこれらが含まれているが、値が0なので影響なし。
コードの可読性を阻害するため削除する。

## 変更内容

1. `const vctBonus = 0` とスコア計算式の `vctBonus` を削除
2. `const fukumiBonus = 0` とスコア計算式の `fukumiBonus` を削除
3. 関連コメントも削除

`patternScores.ts` の `VCT_BONUS: 8000` は `@deprecated` のまま残す（Phase 2 で参照する可能性があるため）。

## 実装結果

### 削除した死コード

1. `const fukumiBonus = 0` + コメント（evaluatePositionCore内）
2. `const vctBonus = 0` + コメント（evaluatePositionCore内）
3. スコア計算式から `fukumiBonus +` と `vctBonus -` を削除

`evaluatePositionWithBreakdown` の `fukumiBonus` は実際に計算される生きたコードのため残存。
`patternScores.ts` の `VCT_BONUS: 8000` と `FUKUMI_BONUS: 1500` は他の関数で参照されるため残存。

### テスト結果

- [x] 既存テスト全1409パス
- [x] `pnpm check-fix` パス（0 errors）

## リスク

- **最小**: 値が0の変数を削除するだけ。計算結果は変わらない。
