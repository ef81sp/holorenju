# VCF偽陽性の改善プラン

## 背景

hard vs hard 200局のベンチマークで、VCF検出後にルートが崩壊し敗北するケースが3件確認された:

- **game 185**: m15でVCF(100000)検出→m17で278に急落→m19で禁手追い込み敗北（20手）
- **game 156**: m49でVCF検出→禁手に陥り敗北
- **game 121**: m42でVCF検出→黒のカウンターVCFで崩壊→61手で敗北

## Phase 0 結果: 根本原因特定 ✅

**3件全てがVCFではなくMise-VCFの偽陽性**であることが判明。

デバッグスクリプト `scripts/debug-vcf-false-positive.ts` で盤面を再現し、`findVCFSequence` と `findMiseVCFSequence` を実行した結果:

### Game 185 (black, m15)

- **VCF**: 見つからず
- **Mise-VCF**: H7(mise) → G6(防御) → H9(VCF)
- **実際**: 黒がH7を着手、白がG6ではなくH6を選択 → Mise-VCFルート崩壊
- **原因**: Mise-VCFの防御手が「強制」ではない。白はG6以外の手を選択可能。

### Game 156 (black, m49)

- **VCF**: F14始動の9手VCF（検証済みで正当） → ただしデフォルト150msの時間制限で**タイムアウト**（再実行で210ms）
- **Mise-VCF**: D10(mise) → F8(防御) → VCF勝ち
- **実際**: VCFタイムアウト → Mise-VCFがD10を選択 → 白がF8でなくJ11を選択
- **注意**: m49+m50後もF8始動のVCFは存在するが、後続手でVCFが検出されず負け
- **原因**: (1) 深いVCFのタイムアウト (2) Mise-VCFの防御が強制でない

### Game 121 (white, m42)

- **VCF**: 見つからず
- **Mise-VCF**: K13(mise) → I11(防御) → 禁手追い込みVCF
- **実際**: 白がK13を着手、黒がI11ではなくK10を選択 → Mise-VCFルート崩壊
- **原因**: Mise-VCFの防御手が「強制」ではない。

### 根本原因のまとめ

`checkForcedWinSequences()`（`iterativeDeepening.ts:201-270`）で**Mise-VCFの結果を`PATTERN_SCORES.FIVE(100000)`で即座に返している**ことが問題。

```typescript
// 現在の問題コード (iterativeDeepening.ts:226-246)
if (!opponentVCFResult) {
  const miseVcfMove = findMiseVCFMove(board, color, { ... });
  if (miseVcfMove) {
    return {
      immediateMove: {
        position: miseVcfMove,
        score: PATTERN_SCORES.FIVE,  // ← 100000でminimax完全バイパス
      },
      ...
    };
  }
}
```

VCFは全手が四で防御が数学的に1通りしかないため確実だが、Mise-VCFはミセ手後の防御が「強制」とは限らない（相手は防御せず他の手を打てる）。にもかかわらず、VCFと同じ100000でminimaxをバイパスしている。

## 実装計画（Phase 0の結果に基づき更新）

### Phase 1: Mise-VCFをminimax検証に委ねる（最優先）

**ファイル**: `src/logic/cpu/search/iterativeDeepening.ts`

Mise-VCFの結果をVCTヒントと同様に扱い、minimax探索で検証させる。

```typescript
// 変更後: Mise-VCFをヒントとして扱う
if (!opponentVCFResult) {
  const miseVcfMove = findMiseVCFMove(board, color, { ... });
  if (miseVcfMove) {
    const isForbidden = color === "black" &&
      checkForbiddenMoveWithCache(board, miseVcfMove.row, miseVcfMove.col).isForbidden;
    if (!isForbidden) {
      vctHintMove = miseVcfMove;  // VCTヒントと同じ扱い
    }
  }
}
```

**効果**:

- Mise-VCFの手はmove orderingで優先されるが、minmax探索で正当性が検証される
- 相手の応手が本当に強制かどうかはminimaxが判定する
- 偽陽性が自然に除去される

**テスト先行**:

- Mise-VCFが検出されてもminimaxが起動されることを確認
- Mise-VCFのhint手がmove orderingで優先されることを確認
- game 185/121の盤面でMise-VCF手がscoreリターン値 < 100000になることを確認

### Phase 1.5: VCFタイムアウト対策（Game 156固有）

Game 156では深いVCF（9手、210ms）がデフォルトの150msで時間切れになり、代わりにMise-VCFが選ばれた。

**選択肢**:

- A) VCF_TIME_LIMIT を 150ms → 300ms に増加（単純だがベンチマーク全体で思考時間増加）
- B) Mise-VCFが見つかった場合、VCFの時間制限を延長して再探索（Mise-VCFの存在は深いVCFの可能性を示唆）
- C) 現状維持（Phase 1の修正でMise-VCFがminimax検証されるため、タイムアウトは間接的に緩和）

→ **Phase 1の修正を先に適用し、ベンチマークで効果測定後に判断**。Phase 1でMise-VCFがminimaxに委ねられれば、Game 156のケースもminimax内でVCFが検出される可能性がある。

### ~~Phase 2: カウンターVCF検証~~（優先度下げ）

> Phase 0でカウンターVCFが原因のケースは確認されなかった。missed-vcfは1件/200局のみ。Phase 1の効果測定後に再評価する。

### ~~Phase 3: VCFルート妥当性検証~~ （削除）

> レビューで削除済み。

## テスト戦略

1. **デバッグスクリプト**: `scripts/debug-vcf-false-positive.ts` で盤面再現と検証（完了）
2. **ユニットテスト** (`miseVcf.test.ts` / `iterativeDeepening.test.ts`):
   - Phase 1: Mise-VCF検出後にminimax探索が起動されることを確認
   - game 185/121の盤面でスコアが100000未満になることを確認
3. **ベンチマーク**: Phase 1完了後に `pnpm bench --self --players=hard --games=200 --parallel` で効果測定

## 検証指標

| 指標                                      | 現在      | 目標                          |
| ----------------------------------------- | --------- | ----------------------------- |
| VCF偽陽性（advantage-squandered VCF付き） | 3件/200局 | 0-1件/200局                   |
| missed-vcf                                | 1件/200局 | 0-1件/200局（悪化しないこと） |

## 主要ファイル

| ファイル                                     | 変更内容                       |
| -------------------------------------------- | ------------------------------ |
| `src/logic/cpu/search/iterativeDeepening.ts` | Mise-VCFをhint扱いに変更       |
| `scripts/debug-vcf-false-positive.ts`        | デバッグスクリプト（作成済み） |
| テストファイル                               | Mise-VCFのminimax検証テスト    |
