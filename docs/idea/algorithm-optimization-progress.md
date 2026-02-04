# アルゴリズム高速化進捗メモ

## 最終更新: 2026-02-04

## 完了したフェーズ

### フェーズ1: 詳細プロファイリング追加 ✅

- `SearchStats` に4つの新統計項目を追加
  - `forbiddenCheckCalls`: 禁手判定回数
  - `boardCopies`: 盤面コピー回数
  - `threatDetectionCalls`: 脅威検出回数
  - `evaluationCalls`: 評価関数呼び出し回数
- `src/logic/cpu/profiling/counters.ts` モジュール追加
- `scripts/analyze-bench.sh` に詳細プロファイリングセクション追加

### フェーズ2: 禁手判定の盤面コピー削減 ✅

- 以下の関数をUndo方式に最適化（盤面コピーなし）:
  - `checkOpenPattern()`
  - `getConsecutiveThreeStraightFourPoints()`
  - `getJumpThreeStraightFourPoints()`
  - `checkJumpThree()`
  - `checkJumpFour()`
- `src/logic/cpu/cache/forbiddenCache.ts` モジュール追加

### フェーズ3: minimaxWithTT探索ループのUndo方式化 ✅

- `applyMoveInPlace()` / `undoMove()` 関数追加
- `minimaxWithTT` のメイン探索ループをUndo方式に変更
- 盤面コピー（`applyMove`）の代わりに石を置いて探索後に戻す

### フェーズ4: 禁手判定キャッシュ導入 ✅

- `checkForbiddenMoveWithCache()` 関数追加
- Zobristハッシュ + 位置をキーにしたグローバルキャッシュ
- `moveGenerator.ts` でキャッシュ版禁手判定を使用
- 探索中の盤面ハッシュを `setCurrentBoardHash()` で適切に更新

## パフォーマンス改善結果

| 指標                                      | 最適化前 | 最適化後 | 改善率       |
| ----------------------------------------- | -------- | -------- | ------------ |
| minimax.test.ts「活四を作る手を優先する」 | 4130ms   | 797ms    | **81%短縮**  |
| 盤面コピー/ノード比 (medium)              | 2.4      | 1.2      | **50%削減**  |
| 平均ゲーム処理時間                        | 2.38s    | 1.63s    | **32%短縮**  |
| TTヒット率 (easy)                         | 28.2%    | 38.7%    | **10pt向上** |

## 現在のボトルネック（プロファイリング結果）

最新ベンチマーク（2026-02-04）:

| 項目                | easy | medium |
| ------------------- | ---- | ------ |
| 禁手判定/ノード比   | 9.7  | 13.1   |
| 盤面コピー/ノード比 | 2.8  | 1.2    |
| 脅威検出/ノード比   | 0.5  | 0.3    |
| 評価関数/ノード比   | 0.5  | 0.3    |

**注目点**: 禁手判定/ノード比がまだ高い（9-13）

## 次にやるべきこと（優先度順）

### 優先度1: 禁手判定の内部最適化

- **問題**: 禁手判定1回あたり複数回の判定ロジックが実行される
- **場所**: `src/logic/renjuRules.ts`
- **アプローチ**:
  - `checkDoubleThree()` 内の `isValidThree()` で再帰的に禁手判定が呼ばれる
  - この再帰呼び出しのキャッシュ化を検討
  - `ForbiddenCheckContext` をルートレベルで共有して再利用

### 優先度2: 脅威検出キャッシュ

- **問題**: 同一盤面で複数回脅威検出が行われる
- **場所**: `src/logic/cpu/evaluation/threatDetection.ts`
- **アプローチ**:
  - Zobristハッシュをキーにした脅威検出結果のキャッシュ
  - 禁手キャッシュと同様の方式で実装

### 優先度3: TTヒット率向上

- **現状**: easy 38.7%, medium 20.5%
- **目標**: 50%以上
- **アプローチ**:
  - TTエントリの世代管理を改善
  - Zobristハッシュの衝突率を確認

### 優先度4: VCF/VCT時間制限の動的調整

- **場所**: `src/logic/cpu/search/vcf.ts`, `vct.ts`
- **現状**: 各150ms固定
- **アプローチ**: 探索全体の時間バジェットに応じて動的調整

## 関連ファイル

- `src/logic/renjuRules.ts` - 禁手判定（1016行）
- `src/logic/cpu/search/minimax.ts` - 探索エンジン（1143行）
- `src/logic/cpu/evaluation/index.ts` - 盤面評価（739行）
- `src/logic/cpu/moveGenerator.ts` - 候補手生成（161行）
- `src/logic/cpu/cache/forbiddenCache.ts` - 禁手キャッシュ（131行）
- `src/logic/cpu/profiling/counters.ts` - プロファイリング（77行）

## ベンチマーク実行方法

```bash
# ベンチマーク実行
pnpm bench --players=easy,medium,hard --games=5 --verbose

# 結果分析
./scripts/analyze-bench.sh bench-results/<最新のファイル>.json
```

## コミット履歴

```
c2c9749 perf: 禁手判定にZobristハッシュベースのキャッシュを導入
cf969eb perf: minimaxWithTT探索ループをUndo方式に最適化
32f49d2 perf: 禁手判定の盤面コピーをUndo方式に最適化
f7a76d5 feat: 探索アルゴリズムの詳細プロファイリング追加
```
