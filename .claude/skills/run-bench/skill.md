---
name: run-bench
description: ベンチマーク対局を実行
allowed-tools:
  - Bash(pnpm bench:*)
  - Bash(ls:*)
  - Bash(tail:*)
---

# ベンチマーク実行スキル

## 概要

CPU AI同士のベンチマーク対局を実行する。

## 前提知識

実行前に以下のREADMEを読んで最新の使い方を確認すること:

- `src/logic/cpu/benchmark/README.md` — ベンチマークの使い方・パラメータ
- `scripts/README.md` の「ベンチマーク CLI」セクション — CLI オプション詳細

## 使用方法

```
/run-bench                                    # デフォルト（全難易度50局）
/run-bench --games=100 --workers=2            # 100局、2ワーカー
/run-bench --self --players=hard --games=100  # hard vs hard 100局
/run-bench <任意のオプション>                  # 引数をそのまま pnpm bench に渡す
```

## 実行手順

1. `src/logic/cpu/benchmark/README.md` と `scripts/README.md` を読んで最新のCLIオプションを確認
2. ユーザーの引数を `pnpm bench` に渡して実行（バックグラウンド推奨）
3. 完了したら結果ファイルのパスを報告
4. ユーザーが `/analyze-bench` や `/analyze-weakness` を要求していれば、それらのスキルも実行

## CLI オプション（クイックリファレンス）

| オプション              | 説明                                | デフォルト      |
| ----------------------- | ----------------------------------- | --------------- |
| `--players=<list>`      | 対戦する難易度（カンマ区切り）      | 全難易度        |
| `--games=<n>`           | 各組み合わせの対局数                | 50              |
| `--workers=<n>`         | ワーカー数（--parallel 暗黙）       | CPUコア数-1     |
| `--parallel`, `-p`      | 並列実行                            | false           |
| `--self`, `-s`          | セルフプレイのみ                    | false           |
| `--output=<dir>`        | 結果出力ディレクトリ                | `bench-results` |
| `--format=<fmt>`        | 出力形式（json/csv）                | json            |
| `--verbose`, `-v`       | 詳細ログ出力                        | false           |
| `--score-override=<kv>` | PATTERN_SCORES上書き（A/Bテスト用） | なし            |

## 出力

```
bench-results/bench-<timestamp>.json
```

## 注意事項

- 100局のhard対戦は10-30分程度かかるため、バックグラウンド実行を推奨
- 進捗は tail でログを確認可能
- 完了後は結果ファイルのパスを必ず報告する
