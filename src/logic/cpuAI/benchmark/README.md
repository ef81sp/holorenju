# CPU AI ベンチマーク

CPU AI の強さを定量的に評価するための Self-Play レーティングシステム。

## 使用方法

```bash
# 全難易度総当たり（各50対局、デフォルト）
pnpm bench:ai

# 特定難易度のみ
pnpm bench:ai --players=medium,hard

# 対局数を指定
pnpm bench:ai --games=100

# 詳細ログ出力
pnpm bench:ai --verbose

# CSV形式で出力
pnpm bench:ai --format=csv

# 組み合わせ例
pnpm bench:ai --players=easy,medium,hard --games=20 --verbose
```

### CLI オプション

| オプション         | 説明                           | デフォルト      |
| ------------------ | ------------------------------ | --------------- |
| `--players=<list>` | 対戦する難易度（カンマ区切り） | 全難易度        |
| `--games=<n>`      | 各組み合わせの対局数           | 50              |
| `--output=<dir>`   | 結果出力ディレクトリ           | `bench-results` |
| `--format=<fmt>`   | 出力形式（json/csv）           | json            |
| `--verbose`, `-v`  | 詳細ログ出力                   | false           |

### 出力例

```
=== Final Ratings ===
1. hard: 1620 (35W-12L-3D, 70.0%)
2. medium: 1540 (28W-20L-2D, 56.0%)
3. easy: 1450 (18W-30L-2D, 36.0%)
4. beginner: 1390 (9W-38L-3D, 18.0%)
```

## 使用方針

### いつ実行するか

1. **難易度パラメータ変更後**: `DIFFICULTY_PARAMS` を調整した後
2. **評価関数改善後**: パターン認識やスコアリングを変更した後
3. **探索アルゴリズム変更後**: minimax や枝刈りを修正した後
4. **定期的なリグレッションテスト**: 大きな変更前後で比較

### 結果の解釈

- **レーティング差 100**: 約 64% の勝率差
- **レーティング差 200**: 約 76% の勝率差
- **レーティング差 400**: 約 91% の勝率差

期待されるレーティング分布:

- 各難易度間で **200-400** 程度の差が望ましい
- 差が小さすぎる → 難易度の差別化が不十分
- 差が大きすぎる → 中間難易度が必要かもしれない

## 調整方法

### 難易度パラメータ (`src/types/cpu.ts`)

```typescript
export const DIFFICULTY_PARAMS: Record<CpuDifficulty, DifficultyParams> = {
  beginner: {
    depth: 2, // 探索深度（増やすと強くなる）
    timeLimit: 1000, // 思考時間制限（ms）
    randomFactor: 0.3, // ランダム性（0で決定論的）
    evaluationOptions: {
      enableFukumi: false, // VCF評価
      enableMise: false, // ミセ手評価
      enableForbiddenTrap: false, // 禁手追い込み
      enableMultiThreat: false, // 複数方向脅威
      enableCounterFour: false, // カウンターフォー
      enableVCT: false, // VCT探索
    },
  },
  // ...
};
```

### 調整の指針

| パラメータ          | 効果       | 調整方法                 |
| ------------------- | ---------- | ------------------------ |
| `depth`             | 読みの深さ | +1 で大幅に強化          |
| `timeLimit`         | 探索時間   | 反復深化の到達深度に影響 |
| `randomFactor`      | ばらつき   | 0.1-0.3 で自然な揺らぎ   |
| `enableVCT`         | 必勝読み   | 最も計算コストが高い     |
| `enableMultiThreat` | 複合攻撃   | 中程度のコスト           |

### 調整ワークフロー

1. パラメータを変更
2. `pnpm bench:ai --players=<変更した難易度>,<隣接難易度> --games=50` で確認
3. レーティング差が適切か確認
4. 必要に応じて微調整

## モジュール構成

```
benchmark/
├── rating.ts    # Elo レーティング計算
├── headless.ts  # ヘッドレス対局エンジン
├── index.ts     # 公開API
└── README.md    # このファイル
```

### プログラムからの使用

```typescript
import {
  runHeadlessGame,
  runMultipleGames,
  calculateStats,
  createInitialRating,
  updateRatings,
} from "@/logic/cpuAI/benchmark";

// 単一対局
const result = runHeadlessGame(
  { id: "player1", difficulty: "medium" },
  { id: "player2", difficulty: "hard" },
  { verbose: true },
);

// 複数対局
const results = runMultipleGames(playerA, playerB, 10);
const stats = calculateStats(results);
```
