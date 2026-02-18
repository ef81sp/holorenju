# VCT カウンター脅威分析

VCT探索における防御手のカウンター脅威（counter-threat）チェックの設計・実装の知見をまとめる。

## 背景

VCT（Victory by Continuous Threats）探索で、防御手が五連・四・活三を作る場合の処理が欠落しており、偽陽性が報告された。VCF（Victory by Continuous Fours）では既にカウンターフォーチェックが実装済み。

## VCF vs VCT のカウンター脅威の違い

### VCF（四追い）でのカウンターフォー

VCF は四のみで追うため、カウンターフォーの処理が単純:

- 攻撃側が四を打つ → 防御側は**必ず**ブロック
- 防御手がカウンターフォーを作る → 攻撃側が応じる必要 → VCF中断
- **結論**: `ct === "four"` → 即false（正しい）

```typescript
// vcf.ts L160-175: 既存の正しい実装
const defenseCounterFour = createsFour(
  board,
  defensePos.row,
  defensePos.col,
  opponentColor,
);
if (!defenseWins && !defenseCounterFour) {
  result = hasVCF(board, color, depth + 1, limiter, options);
}
```

### VCT（三・四連続脅威）でのカウンター脅威

VCT は三脅威も含むため、カウンター脅威の処理が複雑:

1. **`ct === "win"`（五連）**: 即false — 防御側が勝ち。VCF と同じ。
2. **`ct === "four"`（四）**: **即false にできない** — 攻撃側が四を防ぎつつ脅威を作る可能性がある。VCT の攻撃手は四だけでなく三も使うため、カウンターフォーへの応手が新たな脅威になり得る。
3. **`ct === "three"`（活三）**: 攻撃側の次の手が四なら、活三を無視できる。三脅威のみ無効化。hasVCF にフォールバック可能だが、探索コストが高く時間予算を圧迫する。

### 重要な違い

| 状況         | VCF での扱い            | VCT での扱い                      |
| ------------ | ----------------------- | --------------------------------- |
| ct = "win"   | false（正しい）         | false（正しい）                   |
| ct = "four"  | false（正しい）         | **false にすると過剰枝刈り**      |
| ct = "three" | N/A（VCF に三は無関係） | hasVCF フォールバック or 通常再帰 |

## 実装の試行と結果

### 試行1: VCF と同じ `ct=four → false`

```typescript
if (ct === "win" || ct === "four") {
  vctResult = false;
}
```

**結果**: 23手目テストが回帰。30秒でもVCT検出不能（タイムアウトではなくロジック上の偽陰性）。

**原因**: VCT ツリーの深い階層で防御がカウンターフォーを作るが、攻撃側がそのフォーに応じつつ脅威を維持するパスが存在する。`ct=four → false` は有効な VCT パスを不正にカットしていた。

### 試行2: `ct=three → hasVCF` フォールバック

```typescript
if (ct === "three") {
  vctResult = hasVCF(board, color, 0, limiter, options?.vcfOptions);
}
```

**結果**: 共有時間予算（limiter）を hasVCF 呼び出しが大量消費し、23手目テストがタイムアウト。

**原因**: VCT探索の各分岐で ct=three が発生するたびに hasVCF が呼ばれ、累積的に時間を消費。

### 試行3: `hasOpenThree` の depth===0 制限を削除

```typescript
// depth === 0 を削除して全深度でチェック
if (hasOpenThree(board, opponentColor)) {
  return false;
}
```

**結果**: 23手目テストが回帰。

**原因**: `hasOpenThree` は盤面全体を走査するため、VCT開始前から存在していた活三（depth 0 でチェック済み）と、VCT交換中に生まれた活三を区別できない。

### 最終実装: `ct=win` のみプルーニング

```typescript
if (ct === "win") {
  vctResult = false;
} else {
  /* 通常の再帰 */
}
```

**結果**: 全テストパス。VCT の正確性と性能を両立。

## 結論

### VCT で安全にプルーニングできるのは `ct=win`（五連）のみ

- **五連**: 防御側が即座に勝利 → 攻撃側の勝ちはあり得ない
- **四**: 攻撃側が応じる必要があるが、応手が脅威になり得る → 即 false は過剰
- **活三**: 攻撃側の次の四脅威で無視される可能性がある → 即 false は過剰

### `checkDefenseCounterThreat` ヘルパーの意義

1パス統合関数で五連・四・活三を効率的に判定できる。現在は `ct=win` のみ使用しているが、将来的に四・活三の扱いを改善する際の基盤となる。

### 今後の改善方向

#### 実装済み: `isVCTFirstMove` の ct=four 再帰検証

`evaluateCounterThreat` の ct=four 分岐を `isThreat`（1手先の楽観判定）から `hasVCT`（再帰的検証）に変更。ブロック位置が脅威を作っても、その脅威がVCT継続に繋がらない場合を正しく棄却する。

例: ブロックが「囲まれた活三」（両端に相手石）を作る場合、止め四しか作れずVCT不成立。旧コードでは `isThreat=true` で偽陽性、新コードでは `hasVCT=false` で正しく棄却。

#### 未実装: 探索関数への ct=four 適用

探索関数（hasVCT/findVCTMove/findVCTSequence）では ct=four/three を通常再帰にフォールスルーしたまま。探索関数に適用すると探索木が変形し実用時間で完了しないため、Phase 2 の「ヒント方式 + minimax検証」で偽陽性を吸収する設計を予定。

#### 未実装: ct=three の hasVCF フォールバック

理論上は `ct=three` で `hasVCF` にフォールバックすべきだが、共有時間予算を圧迫する問題が未解決。

## 17手目VCT経路の分析

報告された棋譜（`H8 I9 I7 G9 H7 H9 F9 G8 F7 G7 G6 H10 G10 F8 I11 G11 J8`）の17手目後の白VCT:

### コードが見つけるVCT経路

```
E13(四) → F12(防御) → K9(四) → J9(防御) → E7(四) → D6(防御) →
E9(活三) → H6(防御) → D8(跳び三) → H12(防御) → C8(四)
```

**全防御手のカウンター脅威**: none（五連・四・活三いずれも作らない）

このVCT経路は有効であり、禁手追い込みの検出は正しい。プランで分析された別のVCT経路（K9が黒防御でカウンター脅威を持つ）とは異なるパスが見つかっている。

### 含意

`findVCTSequence` は最初に見つかった有効な経路を返すため、表示される経路が常に「最も分かりやすい」経路とは限らない。偽陽性の疑いがある場合、別の有効な経路が存在する可能性がある。

## 関連ファイル

| ファイル                              | 役割                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `src/logic/cpu/search/vct.ts`         | VCT探索本体（`checkDefenseCounterThreat` ヘルパー含む） |
| `src/logic/cpu/search/vcf.ts`         | VCF探索（カウンターフォーチェック済み、参考実装）       |
| `src/logic/cpu/search/threatMoves.ts` | `createsFour`, `createsOpenThree` 共通関数              |
| `src/logic/cpu/search/vct.test.ts`    | VCTテスト                                               |
