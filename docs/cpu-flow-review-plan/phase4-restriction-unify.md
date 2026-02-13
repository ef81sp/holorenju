# Phase 4: 候補手制限ロジックの統一 [R-2]

**目的**: VCF防御と活三防御の制限ロジックを1箇所に集約

**対象ファイル**: `src/logic/cpu/search/iterativeDeepening.ts`

## 背景

候補手制限ロジックが2箇所に分散している:

- VCF防御: `findPreSearchMove` 内（L248-284）→ `PreSearchResult.restrictedMoves` として返却
- 活三防御: メイン関数（L390-407）→ `detectOpponentThreats` の結果から直接構築

同じ「候補手をフィルタする」処理が物理的に離れており、優先順位関係が暗黙的。

## 実装結果

### 変更内容

1. `opponentOpenThrees` → `openThreeDefenseMoves` にリネーム（用途を明確化）
2. メイン関数の候補手制限ロジックを `restrictions` 配列 + ループに統一:

```typescript
const restrictions = [
  preSearchResult.restrictedMoves,       // VCF防御（最優先）
  preSearchResult.openThreeDefenseMoves, // 活三防御
];
for (const restriction of restrictions) {
  if (restriction && restriction.length > 0) {
    const filtered = moves.filter(m => restrictedSet.has(...));
    if (filtered.length > 0) { moves = filtered; break; }
  }
}
```

Phase 3 で `detectOpponentThreats` の二重呼び出しは解消済みのため、本 Phase ではフィールドリネームとロジック統一のみ。

### テスト結果

- [x] 既存テスト全1409パス
- [x] `pnpm check-fix` パス（0 errors）

## リスク

- **最小**: リネーム + 同一ロジックのDRY化。動作変更なし。
