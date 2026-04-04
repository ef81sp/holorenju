# Issue: 振り返り解析の終盤局面でVCT探索が非常に遅い

## 現象

30手程度の棋譜で振り返り解析を実行すると、終盤の数手（28-30手目付近）で fullEval が数十秒〜数分停滞する。

再現棋譜:

```
H8 H9 H6 I8 J7 I10 I7 G8 F7 G7 G9 J6 F8 F10 F4 G5 D6 H10 G10 F5 G4 H7 J9 E4 G6 E5 D5 I5 F6 H5
```

## 原因

`detectForcedWin`（`review/forcedWinDetection.ts`）内で、VCF/Mise-VCF が見つからない場合に VCT 探索が2段階で走る:

1. **メイン VCT 探索** (`REVIEW_VCT_OPTIONS_WITH_BRANCHES`)
   - `maxDepth: 6`, `timeLimit: Infinity`, `maxNodes: 500_000`
   - 時間制限なし

2. **フォールバック反復** (`findVCTByFirstMoveIteration`)
   - 脅威手を最大40手列挙し、各手に `maxNodes: 100_000` の VCT 探索
   - 最悪ケース: 40 × 100K = 4Mノード、時間制限なし

合計 **4.5Mノードの VCT 探索が時間制限なし** で実行される。VCT は minimax より1ノードあたりのコストが高い（再帰的攻防シミュレーション）ため、複雑な終盤局面では数十秒かかる。

さらに fullEval は VCT 後にも:

- minimax 探索 (2M nodes, 15s limit)
- `evaluatePlayedForcedWin` での VCF/VCT 探索
- 候補手検証 (`verifyCandidates`) での各候補 VCF/VCT 探索

これらが累積して1手あたり30秒以上になる場合がある。

## 影響箇所

- `src/logic/cpu/review/forcedWinDetection.ts`: `detectForcedWin`, `findVCTByFirstMoveIteration`
- `src/logic/cpu/review/reviewConstants.ts`: `REVIEW_VCT_OPTIONS_WITH_BRANCHES`
- `src/logic/cpu/review/evaluatePlayedMove.ts`: `evaluatePlayedForcedWin`

## 改善案

1. **VCT 探索に時間制限を追加**: `REVIEW_VCT_OPTIONS_WITH_BRANCHES.timeLimit` を `Infinity` → `10_000`（10秒）に変更
2. **フォールバック反復の上限削減**: `VCT_FALLBACK_MAX_FIRST_MOVES` を 40 → 15 に、`VCT_FALLBACK_MAX_NODES` を 100K → 50K に
3. **全体のタイムバジェット制**: `detectForcedWin` 全体に時間制限を設け、VCF → Mise-VCF → VCT を通じた合計時間を制限
4. **早期打ち切り**: VCT 探索開始前に局面の複雑度（脅威手の数）を見て、多すぎる場合はスキップ
