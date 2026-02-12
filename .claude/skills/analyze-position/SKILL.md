---
name: analyze-position
description: 棋譜から局面の脅威（VCF/VCT/ミセ四追い/活三/四）を分析
allowed-tools:
  - Bash(pnpm analyze:position:*)
---

# 局面脅威分析

## 概要

棋譜文字列を受け取り、局面の脅威（VCF/VCT/Mise-VCF/活三/四）を分析するCLIツール。
デバッグや探索結果の検証に使用する。

## コマンド例

```bash
pnpm analyze:position "H8 G7 I9 I7 J8 K7"                     # 基本分析
pnpm analyze:position "H8 G7 I9 I7 J8 K7" --move=4             # 4手目まで
pnpm analyze:position "H8 G7 I9 I7 J8 K7" --color=black        # 黒の脅威のみ
pnpm analyze:position "H8 G7 I9 I7 J8 K7" --deep               # 深い探索
pnpm analyze:position "H8 G7 I9 I7 J8 K7" --move=4 --deep      # 組み合わせ
```

## オプション

| オプション      | 説明                                        | デフォルト                             |
| --------------- | ------------------------------------------- | -------------------------------------- |
| `--move=N`      | N手目まで再現して分析                       | 全手                                   |
| `--color=black` | 黒の脅威のみ分析                            | 両方                                   |
| `--color=white` | 白の脅威のみ分析                            | 両方                                   |
| `--deep`        | 深い探索（VCF: depth16/5s, VCT: depth6/5s） | 通常（VCF: depth8/1s, VCT: depth4/1s） |

## 出力内容

各色について以下を表示:

| 項目           | 説明                                                        |
| -------------- | ----------------------------------------------------------- |
| 活三           | 活三（3連+両端空き）の有無                                  |
| 四が作れる位置 | 四を作れる位置の一覧と数                                    |
| VCF            | 四追い勝ち（手数・手順・禁手追い込みフラグ）                |
| Mise-VCF       | ミセ四追い（ミセ手・手順）                                  |
| VCT            | 脅威連続勝ち（手数・手順・禁手追い込みフラグ/スキップ理由） |

VCTは石数が閾値未満の場合や相手に活三がある場合にスキップされ、理由が表示される。

## 出力例

```
========================================
 局面脅威分析
========================================
手数: 6  次の手番: 白  石数: 6

   A B C D E F G H I J K L M N O
15 . . . . . . . . . . . . . . . 15
14 . . . . . . . . . . . . . . . 14
...
 1 . . . . . . . . . . . . . . .  1
   A B C D E F G H I J K L M N O

--- 白番の分析 ---
  活三: なし
  四が作れる位置: なし
  VCF: なし
  Mise-VCF: なし
  VCT: スキップ (石数6 < 閾値10)

--- 黒番の分析 ---
  活三: あり
  四が作れる位置: H6, J10 (2箇所)
  VCF: あり (5手) [禁手追い込み]
    手順: H6 G6 J10 K11 I8
  Mise-VCF: なし
  VCT: あり (3手)
    手順: F9 E10 G10
```

## 使い方

ユーザーの意図に応じて適切なオプションを組み合わせて実行する。

1. ユーザーが分析したい局面の棋譜を確認する
2. 必要に応じて `--move=N` で特定手数まで、`--color` で特定色に絞る
3. 通常探索で不十分な場合は `--deep` で深い探索を行う

## 関連ファイル

| ファイル                          | 役割                        |
| --------------------------------- | --------------------------- |
| `scripts/analyze-position.ts`     | 脅威分析CLI                 |
| `scripts/lib/positionLoader.ts`   | 棋譜→局面データのローダー   |
| `scripts/lib/boardDisplay.ts`     | ASCII盤面表示               |
| `src/logic/cpu/search/vcf.ts`     | VCF探索                     |
| `src/logic/cpu/search/vct.ts`     | VCT探索（hasOpenThree含む） |
| `src/logic/cpu/search/miseVcf.ts` | ミセ四追い探索              |
