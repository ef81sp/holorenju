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
| `--fixed-nodes[=<n>]`  | 固定ノード（決定的探索）モード。値なしは N=1,200,000。`-a`/`-b` で片側のみ         | なし（時間） |
| `--verbose`, `-v`      | 詳細ログ出力                                                                       | false        |

## 固定ノード（決定的）モード

`--fixed-nodes` で両側を固定ノード探索（timeLimit=0 / maxNodes=N / 決定的モード）にする。設計と較正は `docs/plans/bench-fixed-nodes-2026-09-06.md`（結論は §7.13）。

- **使い方**: `--fixed-nodes`（既定 N=1,200,000。時間モード hard・jobs=5 と Elo 同等に較正済み）/ `--fixed-nodes=N` / 片側だけなら `--fixed-nodes-a[=N]` または `--fixed-nodes-b[=N]`（時間 vs 固定の混合。較正用）。`--max-nodes-a/b`・`--book-a/b` とは併用不可。randomFactor>0 は `--seed` 必須、`--sets>1` は randomFactor 必須。
- **較正の前提**: 既定 N=1.2M は **jobs=5 の負荷下の hard** と Elo 同等（無負荷の製品 hard は p99 ≈ 2.5M を使うので固定 1.2M より強い）。固定ノードは相対比較専用で、製品強度の絶対値の代理にはしない。
- **検出力**: A≠B のときに狭い CI で符号を当てられるかは陽性対照（`--max-depth-b=5`、設計メモ §4 手順 6）で検証中（§7.14 に追記予定）。
- **決定性**: 同一入力なら棋譜・1 手ごとの nodes・score が完全一致し、マシン負荷に依存しない。そのため `--jobs` を増やしてよい（416 局 jobs=7 で約 1 時間、1,200 局なら約 3 時間）。
- **測れるもの**: eval 品質、枝刈り・ordering の「ノードあたりの質」。eval 品質の PR は固定ノードで判定し、リリース前に時間モードで 1 回確認する。
- **測れないもの（時間モード必須）**: ノード単価を変える変更（eval 機能追加・incremental eval・ordering コスト。固定ノードでは過大評価される）、時間管理（dynamic time / deadline / Time Pressure Fallback）、VCF/VCT の速度改善、`stats.nodes` 計上点や `TimeLimiter.bump` 位置の変更。ノード計上規則が変わる PR（#89 / #136 / 固定ノード導入 PR）を跨ぐ比較も時間モードで行う。NPS は同一モード同士でのみ比較する。
- **`valid:false`**: 結果 JSON の `valid` は固定ノードモードのみ付く。abort（1 手タイムアウト等）が 1 件でもあれば `false` になり非 0 終了する。決定性が崩れているので結果を採用しない（1 手の既定タイムアウトは 600,000 ms）。
- **決定性の確認**: 同じコマンドを 2 回走らせ `pnpm bench:reanalyze --compare a.json b.json` で完全一致を見る。
- **時間モードとの着手比較**: `pnpm compare:modes <混合対局のjson> --limit=20`（`--fixed-nodes-b` で走らせた結果から、時間側と固定側の着手が分かれた局面を列挙。`--verify` で参照評価も出す）。

```
# eval 品質の PR 判定（既定 1.2M、416 局、約 1 時間）
pnpm commit:bench --commitA=development --commitB=HEAD --fixed-nodes --jobs=7 \
  --openings=scripts/data/opening-suite-v1.json --max-games=416

# 時間 vs 固定の較正（A=時間モード、B=固定 N）
pnpm commit:bench --commitA=HEAD --commitB=HEAD --fixed-nodes-b=1200000 --jobs=5 \
  --openings=scripts/data/opening-suite-v1.json --max-games=416
```

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
