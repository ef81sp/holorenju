# Phase 5: `findPreSearchMove` のフェーズ分離 [R-3]

**目的**: 7責務を明確なサブ関数に分離し、テスト容易性を向上

**対象ファイル**: `src/logic/cpu/search/iterativeDeepening.ts`

## 背景

`findPreSearchMove` は194行で7つの責務を持つ巨大関数。
Phase 1-4 の変更でさらにVCTチェックが追加されるため、分離しないと保守が困難になる。

## 実装結果

### 分離したサブ関数

1. `checkEmergencyTimeout()` — 絶対時間制限超過時の緊急フォールバック
2. `checkImmediateWin()` — 即勝ち手（五連完成）の検出
3. `checkMustDefend(threats)` — 相手の活四・止め四に対する必須防御
4. `tryDefenseMove()` — 防御手の禁手チェック付き返却（checkMustDefendから抽出）
5. `checkForcedWinSequences()` — VCF/Mise-VCF/VCTの強制勝ち探索
6. `computeVCFDefenseMoves()` — 相手VCFに対する候補手制限計算

### findPreSearchMove パイプライン

```typescript
function findPreSearchMove(...): PreSearchResult {
  const timeout = checkEmergencyTimeout(...);
  if (timeout) return timeout;

  const win = checkImmediateWin(board, color);
  if (win) return win;

  const threats = detectOpponentThreats(board, opponentColor);

  const defense = checkMustDefend(board, color, threats);
  if (defense) return defense;

  const forced = checkForcedWinSequences(board, color, opponentColor, evaluationOptions);
  if (forced.immediateMove) return { immediateMove: forced.immediateMove };

  const opponentVCFMove = forced.opponentVCFResult?.firstMove;
  return {
    opponentVCFFirstMove: opponentVCFMove ?? null,
    vctHintMove: forced.vctHintMove,
    openThreeDefenseMoves: threats.openThrees,
    restrictedMoves: opponentVCFMove
      ? computeVCFDefenseMoves(board, color, opponentColor, opponentVCFMove)
      : undefined,
  };
}
```

### テスト結果

- [x] 既存テスト全1409パス
- [x] `pnpm check-fix` パス（0 errors）

## リスク

- **最小**: 構造変更のみ。動作変更なし。既存テストで全パス検証。
