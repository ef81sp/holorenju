# スクリプト

## ベンチマーク棋譜分析・問題作成支援ツール

### 概要

ベンチマーク結果の棋譜を分析・タグ付けし、シナリオの問題作成に活用するCLIツール群。

### ワークフロー

```
bench-results/*.json
        ↓
pnpm analyze:games (分析・タグ付け)
        ↓
analyzed-games/analysis-*.json
        ↓
pnpm browse:games --tag=vcf-available (条件検索・ASCII盤面確認)
        ↓
[c]opyコマンド (クリップボードへ)
        ↓
盤面エディタで「📋 読込」
```

### 分析スクリプト

```bash
pnpm analyze:games                    # 全ベンチマーク結果を分析
pnpm analyze:games --latest           # 最新のみ
pnpm analyze:games --verbose          # 詳細ログ
```

### ブラウズスクリプト

```bash
pnpm browse:games                            # 全対局一覧
pnpm browse:games --tag=vcf-available        # タグで絞り込み
pnpm browse:games --tag=open-three           # 活三を作った局面
pnpm browse:games --matchup=hard             # 難易度で絞り込み
pnpm browse:games --moves=20-40              # 手数で絞り込み
pnpm browse:games --winner=black             # 勝者で絞り込み
pnpm browse:games --jushu=花月               # 珠型で絞り込み
pnpm browse:games -i                         # インタラクティブモード
pnpm browse:games -i --game=5 --move=15      # 特定対局・手から開始
```

### インタラクティブモードのコマンド

| コマンド    | 説明                         |
| ----------- | ---------------------------- |
| `n` / Enter | 次の手                       |
| `p`         | 前の手                       |
| `j N`       | N手目へジャンプ              |
| `g N`       | 対局#Nを開く                 |
| `c`         | 現在の盤面をクリップボードへ |
| `l`         | 対局リストに戻る             |
| `f`         | 最初の手へ                   |
| `L`         | 最後の手へ                   |
| `r`         | 棋譜を表示                   |
| `q`         | 終了                         |

### タグの種類（棋譜ベース判定）

#### 四追い系

- `vcf-win`: 四追い勝ち（四→四→...→四三/五連）
- `four-three`: 四三を作った

#### パターン系

- `four`: 四を作った
- `open-three`: 活三を作った

#### 勝敗系

- `winning-move`: 五連で勝った手

#### 禁手系

- `double-three`: 三々を打った
- `double-four`: 四々を打った
- `overline`: 長連を打った
- `forbidden-loss`: 禁手で負けた
- `forbidden-trap`: 禁手追い込み（白）

#### 開局系

- `opening-move`: 開局手（1-3手目）
- `jushu:花月`: 珠型名
- `diagonal`: 直打ち
- `orthogonal`: 間打ち

### ファイル構成

```
scripts/
├── analyze-games.ts       # 分析スクリプト
├── browse-games.ts        # ブラウズスクリプト
├── types/
│   └── analysis.ts        # 型定義
└── lib/
    ├── gameAnalyzer.ts    # 分析ロジック
    ├── boardDisplay.ts    # ASCII盤面表示
    └── clipboardUtils.ts  # クリップボード

analyzed-games/            # 分析結果出力先
└── analysis-*.json
```

---

## ベンチマーク CLI

### 概要

CPU AI同士の対局を実行し、レーティングや統計を測定する。

### CLI

```bash
pnpm bench                                         # 全難易度総当たり
pnpm bench --players=medium,hard --games=20        # 特定難易度
pnpm bench --self --players=hard --games=100       # hard vs hard (self-play)
pnpm bench --parallel --workers=4                  # 並列実行
pnpm bench --score-override=LEAF_COMPOUND_THREAT_BONUS:0  # スコア定数を上書き
```

### `--score-override` オプション

`PATTERN_SCORES` の値を上書きしてベンチマークを実行する。A/Bテストやパラメータ調整の効果検証に使用。

```bash
# 単一パラメータ
pnpm bench --score-override=LEAF_COMPOUND_THREAT_BONUS:0

# 複数パラメータ（カンマ区切り）
pnpm bench --score-override=FOUR:2000,OPEN_THREE:1200

# self-play A/Bテストの例
pnpm bench --self --players=hard --games=100 --score-override=LEAF_COMPOUND_THREAT_BONUS:0
pnpm bench --self --players=hard --games=100  # デフォルト値で比較
```

並列実行時もワーカーに自動で反映される。

### 出力

```
bench-results/bench-<timestamp>.json
```

---

## 弱点パターン分析ツール

### 概要

hard同士の対戦結果から弱点パターン（blunder、missed-VCF、advantage-squandered等）を自動検出する。

### CLI

```bash
pnpm analyze:weakness                          # 最新ベンチ結果を分析
pnpm analyze:weakness --file=<bench.json>      # 指定ファイル
pnpm analyze:weakness --run --games=20         # 対局してから分析
pnpm analyze:weakness --parallel               # 並列対局
pnpm analyze:weakness --verbose                # 詳細ログ
```

### 検出する弱点パターン

| 弱点タイプ              | 検出方法                                                 |
| ----------------------- | -------------------------------------------------------- |
| blunder                 | 前手との評価スコア差 >= 2000                             |
| missed-vcf              | 負けた側の局面で `findVCFMove` を再実行し未検出VCFを発見 |
| advantage-squandered    | スコア +3000以上 → 最終的に負け                          |
| depth-disagreement      | 深度間の最善手が不一致                                   |
| forbidden-vulnerability | 禁手負けゲームで禁手追い込みが成立した局面を特定         |
| time-pressure-error     | `interrupted=true` かつ前深度の最善手より悪い手を選択    |

### 出力

```
weakness-reports/weakness-<timestamp>.json
```

### ファイル構成

```
scripts/
├── analyze-weakness.ts        # CLI エントリポイント
├── types/
│   └── weakness.ts            # 型定義
└── lib/
    └── weaknessAnalyzer.ts    # 分析ロジック

weakness-reports/              # 分析結果出力先
└── weakness-*.json
```

---

## A/B ベンチマーク比較ツール

### 概要

パラメータ変更の効果を統計的に検証する。baseline vs candidate のElo差推定とSPRT（Sequential Probability Ratio Test）判定を提供。

### CLI

```bash
pnpm ab:bench --candidate="depth:5,timeLimit:10000"
pnpm ab:bench --candidate-file=params/candidate.json
pnpm ab:bench --games=200 --parallel
pnpm ab:bench --sprt --elo0=0 --elo1=30
```

### 出力

```
ab-results/ab-<timestamp>.json
```

### ファイル構成

```
scripts/
├── ab-bench.ts            # CLI エントリポイント
├── types/
│   └── ab.ts              # 型定義
└── lib/
    ├── eloDiff.ts         # Elo差推定 + 信頼区間
    └── sprt.ts            # SPRT 実装

ab-results/                # 比較結果出力先
└── ab-*.json
```

---

## コミット間CPU強度比較ベンチマーク（commit-bench）

### 概要

2つのgit commit（worktree）のCPU実装同士を対戦させ、強度の変化をElo差・SPRTで検証する。
`--jobs=N` で複数対局を並列消化できる（1局≈1コア）。

### CLI

```bash
pnpm commit:bench --commitA=HEAD~1 --commitB=HEAD --sets=1
pnpm commit:bench --commitA=abc1234 --commitB=def5678 --sprt --elo0=0 --elo1=30
pnpm commit:bench --sets=8 --randomFactor=0.02 --jobs=6   # r0.02 8セット基準（416局）
```

### `--eval-options-a` / `--eval-options-b`（Gate 2: 評価基底の対決）

A/B 側それぞれに `EvaluationOptions` の部分オブジェクトを JSON で注入できる
（`evalBasis` のような string enum も渡せる。`--eval-option`（ab-bench 側）は
boolean/number 専用のためこちらとは別系統）。commitA と commitB に同一コミットを
指定すれば、同一 worktree 内で基底違いのみを比較できる:

```bash
# 同一コミットで evalBasis=prospect(A) vs legacy(B) を対決
pnpm commit:bench --commitA=HEAD --commitB=HEAD --sets=8 --randomFactor=0.02 \
  --eval-options-a='{"evalBasis":"prospect"}'
```

省略時（未指定）は従来どおり legacy 同士で挙動不変。実行ログに各ワーカーの
`evalBasis` / `evalFlags`（エンコード済み数値）/ `bit18`（prospect 判定）が
1行出力されるため、silent に legacy vs legacy を測ってしまう事故を目視で防げる。

### 出力

```
bench-results/commit-bench-<timestamp>.json
```

### ファイル構成

```
scripts/
├── commit-bench.ts            # CLI エントリポイント
├── cpu-bridge-worker.ts       # worktree の CPU 実装を動的 import する bridge worker
├── commit-game-runner.ts      # 2 worker 間の対局コーディネーター
├── types/
│   └── commit-bench.ts        # CommitInfo, CommitBenchResult 型定義
└── lib/
    ├── match.ts                    # 珠型タスク生成 / bridge worker 生成 / 対局ループ（commit-bench・weight-bench共有）
    ├── difficultyParamsMerge.ts    # customParams のマージ規則（SSoT）
    └── wasmEvalOptionsEncoder.ts   # EvaluationOptions → WASM findBestMove 用ビットマスク

bench-results/                 # 比較結果出力先
└── commit-bench-*.json
```

---

## SPSA パラメータチューニングツール

### 概要

PATTERN_SCORES のパラメータを SPSA（Simultaneous Perturbation Stochastic Approximation）で自動最適化する。Stockfish の Fishtest と同じ原理。

### CLI

```bash
pnpm tune:params                                    # デフォルトパラメータセット
pnpm tune:params --params-file=params/tunables.json # カスタム
pnpm tune:params --iterations=100 --games=40        # SPSA設定
pnpm tune:params --resume=tune-results/tune-*.json  # チェックポイントから再開
```

### パラメータ定義

`params/default-tunables.json` にチューニング対象パラメータを定義。各パラメータに初期値・範囲・ステップサイズを指定。

### 出力

```
tune-results/tune-<timestamp>.json
```

### ファイル構成

```
scripts/
├── tune-params.ts         # CLI エントリポイント
├── types/
│   └── tune.ts            # 型定義
└── lib/
    └── spsa.ts            # SPSA 実装

params/
└── default-tunables.json  # デフォルトチューニングパラメータ

tune-results/              # チューニング結果出力先
└── tune-*.json
```
