# analyze-games: VCF/VCT探索の isForbiddenTrap 活用計画

## 背景

`VCFSequenceResult` と `VCTSequenceResult` に `isForbiddenTrap: boolean` フラグが追加された。
これにより、VCF/VCT探索の結果から禁手追い込みを正確に判別できる。

現在の `scripts/lib/gameAnalyzer.ts` では `evaluateForbiddenTrap()` による即時スコアリングで
禁手追い込みのセットアップを検出しているが、これは1手の局面評価であり、
複数手にわたる完全な必勝手順が禁手追い込みで終わるかの判定はできない。

## 提案

`gameAnalyzer.ts` の手タグ付け処理で、VCF/VCT探索を実行し `isForbiddenTrap` を活用する。

### メリット

- 複数手の必勝手順が禁手追い込みで終わるかを正確に判定
- 現在の `evaluateForbiddenTrap()` （1手のセットアップ検出）と補完的に使える
- 振り返り画面と同じ探索ロジックを共有でき、一貫性がある

### 実装イメージ

```typescript
// gameAnalyzer.ts の手タグ付け処理に追加
if (color === "white") {
  const vcfSeq = findVCFSequence(board, color, options);
  const vctSeq = !vcfSeq ? findVCTSequence(board, color, options) : null;
  const forcedWin = vcfSeq ?? vctSeq;
  if (forcedWin?.isForbiddenTrap) {
    tags.push("forbidden-trap-sequence"); // 複数手の禁手追い込み手順
  }
}
```

### 注意点

- VCF/VCT探索は計算コストが高い（振り返りWorkerでは数秒かかる場合あり）
- 全手に対して実行するとベンチマーク分析が遅くなる可能性
- 時間制限の調整やキャッシュ戦略が必要
