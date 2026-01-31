# CPU AI Self-Play レーティングシステム

このドキュメントでは、CPU AI の強さを定量的に評価するための Self-Play レーティングシステムの設計を整理します。

## 目的と期待効果

### 目的

1. **定量的な強さ測定**: パラメータ変更による強さの変化を数値で把握
2. **難易度バランス調整**: 難易度間の強さの差を適切に設定
3. **回帰テスト**: 新機能追加時に既存の強さを維持しているか確認

### 期待効果

- パラメータチューニングの効率化（主観評価 → 客観評価）
- 難易度設計の根拠づけ
- CI/CD でのパフォーマンス監視

## Elo レーティングシステム

### 基本式

```
期待勝率: E_A = 1 / (1 + 10^((R_B - R_A) / 400))
レーティング更新: R'_A = R_A + K * (S_A - E_A)
```

**変数**:

- `R_A`, `R_B`: プレイヤーA, Bのレーティング
- `E_A`: Aの期待勝率
- `S_A`: 実際の結果（勝ち=1, 負け=0, 引き分け=0.5）
- `K`: 更新係数（K-factor）

### パラメータ設定

| パラメータ       | 値     | 理由                                   |
| ---------------- | ------ | -------------------------------------- |
| 初期レーティング | 1500   | 標準的な基準値                         |
| K-factor         | 32     | 少ない対局数で収束させるため高めに設定 |
| 収束判定         | 50対局 | 信頼区間±50程度に収束                  |

### 実装

```typescript
interface EloRating {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

function calculateExpectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function updateRating(
  current: number,
  expected: number,
  actual: number,
  k: number = 32,
): number {
  return current + k * (actual - expected);
}
```

## Self-Play 対戦システム設計

### アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│                 Benchmark CLI                    │
│                 (bench-ai.ts)                    │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────────┐      ┌─────────────┐          │
│  │  Player A   │ vs   │  Player B   │          │
│  │  (config)   │      │  (config)   │          │
│  └──────┬──────┘      └──────┬──────┘          │
│         │                    │                  │
│         └────────┬───────────┘                  │
│                  ▼                              │
│         ┌───────────────┐                       │
│         │  Game Engine  │                       │
│         │  (headless)   │                       │
│         └───────────────┘                       │
│                  │                              │
│                  ▼                              │
│         ┌───────────────┐                       │
│         │ Rating System │                       │
│         └───────────────┘                       │
│                  │                              │
│                  ▼                              │
│         ┌───────────────┐                       │
│         │    Output     │                       │
│         │  (CSV/JSON)   │                       │
│         └───────────────┘                       │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 対戦マトリクス

各難易度の組み合わせで対戦を実施:

|          | beginner | easy | medium | hard |
| -------- | -------- | ---- | ------ | ---- |
| beginner | -        | ✓    | ✓      | ✓    |
| easy     | ✓        | -    | ✓      | ✓    |
| medium   | ✓        | ✓    | -      | ✓    |
| hard     | ✓        | ✓    | ✓      | -    |

**対戦数**: 各組み合わせ 50対局（先手後手各25局）

### 対局実行

```typescript
interface PlayerConfig {
  id: string;
  difficulty: CpuDifficulty;
  // カスタムパラメータ（オーバーライド用）
  customParams?: Partial<DifficultyParams>;
}

interface GameResult {
  playerA: string;
  playerB: string;
  winner: "A" | "B" | "draw";
  moves: number;
  duration: number;
}

async function runGame(
  playerA: PlayerConfig,
  playerB: PlayerConfig,
  firstPlayer: "A" | "B",
): Promise<GameResult> {
  // ヘッドレスでの対局実行
}
```

## ベンチマーク CLI 仕様

### コマンド

```bash
# 全難易度の総当たり戦
pnpm bench:ai

# 特定の難易度間の対戦
pnpm bench:ai --players=medium,hard --games=100

# カスタムパラメータでの対戦
pnpm bench:ai --config=./bench-config.json

# レーティングのみ計算（既存結果から）
pnpm bench:ai --calculate-only --input=./results.json
```

### オプション

| オプション   | 説明                           | デフォルト         |
| ------------ | ------------------------------ | ------------------ |
| `--players`  | 対戦する難易度（カンマ区切り） | 全難易度           |
| `--games`    | 各組み合わせの対局数           | 50                 |
| `--config`   | カスタム設定ファイル           | なし               |
| `--output`   | 出力ファイルパス               | `./bench-results/` |
| `--format`   | 出力フォーマット（csv/json）   | json               |
| `--verbose`  | 詳細ログ出力                   | false              |
| `--parallel` | 並列実行数                     | 1                  |

### 設定ファイル（bench-config.json）

```json
{
  "players": [
    {
      "id": "medium-baseline",
      "difficulty": "medium"
    },
    {
      "id": "medium-lmr",
      "difficulty": "medium",
      "customParams": {
        "enableLMR": true,
        "lmrThreshold": 4
      }
    }
  ],
  "gamesPerPair": 100,
  "outputFormat": "json"
}
```

## 出力フォーマット

### JSON 出力

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "config": {
    "gamesPerPair": 50
  },
  "ratings": {
    "beginner": {
      "rating": 1200,
      "games": 150,
      "wins": 25,
      "losses": 120,
      "draws": 5
    },
    "easy": {
      "rating": 1350,
      "games": 150,
      "wins": 60,
      "losses": 85,
      "draws": 5
    },
    "medium": {
      "rating": 1550,
      "games": 150,
      "wins": 95,
      "losses": 50,
      "draws": 5
    },
    "hard": {
      "rating": 1800,
      "games": 150,
      "wins": 130,
      "losses": 15,
      "draws": 5
    }
  },
  "matchups": [
    {
      "playerA": "beginner",
      "playerB": "easy",
      "winsA": 5,
      "winsB": 45,
      "draws": 0
    }
  ],
  "games": [
    {
      "id": 1,
      "playerA": "beginner",
      "playerB": "easy",
      "firstPlayer": "A",
      "winner": "B",
      "moves": 42,
      "duration": 5230
    }
  ]
}
```

### CSV 出力（ratings.csv）

```csv
player,rating,games,wins,losses,draws,win_rate
beginner,1200,150,25,120,5,16.7
easy,1350,150,60,85,5,40.0
medium,1550,150,95,50,5,63.3
hard,1800,150,130,15,5,86.7
```

### CSV 出力（games.csv）

```csv
id,playerA,playerB,first_player,winner,moves,duration_ms
1,beginner,easy,A,B,42,5230
2,beginner,easy,B,B,38,4890
...
```

## パラメータチューニングワークフロー

### 1. ベースラインの確立

```bash
# 現在のパラメータでレーティングを測定
pnpm bench:ai --output=./bench-results/baseline.json
```

### 2. パラメータ変更のテスト

```bash
# カスタム設定でベンチマーク
pnpm bench:ai --config=./experiments/lmr-test.json \
  --output=./bench-results/lmr-test.json
```

### 3. 結果の比較

```bash
# レーティング差を分析
pnpm bench:ai --compare \
  --baseline=./bench-results/baseline.json \
  --target=./bench-results/lmr-test.json
```

**出力例**:

```
Rating Comparison:
                  Baseline    Target    Diff
medium            1550        1580      +30
hard              1800        1820      +20

Performance:
                  Baseline    Target    Diff
Avg. think time   2100ms      1400ms    -33%
Nodes/second      15000       22000     +47%
```

### 4. 判定基準

| 指標           | 許容範囲 | 意味                 |
| -------------- | -------- | -------------------- |
| レーティング差 | ±20      | 同等の強さ           |
| レーティング差 | +30以上  | 有意な向上           |
| レーティング差 | -30以下  | 有意な低下（要調査） |

## 実装ステップ

### Phase 1: 基盤構築

1. `scripts/bench-ai.ts` スクリプトを作成
2. ヘッドレス対局エンジンを実装
3. Elo レーティング計算を実装
4. JSON/CSV 出力を実装

### Phase 2: CLI インターフェース

1. コマンドライン引数のパース
2. 設定ファイルの読み込み
3. プログレス表示
4. エラーハンドリング

### Phase 3: 分析機能

1. 結果比較コマンド
2. 統計サマリー
3. 可視化（オプション）

## 注意事項

### 再現性

- 乱数シードを固定可能にする
- 同じ設定で複数回実行して分散を確認

### パフォーマンス

- 大量対局時はメモリ使用量に注意
- 進捗を中間保存して中断再開可能に

### 統計的妥当性

- 対局数が少ないとレーティングが不安定
- 最低50対局/組み合わせを推奨

## 参考資料

- [Elo Rating System - Wikipedia](https://en.wikipedia.org/wiki/Elo_rating_system)
- [Elo Rating System empirical parameterization](https://arxiv.org/html/2512.18013v1)
- [AlphaDDA: AlphaZero playing strength adjustment](https://peerj.com/articles/cs-1123/)
- [Adaptive game AI for Gomoku](https://www.researchgate.net/publication/220774432_Adaptive_game_AI_for_Gomoku)

## 関連ファイル

| ファイル                      | 説明                                 |
| ----------------------------- | ------------------------------------ |
| `scripts/bench-ai.ts`         | ベンチマーク CLI（新規）             |
| `src/logic/cpuAI/rating.ts`   | レーティング計算（新規）             |
| `src/logic/cpuAI/headless.ts` | ヘッドレス対局エンジン（新規）       |
| `bench-results/`              | ベンチマーク結果ディレクトリ（新規） |
