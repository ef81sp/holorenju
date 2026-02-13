# Phase 1: VCTカウンター脅威の基盤実装 [F-2, F-3]

**目的**: VCTカウンター脅威の基盤実装と、`isVCTFirstMove`（レビュー用）の精度向上

**対象ファイル**: `src/logic/cpu/search/vct.ts`

## 背景

現状は `ct === "win"` のみプルーニングし、`ct === "four"` / `ct === "three"` は通常再帰にフォールスルーしている。これにより、防御側がカウンターフォーやカウンター活三を作っても攻撃側が無条件に継続できてしまい、偽陽性が発生する。

詳細分析: `docs/vct-counter-threat-analysis.md`

## 実装結果

### 方針: 検証関数のみct=four適用

ct=four を全4関数に適用すると hasVCT の探索木が変形し、23手目テストが実用時間内に完了しない問題が判明（楽観的 isThreat のみの判定でも30秒超でタイムアウト）。

**最終方針**: 探索関数は高速性を維持し、検証関数（`isVCTFirstMove`）のみct=fourを適用。

> **Note**: 探索関数（hasVCT/findVCTMove/findVCTSequence）の偽陽性は本Phaseでは改善されない。
> Phase 2 で `findVCTMove` をメインフローに統合する際は「ヒント方式 + minimax検証」で
> 偽陽性を吸収する設計とすること。

| 関数                       | ct=win                          | ct=four               | ct=three/none |
| -------------------------- | ------------------------------- | --------------------- | ------------- |
| `hasVCT`                   | `checkFive` → false             | 通常再帰              | 通常再帰      |
| `findVCTMoveRecursive`     | `checkFive` → false             | 通常再帰              | 通常再帰      |
| `findVCTSequenceRecursive` | `checkFive` → false             | 通常再帰              | 通常再帰      |
| `isVCTFirstMove`           | `evaluateCounterThreat` → false | ブロック+脅威チェック | 通常再帰      |

### evaluateCounterThreat（新規ヘルパー）

`isVCTFirstMove` 専用のカウンター脅威判定関数:

```typescript
function evaluateCounterThreat(
  ct,
  board,
  color,
  defensePos,
  depth,
  limiter,
  options,
): boolean;
```

- `ct=win`: false（防御で五連）
- `ct=four`: `getFourDefensePosition` でブロック位置取得 → `isThreat` で脅威チェック（楽観判定: 再帰なし）
- `ct=three/none`: `hasVCT` 通常再帰

### hasVCT / findVCTMoveRecursive / findVCTSequenceRecursive の簡素化

元々 `checkDefenseCounterThreat` で ct を計算していたが ct=win のみ使用していたため、`checkFive` 直接呼び出しに簡素化。`checkFive` は4方向走査のみだが、`checkDefenseCounterThreat` は20-30走査を行うため、定数倍のパフォーマンス改善。

### ct=three について

理論上は `hasVCF` フォールバックが正しいが、実用上は時間予算の圧迫と探索木の変形で回帰が発生する。将来の改善課題として `docs/vct-counter-threat-analysis.md` に記録。

## テスト結果

- [x] 既存VCTテスト（`vct.perf.test.ts`）全58テストパス
- [x] `ct=four` でブロックが脅威を作る → VCT成立（isVCTFirstMove）
- [x] `ct=four` でブロックが脅威を作らない → VCT不成立（isVCTFirstMove）
- [x] `ct=three` 検出テスト
- [x] `ct=three` VCFあり/なしテスト
- [x] 23手目VCT経路が引き続き検出される
- [x] `pnpm check-fix` パス（0 errors）
- [x] unit テスト全1407パス
