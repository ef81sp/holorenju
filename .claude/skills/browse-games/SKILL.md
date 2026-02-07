---
name: browse-games
description: ベンチマーク棋譜をブラウズ・検索
allowed-tools:
  - Bash(pnpm browse:games:*)
---

# ベンチマーク棋譜ブラウズ

## 概要

ベンチマーク対局の棋譜を条件検索し、ASCII盤面で確認するCLIツール。
問題作成ワークフローの中間ステップとして機能する。

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

## コマンド例

```bash
pnpm browse:games                            # 全対局一覧
pnpm browse:games --tag=vcf-available        # タグで絞り込み
pnpm browse:games --tag=open-three           # 活三を作った局面
pnpm browse:games --matchup=hard             # 難易度で絞り込み
pnpm browse:games --moves=20-40             # 手数で絞り込み
pnpm browse:games --winner=black             # 勝者で絞り込み
pnpm browse:games --jushu=花月              # 珠型で絞り込み
pnpm browse:games -i                         # インタラクティブモード
pnpm browse:games -i --game=5 --move=15      # 特定対局・手から開始
```

## タグ一覧

### 禁手系

| タグ             | 説明               |
| ---------------- | ------------------ |
| `double-three`   | 三々を打った       |
| `double-four`    | 四々を打った       |
| `overline`       | 長連を打った       |
| `forbidden-loss` | 禁手で負けた       |
| `forbidden-trap` | 禁手追い込み（白） |

### 四追い系

| タグ         | 説明                              |
| ------------ | --------------------------------- |
| `vcf-win`    | 四追い勝ち（四→四→...→四三/五連） |
| `four-three` | 四三を作った                      |

### パターン系

| タグ         | 説明         |
| ------------ | ------------ |
| `four`       | 四を作った   |
| `open-three` | 活三を作った |

### 勝敗系

| タグ           | 説明           |
| -------------- | -------------- |
| `winning-move` | 五連で勝った手 |

### 開局系

| タグ           | 説明              |
| -------------- | ----------------- |
| `opening-move` | 開局手（1-3手目） |
| `jushu:花月`   | 珠型名            |
| `diagonal`     | 直打ち            |
| `orthogonal`   | 間打ち            |

## インタラクティブモード

`-i` フラグで起動。盤面を手順ごとに確認できる。

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

## 使い方

ユーザーの意図に応じて適切なフィルタを組み合わせて `pnpm browse:games` を実行する。

1. ユーザーが探している棋譜の条件を確認する（タグ、難易度、手数、勝者、珠型など）
2. 条件に合うフィルタオプションを組み合わせてコマンドを実行する
3. 結果の対局リストをユーザーに提示する
4. 必要に応じて `--game=N` で特定対局の詳細を表示する

インタラクティブモード（`-i`）はターミナル入力が必要なため、Claudeが直接操作するのではなく、ユーザーにコマンドを案内する。非インタラクティブモードのリスト表示は直接実行して結果を返せる。
