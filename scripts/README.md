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
