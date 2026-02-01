# cpuAI リファクタリング進捗

## 概要

cpuAIディレクトリのコードをSSoT、DRY、SOLID、t-wada TDD原則に基づいて整理中。

## 完了したPhase

### Phase 1: テスト基盤強化 ✅

**コミット**: `22e658e`

- vcf.test.ts: 6→36テスト
  - findVCFMoveのテスト追加
  - 内部関数（countLine, checkEnds等）のテスト追加
  - エッジケース（盤端、禁手防御不能）のテスト追加
  - ゴールデンテスト追加
- vct.test.ts: 10→16テスト
  - 石数閾値のテスト追加
  - ゴールデンテスト追加
- vcf.tsの内部関数をexport（テスト可能に）

### Phase 2: core/constants.ts 作成 ✅

**コミット**: `22e658e`

- `src/logic/cpuAI/core/constants.ts` を作成
- DIRECTIONS, DIRECTION_INDICESをSSoT化
- vcf.ts, vct.ts, evaluation.tsのimportを切り替え

### Phase 3: core/boardUtils.ts 作成 ✅

**コミット**: `22e658e`

- `src/logic/cpuAI/core/boardUtils.ts` を作成
- countStones, applyMove, getOppositeColor, selectRandomを統一
- minimax.ts, vct.ts, renjuAI.worker.tsの重複定義を削除
- utils.tsを削除

### Phase 4: core/lineAnalysis.ts 作成 ✅

**コミット**: `20e176b`

- `src/logic/cpuAI/core/lineAnalysis.ts` を作成
- countLine, checkEnds, getLineEndsを統一
- vcf.ts, vct.tsの重複定義を削除
- vcf.tsから後方互換性のため再export

---

## 残りのPhase

### Phase 5: patterns/threatAnalysis.ts 作成

**目的**: 脅威検出ロジックの統一

**作業内容**:
1. `patterns/threatAnalysis.ts` を作成
2. 端の位置取得ロジックを統一
3. 跳びパターン検出を統一
4. evaluation.tsのdetectOpponentThreatsを移動

**対象ファイル**:
- `src/logic/cpuAI/vcf.ts` (findDefenseForConsecutiveFour: 行396-439付近)
- `src/logic/cpuAI/vct.ts` (getLineEnds: 行370-403付近, findJumpGap: 行408-495付近)
- `src/logic/cpuAI/evaluation.ts` (detectOpponentThreats, getDefensePositions等)

### Phase 6: search/ディレクトリ作成

**目的**: 探索モジュールの分離

**作業内容**:
1. `search/` ディレクトリを作成
2. vcf.ts, vct.ts, minimax.tsを移動
3. 重複コードを削除（core/, patterns/への依存に置き換え）
4. index.tsのexportパスを更新

### Phase 7: クリーンアップ

**目的**: 最終整理

**作業内容**:
1. 未使用exportの削除
2. 全テスト実行
3. ドキュメント更新

---

## 現在のモジュール構成

```
src/logic/cpuAI/
├── core/                      # 共通基盤モジュール ✅
│   ├── constants.ts           # DIRECTIONS, DIRECTION_INDICES ✅
│   ├── boardUtils.ts          # countStones, applyMove等 ✅
│   └── lineAnalysis.ts        # countLine, checkEnds, getLineEnds ✅
│
├── patterns/                  # パターン検出モジュール（未作成）
│   └── threatAnalysis.ts      # 脅威検出、防御位置計算
│
├── search/                    # 探索モジュール（未移動）
│   ├── vcf.ts
│   ├── vct.ts
│   └── minimax.ts
│
├── evaluation.ts
├── moveGenerator.ts
├── transpositionTable.ts
├── zobrist.ts
├── opening.ts
├── renjuAI.worker.ts
└── index.ts
```

---

## テストカバレッジ（改善後）

| ファイル | 改善前 | 改善後 |
|---------|--------|--------|
| vcf.ts | 6テスト | 36テスト |
| vct.ts | 10テスト | 16テスト |
| 全体 | 195テスト | 201テスト |

---

## Public API（維持すべき）

```typescript
// evaluation
export { evaluateBoard, evaluatePosition, PATTERN_SCORES }
// moveGenerator
export { generateMoves, isNearExistingStone }
// minimax
export { findBestMove, minimax, type MinimaxResult }
// opening
export { getOpeningMove, getOpeningPatternInfo, isOpeningPhase, TENGEN }
```

---

## 次回作業時のコマンド

```bash
# テスト実行
pnpm test src/logic/cpuAI/

# lint/型チェック
pnpm check-fix

# ベンチマーク（性能劣化確認）
pnpm bench:ai
```

---

## 参考資料

- 計画ファイル: `~/.claude/plans/dapper-meandering-treasure.md`
- 機能改善計画（別タスク）: `docs/cpu-ai-improvement-plan.md`
