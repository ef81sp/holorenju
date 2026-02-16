---
name: cpu-architecture
description: CPUアルゴリズムのアーキテクチャを調査する際のクイックリファレンス
---

# CPUアーキテクチャ リファレンス

CPUアルゴリズムに関する調査・修正・機能追加の際に参照する。

## ファイル構成

```
src/logic/cpu/
├── cpu.worker.ts           # ブラウザ用Web Worker（エントリポイント）
├── review.worker.ts        # 振り返り評価用Worker
├── opening.ts              # 開局（珠型）ロジック（3手まで）
├── moveGenerator.ts        # 候補手生成（既存石の周囲2マス）
├── moveOrdering.ts         # Move Ordering（TT手→Killer→History→静的評価）
├── zobrist.ts              # Zobristハッシュ（BigInt 64bit XOR）
├── transpositionTable.ts   # TT（Map<bigint, TTEntry>、200万件上限）
│
├── search/
│   ├── iterativeDeepening.ts # 反復深化 + 事前チェックパイプライン
│   ├── minimaxCore.ts        # Minimax + Alpha-Beta（TT/NMP/LMR/Futility統合）
│   ├── minimaxSimple.ts      # TT無し簡易版（テスト用）
│   ├── context.ts            # 探索コンテキスト（時間・ノード管理）
│   ├── results.ts            # 結果集約・Time-Pressure Fallback
│   ├── techniques.ts         # LMR・NMP・Futility・Aspiration定数
│   ├── vcf.ts                # VCF探索（四追い勝ち、最大8手、150ms）
│   ├── vct.ts                # VCT探索（三四連続勝ち、最大4手、150ms）
│   ├── miseVcf.ts            # Mise-VCF探索（ミセ→VCF複合）
│   ├── threatMoves.ts        # 脅威手検出（四・活三を作る手）
│   └── pvValidation.ts       # PV（最善手列）検証
│
├── evaluation/
│   ├── patternScores.ts      # スコア定数・評価オプション（SSoT）
│   ├── positionEvaluation.ts # 位置評価（候補手のスコア計算）
│   ├── boardEvaluation.ts    # 盤面全体評価（探索末端用）
│   ├── stonePatterns.ts      # 石のパターン解析（連・端の判定）
│   ├── directionAnalysis.ts  # 方向別脅威分析・防御倍率
│   ├── threatDetection.ts    # 脅威検出（活四・活三・ミセ手）
│   ├── forbiddenTactics.ts   # 禁手追い込み戦術（白番専用）
│   ├── jumpPatterns.ts       # 跳びパターン検出（跳び三・跳び四）
│   ├── miseTactics.ts        # ミセ手戦術
│   ├── tactics.ts            # 複合戦術（四三判定等）
│   └── followUpThreats.ts    # 後続脅威分析（単発四ペナルティ用）
│
├── core/
│   ├── constants.ts          # 定数（方向ベクトルなど）
│   ├── boardUtils.ts         # 盤面操作ユーティリティ
│   └── lineAnalysis.ts       # ライン解析（連の端を調べる）
│
├── cache/
│   └── forbiddenCache.ts     # 禁手判定キャッシュ
│
├── profiling/
│   └── counters.ts           # 探索統計カウンター
│
└── benchmark/
    ├── gameRunner.ts          # ヘッドレス対局エンジン
    ├── rating.ts              # ELOレーティング計算
    ├── statistics.ts          # 統計ユーティリティ
    └── README.md              # ベンチマーク使用ガイド
```

## Worker構成

### ブラウザ

| Worker             | 管理 composable         | 用途                                      |
| ------------------ | ----------------------- | ----------------------------------------- |
| `cpu.worker.ts`    | `useCpuPlayer.ts`       | CPU思考（1つ、Vite `?worker` インポート） |
| `review.worker.ts` | `useReviewEvaluator.ts` | 振り返り評価プール（2-8個、コア数依存）   |

- `useCpuPlayer.ts`: Worker生成→1リクエスト/1レスポンス→unmount時terminate
- `useReviewEvaluator.ts`: Workerプール + タスクキュー方式

### ベンチマーク

| ファイル                  | 実行方式                                     |
| ------------------------- | -------------------------------------------- |
| `scripts/bench-ai.ts`     | CLI。直列 or `--parallel` で並列             |
| `scripts/game-worker.ts`  | Node.js `worker_threads`（Web Worker不使用） |
| `benchmark/gameRunner.ts` | `findBestMoveIterativeWithTT()` 直接呼び出し |

ベンチは `cpu.worker.ts` を経由せず、探索関数を直接呼び出す。

## 探索フロー

```
findBestMoveIterativeWithTT()  [iterativeDeepening.ts]
  │
  ├─ 事前チェック (findPreSearchMove)
  │   ├─ 緊急タイムアウト
  │   ├─ 即勝ち: findWinningMove()
  │   ├─ 必須防御: checkMustDefend() ← detectOpponentThreats()
  │   ├─ VCF: findVCFSequence()
  │   ├─ Mise-VCF: findMiseVCFMove()
  │   ├─ VCT: findVCTMove()（ヒントとしてminimax検証に委ねる）
  │   └─ 候補手制限（VCF防御、活三防御）
  │
  ├─ 動的時間配分: calculateDynamicTimeLimit()
  │
  └─ Iterative Deepening ループ (depth 1..maxDepth)
      ├─ Aspiration Windows（前回スコア ± 75）
      └─ minimaxWithTT()  [minimaxCore.ts]
          ├─ TTプローブ
          ├─ Null Move Pruning (depth≥3)
          ├─ 候補手ソート: generateSortedMoves()
          ├─ Alpha-Beta ループ
          │   ├─ LMR (depth≥3, 4手目以降)
          │   └─ Futility Pruning (末端)
          └─ TT保存
```

## 評価関数

### 候補手評価 (`positionEvaluation.ts: evaluatePosition`)

仮想的に石を置いて攻撃/防御/ボーナスを計算。Move Ordering と事前チェックで使用。

### 盤面全体評価 (`boardEvaluation.ts: evaluateBoard`)

全石のパターンをスキャンして集計。探索末端（depth=0）で使用。

### 主要スコア定数 (`patternScores.ts`)

| パターン           | スコア  |
| ------------------ | ------- |
| FIVE               | 100,000 |
| OPEN_FOUR          | 10,000  |
| FOUR_THREE_BONUS   | 5,000   |
| FOUR               | 1,500   |
| OPEN_THREE         | 1,000   |
| MISE_BONUS         | 1,000   |
| MULTI_THREAT_BONUS | 500     |
| OPEN_TWO           | 50      |
| THREE              | 30      |

## 難易度パラメータ

定義: `src/types/cpu.ts` の `DIFFICULTY_PARAMS`

| 難易度   | 深度 | 時間 | ノード | ランダム | VCT | NMP | Futility |
| -------- | ---- | ---- | ------ | -------- | --- | --- | -------- |
| beginner | 1    | 1s   | 10K    | 80%      | -   | -   | -        |
| easy     | 2    | 2s   | 50K    | 25%      | -   | -   | -        |
| medium   | 3    | 4s   | 200K   | 10%      | yes | -   | yes      |
| hard     | 4    | 8s   | 600K   | 0%       | yes | yes | yes      |

## 既知の改善計画

`docs/cpu-flow-review-plan.md` に6フェーズの改善計画あり:

- F-1: VCT攻撃がメインフローに未統合
- R-1: detectOpponentThreats の二重呼び出し
- R-3: findPreSearchMove の7責務混在

`docs/cpu-performance-strategy.md` に性能向上戦略あり:

- ポンダリング（Worker永続化→投機探索）
- 開局ブック拡張
- 並列探索（Lazy SMP、長期オプション）

## 関連ドキュメント

| ファイル                           | 内容                              |
| ---------------------------------- | --------------------------------- |
| `docs/cpu-algorithm.md`            | CPUアルゴリズム初心者向け解説     |
| `docs/cpu-ai-algorithm.md`         | 詳細なアルゴリズム解説            |
| `docs/cpu-flow-review-plan.md`     | 処理フロー見直し計画（6フェーズ） |
| `docs/cpu-performance-strategy.md` | 性能向上戦略（ポンダリング等）    |
| `docs/leaf-eval-gap-analysis.md`   | 末端評価ギャップ分析              |
