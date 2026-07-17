# Gate 0 測定結果（空点プロスペクト基底）

プラン: `eval-basis-prospect-2026-07-13.md` §5 Gate 0。
測定日: 2026-07-13〜2026-07-15。ツール: `scripts/gate0-bench.ts`。

**判定: PASS（ホットパス分類のテーブル参照化の修正後）。**
初回測定は FAIL（NPS 比 54.9%）だったが、プロファイルで特定した分類コストを
修正した結果、NPS 比 112〜124% で prospect が legacy を上回った。
re-search 系（lmr/aspiration）の爆発なし。→ P3（Texel 回帰）へ進んで良い。

## 判定基準

NPS(prospect, probe-off) ≥ NPS(legacy, probe-off) × 0.8（−20% 以内）。
probe-on は参考記録（probe 込み NPS は eval 退行を隠すため判定に使わない）。

注（プラン §5 (b) との差異）: プランの「固定ノード数での time-to-depth」は、
実装では「固定深度（+ MAX_NODES 上限）で同一局面・同一到達深度（avgDepth
4.96/4.97）における avgTimeMs 比較」に置き換えた。同一局面で同じ深度に到達する
までの時間を測っており実質等価（レビュー指摘を受けて明記）。

## 測定方法の変遷（重要）

1. **自己対局モード（初回、2026-07-13）**: 構成ごとに自分の手で対局するため、
   構成間で局面セットが異なる（eval が違えば棋譜も違う）交絡があった。
   - depth=3 games=1: 161%（PASS）— ただし浅い探索は 1 手あたりの固定
     オーバーヘッドが支配的で NPS 比較として無意味と判明。
   - depth=5 games=1: 37.4%（FAIL）。
2. **fixed-positions モード（`--fixed`、2026-07-15 追加）**: legacy probe-off の
   自己対局で局面列（4開局×約20手=70局面）を収集し、全構成で**同一局面集合**を
   findBestMove する。per-node コスト比較はこちらが正。

## 結果1: 修正前（コミット 9b95ecb 時点、fixed・depth=5・70局面）

| 構成               | NPS     | avgDepth | avgTimeMs | lmr再探索率 | asp再探索/手 | qSearch比 |
| ------------------ | ------- | -------- | --------- | ----------- | ------------ | --------- |
| legacy probe-off   | 126,808 | 4.96     | 337.3     | 8.23%       | 9.79         | 51.8%     |
| prospect probe-off | 69,586  | 4.97     | 511.5     | 3.23%       | 9.44         | 47.8%     |

**NPS 比 54.9% → FAIL**（per-node コスト約1.8倍）。

re-search 系は爆発なし（lmr 再探索率はむしろ低下、aspiration も同水準）。
「ordering×葉の地形不一致」の実害は観測されず、遅化は純粋に eval 更新コスト。

## 原因分析（CPU プロファイル、--cpu-prof）

prospect 構成（self-play depth=5）の関数別 self time:

| 関数                                   | CPU比率 | 備考                 |
| -------------------------------------- | ------- | -------------------- |
| line_lookup.detectJumpFourShape        | 18.6%   | computePattern 経由  |
| line_lookup.queryPatternByCell         | 11.6%   | 共通（脅威検出系）   |
| prospect.classifyDirection             | 9.9%    | ホットパス直呼び     |
| threats.detectOpponentThreats          | 7.4%    | 共通                 |
| evaluate.createsFourThree              | 6.8%    | 共通                 |
| line_lookup.detectJumpThreeShape       | 6.8%    | computePattern 経由  |
| line_lookup.extractWindowFromCellsDual | 4.8%    | 窓抽出（必要コスト） |
| line_lookup.computePattern             | 3.2%    | 〃                   |
| prospect.updateNeighborDirections      | 2.2%    | 差分更新本体         |

**犯人: `classifyDirectionDual` / `refreshFullAt` が `classifyDirection`
（関数本体）を直呼びしていた。** `classifyDirection` は `ll.computePattern`
（PATTERN_TABLE **初期化用の生計算ロジック**）を呼ぶため、跳び形検出ループ
（detectJumpFourShape/ThreeShape）が探索ホットパスに乗り、分類関連だけで
prospect 実行時間の約38%を占めていた。

一方、P0 で構築済みの `DIR_PROSPECT_BLACK/WHITE`（512×512、全組み合わせで
classifyDirection と一致するテーブル整合テスト済み）はホットパスで未使用だった。

比較: legacy 構成のプロファイルでは detectJumpFourShape はトップ20圏外
（jump_patterns.checkJumpFour 2.9% のみ）。legacy の eval 更新系
（scanFourThreeThreat 13.9% + evaluateStonePatternsLightOnCells 6.1% +
add/subtractLinePotential 5.6%）とほぼ同じ帯を prospect は分類ループに使っていた。

## 修正: ホットパス分類をテーブル参照化

`classifyDirectionDual` の分類を `DIR_PROSPECT_BLACK/WHITE[own][block]` 参照に
置換し、`refreshFullAt` も `classifyDirectionDual` 経由に統一（窓抽出は従来どおり
`extractWindowFromCellsDual` 1回/方向）。挙動同値性は既存の
「テーブル整合: 全512×512で classifyDirection と一致」テストと
「インクリメンタル ≡ フル再計算」等価性テストで固定済み。

## 結果2: 修正後（fixed・depth=5・70局面、2回実行）

| 構成               | NPS（1回目 / 2回目） | avgTimeMs（1回目 / 2回目） |
| ------------------ | -------------------- | -------------------------- |
| legacy probe-off   | 81,217 / 89,274      | 526.6 / 479.1              |
| prospect probe-off | 100,425 / 100,639    | 354.4 / 353.7              |

**NPS 比 123.6% / 112.7% → Gate 0 PASS**（prospect が legacy より速い）。
prospect の実測は2回で 0.2% 差と極めて安定。

### legacy の run 間変動の切り分け（A/B 検証）

修正前 run の legacy（337.3ms / 126.8k NPS）と修正後 run の legacy
（479〜527ms / 81〜89k NPS）の差が「修正による巻き添え退行」でないことを、
**prospect.zig の変更を stash した修正前バイナリを再ビルドして legacy のみ再測定**
して確認した: 531.5ms / 80.5k NPS（修正後バイナリと同水準）。
→ 差はバイナリではなく初回測定時のマシン状態（外れ値）。判定は各 run 内の
比率（両構成を同条件・同一局面で連続実行）に依っており、影響しない。

### 修正後の prospect が legacy より速い理由（構造）

legacy の差分更新は影響範囲の**既存石**（collectAffectedPositions、最大41点）を
reEvaluateStone（パターン再評価）するのに対し、prospect は影響**空点**の該当
1方向のみをテーブル参照で再分類し、packed dir_code が不変なら sum 加減算ごと
スキップする。分類がテーブル化された後は「窓抽出9セル読み＋テーブル2ロード」
が支配コストで、legacy の石再評価より軽い。

## 補足

- 自己対局モードの depth=3 で prospect が「速く」見えたのは、1手あたり固定
  オーバーヘッド（ttClear・盤面転送・初期化）が支配的な領域で対局軌道が
  異なったため。NPS 判定は fixed モード depth=5 を正とする。
- lmr 再探索率が prospect で下がる（8.2%→3.2%）のは ordering と葉の一致度が
  上がる方向であり、Gate 0 の懸念（地形不一致による re-search 爆発）とは逆。
