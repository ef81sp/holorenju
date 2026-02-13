# Phase 2: VCTのメインフロー統合 [F-1]

**目的**: VCT攻撃チェックを事前探索フローに追加

**対象ファイル**:

- `src/logic/cpu/search/iterativeDeepening.ts`
- `src/logic/cpu/evaluation/patternScores.ts`（既存の `enableVCT` フラグを利用）

## 実装結果

### ヒント方式（minimax検証）

VCT探索の偽陽性（Phase 1 で探索関数の偽陽性は未改善）を考慮し、即返却ではなくヒント方式を採用:

1. `findPreSearchMove` で VCT 手を検出
2. `PreSearchResult.vctHintMove` として返却
3. メイン関数で候補手の先頭に配置
4. minimax で検証（高スコアなら採用、そうでなければ他の手を選択）

### findPreSearchMove の変更

VCF → opponent VCF → Mise-VCF の後に VCT チェックを挿入:

```typescript
// 3.8 VCT攻撃ヒント
if (evaluationOptions.enableVCT) {
  const stoneCount = countStones(board);
  if (stoneCount >= VCT_STONE_THRESHOLD) {
    const vctMove = findVCTMove(board, color, { maxDepth: 4, timeLimit: 150 });
    // 禁手チェック後、vctHintMove として返却
  }
}
```

### 条件

- `enableVCT === true`（FULL_EVAL_OPTIONS = hard のみ）
- 石数 >= VCT_STONE_THRESHOLD (14)
- 黒番の場合は禁手チェック

### 時間予算

- VCT: 150ms（maxDepth: 4）
- hard（8000ms）: VCF(150) + VCT(150) + MiseVCF(500) = 800ms → 残り90% → 問題なし

## テスト結果

- [x] VCTのある局面で enableVCT=true なら有効な手が返る
- [x] enableVCT=false では VCT 探索が実行されない
- [x] 既存テスト全1409パス
- [x] `pnpm check-fix` パス（0 errors）
