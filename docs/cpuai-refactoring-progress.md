# cpuAI リファクタリング進捗

## 概要

cpuAIディレクトリのコードをSSoT、DRY、SOLID、t-wada TDD原則に基づいて整理完了。

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

### Phase 5: patterns/threatAnalysis.ts 作成 ✅

**コミット**: `b164d59`

- `src/logic/cpuAI/patterns/threatAnalysis.ts` を作成
- findJumpGapPosition() をSSoT化（跳び四空き位置検出）
- getJumpThreeDefensePositions() をSSoT化（跳び三防御位置）
- vct.tsから重複関数を削除（getLineEnds, findJumpGap, getJumpThreeDefensePositions）
- vcf.tsのfindDefenseForJumpFourを委譲に変更
- 318行のコード削減

### Phase 6: search/ディレクトリ作成 ✅

**コミット**: `e079e08`

- `src/logic/cpuAI/search/` ディレクトリを作成
- minimax.ts, vcf.ts, vct.tsをsearch/に移動
- search/index.tsでre-exportを提供
- 外部ファイルのインポートパスを更新

### Phase 7: クリーンアップ ✅

- 未使用export確認済み
- 全211テストパス
- ドキュメント更新完了

---

## 最終モジュール構成

```
src/logic/cpuAI/
├── core/                      # 共通基盤モジュール
│   ├── constants.ts           # DIRECTIONS, DIRECTION_INDICES
│   ├── boardUtils.ts          # countStones, applyMove等
│   └── lineAnalysis.ts        # countLine, checkEnds, getLineEnds
│
├── patterns/                  # パターン検出モジュール
│   ├── threatAnalysis.ts      # findJumpGapPosition, getJumpThreeDefensePositions
│   └── threatAnalysis.test.ts
│
├── search/                    # 探索モジュール
│   ├── index.ts               # re-export
│   ├── minimax.ts             # Minimax + Alpha-Beta
│   ├── minimax.test.ts
│   ├── vcf.ts                 # VCF探索
│   ├── vcf.test.ts
│   ├── vct.ts                 # VCT探索
│   └── vct.test.ts
│
├── evaluation.ts              # 盤面評価
├── evaluation.test.ts
├── moveGenerator.ts           # 手生成
├── moveGenerator.test.ts
├── transpositionTable.ts      # 置換表
├── transpositionTable.test.ts
├── zobrist.ts                 # Zobristハッシュ
├── zobrist.test.ts
├── opening.ts                 # 開局パターン
├── opening.test.ts
├── renjuAI.worker.ts          # Web Worker
├── benchmark/                 # ベンチマーク
│   ├── headless.ts
│   ├── index.ts
│   └── rating.ts
├── testUtils.ts               # テストユーティリティ
└── index.ts                   # Public API
```

---

## テストカバレッジ（最終）

| ファイル               | テスト数 |
| ---------------------- | -------- |
| vcf.test.ts            | 36       |
| vct.test.ts            | 16       |
| minimax.test.ts        | 19       |
| evaluation.test.ts     | 48       |
| threatAnalysis.test.ts | 10       |
| その他                 | 82       |
| **合計**               | **211**  |

---

## Public API（index.ts）

```typescript
// evaluation
export { evaluateBoard, evaluatePosition, PATTERN_SCORES };
// moveGenerator
export { generateMoves, isNearExistingStone };
// minimax (from search/)
export { findBestMove, minimax, type MinimaxResult };
// opening
export { getOpeningMove, getOpeningPatternInfo, isOpeningPhase, TENGEN };
```

---

## 確認コマンド

```bash
# テスト実行
pnpm test src/logic/cpuAI/

# lint/型チェック
pnpm check-fix

# ベンチマーク（性能劣化確認）
pnpm bench:ai
```

---

## リファクタリング成果

- **コード削減**: 約318行
- **SSoT確立**: 跳びパターン検出、ライン解析
- **モジュール構成**: core/, patterns/, search/ の3層構造
- **テスト強化**: 195→211テスト
