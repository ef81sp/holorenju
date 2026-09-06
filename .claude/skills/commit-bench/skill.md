---
name: commit-bench
description: ブランチ/コミット間のCPU強度比較ベンチマーク
allowed-tools:
  - Bash(pnpm commit:bench:*)
  - Bash(ls:*)
  - Bash(tail:*)
---

# コミット間ベンチマーク

## 概要

異なるブランチやコミット間でCPU AIの強度を比較する。

## 使用方法

```
/commit-bench main vs impl                   # ブランチ間比較（1セット=52局 hard）
/commit-bench --commitA=main --commitB=HEAD   # コミット指定
/commit-bench --commitA=abc1234 --commitB=def5678 --sets=4 --sprt
/commit-bench --commitA=main --commitB=HEAD --openings=scripts/data/opening-suite-v1.json   # 推奨（開局スイート）
```

**推奨構成（2026-09-04〜）**: `--openings=scripts/data/opening-suite-v1.json`（600 開局 × 2 色 = 1,200 局、hard で約 6 時間、ペア Elo の半値幅 ±15）。randomFactor は不要。短縮版は `--max-games=416`（約 2 時間、±25）。決着済み局面を除いた `opening-suite-v2.json`（382 開局・764 局）もある。珠型 8 セット + randomFactor 0.02 の旧構成は棋譜が半分重複し信頼区間が過大なので使わない（`docs/plans/bench-precision-2026-09-04.md`）。

ユーザーが「mainとimplで対戦」「ブランチ間比較」等の表現を使った場合はこのスキル。

## CLI オプション

| オプション             | 説明                                                                               | デフォルト   |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------ |
| `--commitA=<ref>`      | 比較元（git ref/sha）                                                              | `HEAD~1`     |
| `--commitB=<ref>`      | 比較先（git ref/sha）                                                              | `HEAD`       |
| `--sets=<n>`           | セット数（1セット = 26珠型 × 2色 = 52局）                                          | `1`          |
| `--difficulty=<d>`     | 難易度                                                                             | `hard`       |
| `--sprt`               | SPRT早期停止を有効化                                                               | 無効         |
| `--elo0=<n>`           | SPRT帰無仮説Elo差                                                                  | `0`          |
| `--elo1=<n>`           | SPRT対立仮説Elo差                                                                  | `30`         |
| `--randomFactor=<n>`   | 探索にゆらぎを加える (0〜1)                                                        | なし         |
| `--openings=<file>`    | 開局スイート JSON（推奨: `scripts/data/opening-suite-v1.json`）。`--sets` は周回数 | なし（珠型） |
| `--opening-offset=<n>` | スイートの n 番目から使う（再現性確認用）                                          | `0`          |
| `--max-games=<n>`      | 先頭 N 局に切り詰め（ペア境界）                                                    | `0`（無効）  |
| `--jobs=<n>`           | 同時対局数（8 コアなら 5）                                                         | `1`          |
| `--verbose`, `-v`      | 詳細ログ出力                                                                       | false        |

## 出力

```
bench-results/commit-bench-<timestamp>.json
```

## 実行手順

1. ユーザーの引数からブランチ/コミットを特定
2. `pnpm commit:bench` をバックグラウンドで実行
3. 完了したら結果ファイルのパスとWDL・Elo差を報告
4. 要求があれば `/analyze-bench` や `/analyze-weakness` も実行

## 仕組み

1. 各コミットの git worktree を `.git/worktrees-bench/` に作成
2. worktree ごとに `pnpm install --frozen-lockfile --ignore-scripts` を実行
3. bridge worker 経由で各 worktree の CPU を動的 import
4. 先後を交互に入れ替えて N 局対戦
5. WDL（勝敗分）とElo差（95%信頼区間付き）を算出。**採否判定はペア統計（pentanomial）の Elo/CI/SPRT** を使う（三項は参考）。旧 JSON の再集計は `pnpm bench:reanalyze <json>`
6. 結果を JSON に保存、worktree をクリーンアップ

## 注意事項

- デフォルト1セット（52局）のhard対戦は5-15分程度かかるため、バックグラウンド実行を推奨
- worktree 作成＋依存インストールで初回起動に時間がかかる
- 進捗は tail でログを確認可能
- Ctrl+C で中断しても worktree はクリーンアップされる
