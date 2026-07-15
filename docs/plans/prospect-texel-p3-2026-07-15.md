# P3: Texel 回帰 — 作業レポート

プラン: `eval-basis-prospect-2026-07-13.md` §4・§6 P3 行。開始: 2026-07-15。
前提: Gate 0 PASS 済み（`gate0-prospect-results-2026-07-13.md`）。

## P3-a: Rapfi ラベリングのスループット見積り（§4.2 の事前確認）

サンプル棋譜プレフィックス9局面 × timeout 別、RapfiClient.analyze（1プロセス）:

| timeout_turn | 局面/秒 | 10万局面の所要（1プロセス） |
| ------------ | ------- | --------------------------- |
| 50ms         | 20.5    | ~1.4h                       |
| 100ms        | 13.0    | ~2.1h                       |
| 200ms        | 6.3     | ~4.4h                       |
| 500ms        | 2.6     | ~10.7h                      |

- 評価値は timeout 間でおおむね安定（±100 程度の揺れ。回帰は10万件平均するので許容）。
- **結論: 実行可能**。採用 timeout = **100ms**（品質/速度のバランス。複数プロセス並列でさらに短縮可）。
- **落とし穴（実測で発見）**: 詰み級の局面では Rapfi が Eval MESSAGE を出さず、
  `analyze().evalStm` が既定値 0 のままになるケースがある（真の 0 と区別不能）。
  ラベリング実装では「Eval 未取得」を検出して**局面を破棄**する（0 として学習させない）。

## 局面の供給源（設計判断）

自己対局の新規生成は 1局≈数分（hard 実機時間）×1万局級が必要で数日かかり、最大のボトルネック。
一方、**既存の commit-bench 棋譜が 3,848 局**（bench-results/commit-bench-\*.json、
52局×2 + 208局×18）あり、これは hard・randomFactor 0.02/0.05・標準26珠型開局の
自己対局そのもの（プラン §4.1 指定の分布と一致。変則 A/B 構成同士の対局を含むが
いずれも実機フラグの現実的な棋譜）。

**決定: まず既存棋譜から抽出する**（生成コストゼロ）。1局から間引きサンプルで
40〜60k 局面を見込む。回帰の学習曲線（k-fold 誤差）を見て不足なら追加生成
（その際は手当たりの時間を絞った hard 構成で夜間バッチ）。

## quiet フィルタ（事前登録: この定義で固定）

局面（stm = 手番側）を以下すべて満たすときのみ採用:

1. ply ≥ 8（開局定石の重複帯を除外）かつ ply ≤ 終局−4（終局±数手の除外）
2. 手番側に即五なし（五を完成できる空点が存在しない）
3. 相手側に即五なし（= 止め四放置・必須防御局面の除外）
4. `hasVCF(stm)` が false（予算: maxNodes=200、threatProbe と同等級）
5. Rapfi ラベル取得後: **|evalStm| ≤ 3000 のみ採用**（決着局面の除外、§4.1 の上限カット）
6. 盤面キー（石配置の正準文字列）でグローバル dedup（開局帯の重複対策）
7. 1局からのサンプルは 2 ply 間隔・最大 12 局面（相関回避。棋譜長中央値28手に
   合わせ収量を確保するため 2 ply とした）

## ラベル（§4.2）

- 主教師: Rapfi evalStm（stm 視点）→ `sigmoid(eval / K)`、**K=200 で固定**
  （比率のみが重みの形を決め、絶対スケールは §4.3 アンカリングで legacy に正規化
  されるため、K は「Rapfi eval の勝率換算温度」として妥当な固定値でよい）。
- 副教師: 対局の勝敗（stm 視点 1 / 0.5 / 0）。k-fold で両教師の頑健性を比較。
- 特徴: `extractProspectFeatures(perspective=stm, stmIsPerspective=1)` の i32×34
  （カテゴリ17×手番2）。内積=クランプ前 raw が Zig/TS テストで固定済み。

## P3-b 実績（2026-07-15）

- 抽出: 3,848 局 → candidates 67,390 → **10,537 局面**（dup 41,391 / 即五opp 11,273 / vcf 4,189）。
  dedup 除外が6割超（同一開局帯の反復対局が多い）。34 パラメータに対し ~300 局面/パラメータで統計的には十分。
- ラベリング: **9,873 局面採用**（evalUnseen 663 / evalCap 1）。rapfiEval: mean 94.8, sd 620.9, p5/p50/p95 = −940/77/1155。
- 運用知見（scripts/rapfi はローカル運用のためここに記録）:
  - Rapfi 子プロセス死亡時の EPIPE が uncaught でラベラー全体が落ちる → rapfiClient に stdin error/exit 捕捉 + isAlive を追加し、ラベラー側でクライアント自動再起動（上限5回/worker）。
  - procs=4 の CPU 競合下で Rapfi が `ERROR Unknown command`（BOARD 直後の座標行拒否）を高頻度で返す事象 → 同一局面リトライ（3回・50ms間隔）で解消。4並列 ~55局面/秒で完走。

## P3-c 実績（2026-07-15、9,873 局面・group 5-fold・K=200）

| 教師    | ベースライン損失（現行既定重み） | fit 後 train | fold 平均 val | 反復  |
| ------- | -------------------------------- | ------------ | ------------- | ----- |
| rapfi   | 0.184348                         | 0.086888     | 0.088044      | 3,576 |
| outcome | 0.305756                         | 0.194367     | 0.197982      | 2,715 |

- 両教師とも現行 PROSPECT_SCORE_DEFAULT を大幅改善。val ≈ train で過学習なし。収束は上限（5000）未満。
- 中位カテゴリの序列は綺麗（NONE < WEAK < B2 < F2 < DOUBLE_F2 < B3 < F3 < F3複合 < B4_F2 < 三三白 < 四三）。
- **勝ち級カテゴリは学習不能（P3-d への申し送り・重要）**: quiet フィルタが戦術局面を
  除外するため、SOLO_F4_TURN / DOUBLE_FOUR_WHITE_TURN / WIN_WAIT は**出現ゼロで重み 0**、
  WIN_TURN（rapfi: −686）/ FOUR_THREE_TURN（rapfi: −58）は希少ノイズで不健全な値。
  → P3-d の量子化では**勝ち級（WIN / SOLO_F4 / DOUBLE_FOUR_WHITE / FOUR_THREE の TURN 系）
  は回帰値を採用せず、アンカー（§4.3）に基づく手設定値を維持**する。
  採用/棄却の判定は「特徴の出現サポート（非ゼロ行数）」を機械的な基準にする。
- 結果 JSON: `bench-results/texel-fit-2026-07-15T00-34-46-965Z.json`

### /review（3観点）の反映と留意点（2026-07-15、全員 LGTM・blocker ゼロ）

- **「凸」表記の訂正（perf 指摘）**: sigmoid+二乗損失は厳密には非凸。実装は zero-init
  固定の全バッチ勾配降下（Texel 標準手法）で決定的・実用上安定。val≈train と
  カテゴリ単調序列が良好解の傍証。元プラン §4 の「凸」は本注記で読み替える。
- **hasVCF の決定性（perf 指摘・反映済み）**: quiet フィルタの hasVCF は
  maxNodes=200 のみで打ち切るよう timeLimit を実質無効化（wall-clock 混入だと
  マシン速度でコーパスが変わるため）。既存コーパスは高速機で生成しており実害なし。
- **一様加算の不変性（issue 指摘・構造的性質）**: perspective=stm 固定のため
  全行で Σ TURN = −Σ WAIT = 空点数。全34重みへの一様加算は w·x を変えない
  = 絶対レベルは識別不能（差分のみ識別）。**P3-d のアンカリングは任意の仕上げ
  ではなくスケール確定のために構造上必須**。
- **役割分担の明確化（issue 指摘・Gate 2 解釈用）**: quiet フィルタの帰結として
  Texel が学ぶのは位置系（活二/三系）、戦術系（四三・勝ち級）はアンカー由来。
  これは破綻ではない（葉が四三点を「カテゴリとして認識」できること自体が
  legacy 石ベース葉に対するアーキ上の優位）。ただし **Gate 2 が中立/不合格なら
  四三系アンカー値が第一容疑**。P3-d では「回帰由来」と「アンカー由来」を
  重みごとに区別して記録し、切り分け可能にする。
- 微小（issue）: |eval|≤3000 キャップは K=200 では sigmoid がほぼ飽和する帯
  （実効 ±800 級と同等）。害はないので現状維持。

## P3-d 実績（2026-07-15、rapfi 教師・min-support=100）

- スクリプト: `scripts/prospect-anchor.ts`（コーパスから legacy 葉評価を再計算し、
  スケール s = std(legacy) / std(regressed-only raw_fit) を決めて焼き込みスニペットを生成）。
- 結果 JSON: `bench-results/prospect-anchor-2026-07-15T00-50-45-555Z.json`

### スケールと由来別重み表

- **s = 3.600189**（legacy std=776.27 / raw_fit(regressed only) std=215.62）
- min-support=100（プランの機械的基準）。34重み中 **28 が回帰採用・6 がアンカー維持**。

| #   | 名前                                  | サポート | 由来             | 焼き込み値 |
| --- | ------------------------------------- | -------- | ---------------- | ---------- |
| 0   | PROSPECT_NONE_WAIT                    | 472      | 回帰             | −23        |
| 1   | PROSPECT_NONE_TURN                    | 509      | 回帰             | −59        |
| 2   | PROSPECT_WEAK_WAIT                    | 9873     | 回帰             | −12        |
| 3   | PROSPECT_WEAK_TURN                    | 9873     | 回帰             | −9         |
| 4   | PROSPECT_SOLO_B2_WAIT                 | 9787     | 回帰             | 22         |
| 5   | PROSPECT_SOLO_B2_TURN                 | 9794     | 回帰             | 25         |
| 6   | PROSPECT_SOLO_F2_WAIT                 | 9777     | 回帰             | 14         |
| 7   | PROSPECT_SOLO_F2_TURN                 | 9772     | 回帰             | 19         |
| 8   | PROSPECT_DOUBLE_F2_WAIT               | 6102     | 回帰             | 55         |
| 9   | PROSPECT_DOUBLE_F2_TURN               | 5763     | 回帰             | 86         |
| 10  | PROSPECT_SOLO_B3_WAIT                 | 9167     | 回帰             | 64         |
| 11  | PROSPECT_SOLO_B3_TURN                 | 9234     | 回帰             | 56         |
| 12  | PROSPECT_B4_F2_WAIT                   | 2965     | 回帰             | 276        |
| 13  | PROSPECT_B4_F2_TURN                   | 2070     | 回帰             | 380        |
| 14  | PROSPECT_SOLO_F3_WAIT                 | 8030     | 回帰             | 94         |
| 15  | PROSPECT_SOLO_F3_TURN                 | 6856     | 回帰             | 133        |
| 16  | PROSPECT_F3_F2_WAIT                   | 4683     | 回帰             | 168        |
| 17  | PROSPECT_F3_F2_TURN                   | 3744     | 回帰             | 230        |
| 18  | PROSPECT_F3_B3_WAIT                   | 1955     | 回帰             | 149        |
| 19  | PROSPECT_F3_B3_TURN                   | 1437     | 回帰             | 179        |
| 20  | PROSPECT_SOLO_B4_WAIT                 | 8004     | 回帰             | 116        |
| 21  | PROSPECT_SOLO_B4_TURN                 | 7008     | 回帰             | 144        |
| 22  | PROSPECT_DOUBLE_THREE_BLACK_RISK_WAIT | 411      | 回帰             | −16        |
| 23  | PROSPECT_DOUBLE_THREE_BLACK_RISK_TURN | 253      | 回帰             | −216       |
| 24  | PROSPECT_DOUBLE_THREE_WHITE_WAIT      | 237      | 回帰             | 407        |
| 25  | PROSPECT_DOUBLE_THREE_WHITE_TURN      | 107      | 回帰             | 493        |
| 26  | PROSPECT_FOUR_THREE_WAIT              | 665      | 回帰             | 598        |
| 27  | PROSPECT_FOUR_THREE_TURN              | 25       | **アンカー維持** | 3000       |
| 28  | PROSPECT_SOLO_F4_WAIT                 | 3076     | 回帰             | 623        |
| 29  | PROSPECT_SOLO_F4_TURN                 | 0        | **アンカー維持** | 4500       |
| 30  | PROSPECT_DOUBLE_FOUR_WHITE_WAIT       | 19       | **アンカー維持** | 2600       |
| 31  | PROSPECT_DOUBLE_FOUR_WHITE_TURN       | 0        | **アンカー維持** | 4800       |
| 32  | PROSPECT_WIN_WAIT                     | 0        | **アンカー維持** | 5000       |
| 33  | PROSPECT_WIN_TURN                     | 1        | **アンカー維持** | 9000       |

- 予想どおり、勝ち級（FOUR_THREE / SOLO_F4 / DOUBLE_FOUR_WHITE / WIN の各 TURN）と
  DOUBLE_FOUR_WHITE_WAIT が quiet フィルタで抜けてアンカー維持側に落ちる。
  それ以外の28重みは回帰値を採用。

### アンカー検証（§4.3）

- legacy 参照: LEAF_FOUR_THREE_THREAT(2000) + FOUR_THREE_BONUS(5000) = **7000**
- 焼き込み後の四三点（final）:
  - PROSPECT_FOUR_THREE_WAIT = 598（**回帰**、比 0.085）
  - PROSPECT_FOUR_THREE_TURN = 3000（**アンカー維持**、比 0.429）
- 解釈: WAIT 側（相手番の四三＝perspective 側は次に守れる）が回帰結果として legacy より控えめに評価された。
  TURN 側（自番の四三＝勝ち近似）はサポート不足のためアンカー維持で 3000（P3-d 直前既定値。プランの
  「LEAF_FOUR_THREE_THREAT+FOUR_THREE_BONUS 級より控えめに置く」意図と合致）。
- **アンカー前提の限界（/review issue 指摘）**: legacy 7000 は「四三が既に成立している」
  全盤ブースト、prospect の four_three は「打てば四三が作れる空点」（potential）で量が別物。
  §4.3 の「四三点 ≈ legacy 7000」はカテゴリ差で厳密には成り立たない。
  **スケール確定の主機構は std マッチであり、四三比は参考値**と役割を切り分ける。
- 序列 sanity（勝ち級 TURN 単調性、焼き込み後）:
  WIN(9000) > DOUBLE_FOUR_WHITE(4800) > SOLO_F4(4500) > FOUR_THREE(3000)。**monotonic=true**。

### 分布比較（コーパス 9,873 行、stm 視点 raw eval、クランプ後）

| 分布                                    | std        | p95Abs   | maxAbs    |
| --------------------------------------- | ---------- | -------- | --------- |
| legacy 葉評価（hard 相当）              | 776.27     | 2041     | 5853      |
| prospect baseline（P3-d 直前）          | 2298.65    | 4973     | 9763      |
| prospect regressed（fit 生値）          | 215.95     | 433      | 839       |
| **prospect final（混成 = 焼き込み後）** | **807.21** | **1619** | **10000** |

- 焼き込み後の std 807 は legacy 776 と近似一致（比 1.04）。**分布アンカリング成功**。
- max|eval|=10000 は PROSPECT_EVAL_CLAMP でのクリップ発生を示す（数十件のアンカー起点局面）。
  勝ちスコア帯（FIVE−5000=95000）とは構造的に干渉しない（クランプが直接保証）。
- **mean は非一致**（legacy −329 vs final +224。std のみ合わせた帰結）。minimax は大域
  オフセットに概ね不変だが futility margin は絶対閾値のため、焼き込み後の Gate 0 再測で
  挙動確認する（/review perf 指摘）。
- **混成ペアの TURN/WAIT 非対称**（four_three 5.0倍・solo_f4 7.2倍。他カテゴリは1.3〜1.5倍）:
  WAIT=回帰 / TURN=アンカーの別ソース混成の副産物。決定的な点では大きな非対称が本来正しい
  面もあるが、テンポ反転で eval が跳ね aspiration fail が増えるリスクがある。
  **焼き込み後の Gate 0 再測（aspirationResearches/move・lmr 再探索率）で先に確認**し、
  膨れていれば solo_f4/four_three の両側アンカー化を検討（/review issue 指摘）。

### 損失検証（K=200, MSE over 9873 行）

| 重み                                        | 損失         |
| ------------------------------------------- | ------------ |
| baseline (P3-d 直前 PROSPECT_SCORE_DEFAULT) | 0.184348     |
| raw regressed weights (fit 生値)            | 0.086888     |
| **final (混成、スケール後 = 焼き込み値)**   | **0.126017** |

- **焼き込み後の baseline 損失 0.126017 は P3-d 前の 0.184348 を大幅改善**（sigmoid 越しに
  スケール s を掛けているため raw fit の 0.087 まで下がらないのは想定内）。
- P3-c と同条件（rapfi 教師・K=200・group 5-fold）で prospect-texel.ts を再実行し、
  再学習の余地が大きく縮まっていることも確認（新 baseline=0.126017、再 fit 収束後 0.086888、
  fold 平均 val=0.088044）。

### §4.3 スケール依存定数の棚卸し完了確認

分布一致（std: legacy 776 vs prospect final 807、比 1.04）により、以下の legacy スケール
依存定数が prospect パスでも当面そのまま意味を保つ:

- `FUTILITY_MARGINS_SELF` / `FUTILITY_MARGINS_OPPONENT`（`zig/src/minimax.zig:57-60`）
  — 深さ別 futility margin。マージン単位（数百〜千）は legacy 分布 p95=2041 と整合し、
  final prospect p95=1619 でも同帯域で機能する。
- `PLAIN_FOUR_PREFERENCE_MARGIN = 200`（`zig/src/search.zig:225,271`）
  — ルート単独四優先マージン。legacy 分布のばらつき200と同じ絶対値で解釈でき、
  prospect final でも意味が保たれる。
- Aspiration window `{75, 200, 500}`（`zig/src/search.zig` および
  `src/logic/cpu/review/reviewConstants.ts` の REVIEW_PROFILE_PRECISE.aspirationWidths）
  — 段階的 window 幅。分布 std がほぼ一致するため fail-high/fail-low 頻度は
  legacy と同オーダで推移する見込み。実測は Gate 0 で確認。
- 振り返り解析の blunder 閾値（`verifiedDrop ≥ 600`、review 系）
  — evaluatedDrop の絶対値判定。legacy と std が近いため同じ閾値で同オーダの検出率になる。

margin 類の再チューンは Gate 2 採用後の P5 に純化される（プラン §4.3）。

### /review 対応・実装判断メモ

- 既存 Zig テストへの影響: `zig/src/prospect.zig:1384` の「four_three vs solo_b4」平均重み差の
  マージン計算コメントを新値（(598+3000)/2 − (116+144)/2 = 1669）に更新。
  `try std.testing.expect(eval_with - eval_without > 1000)` のアサーション自体は据え置き
  （1669 > 1000 でパスする性質ベーステスト）。
- その他の Zig/TS テストは既定値の具体値に依存する箇所がなく（性質ベース＝反対称性/内積一致/
  クランプ/名前検索）、変更不要。`pnpm test` 全1589件パス。

## 再現手順（パイプライン全体）

worktree ルートから（wasm ビルド済み前提）:

```bash
# 1. コーパス抽出（commit-bench 棋譜のあるディレクトリを指定）
node --experimental-strip-types --import ./scripts/register-loader.mjs \
  scripts/prospect-corpus.ts --input=<main>/bench-results --out=bench-results/prospect-corpus.jsonl

# 2. Rapfi ラベリング（main リポジトリから実行。scripts/rapfi/ と tools/oracle/ は
#    gitignore 対象のローカル運用 = GPL 隔離。バイナリ入手は scripts/rapfi/setup.sh）
node --experimental-strip-types --import ./scripts/register-loader.mjs \
  scripts/rapfi/labelCorpus.ts --in=<worktree>/bench-results/prospect-corpus.jsonl \
  --out=<worktree>/bench-results/prospect-corpus-labeled.jsonl --procs=4
#    入出力仕様: 入力行に {key, black[], white[], stm} 必須。出力は入力行+{rapfiEval}、
#    破棄行は {key, dropped: "evalUnseen"|"evalCap"}。timeout_turn=100ms、|eval|≤3000、resume 可。

# 3. 回帰
node --experimental-strip-types --import ./scripts/register-loader.mjs \
  scripts/prospect-texel.ts --in=bench-results/prospect-corpus-labeled.jsonl --k=5 --teacher=both --K=200

# 4. アンカリング量子化（fit JSON を指定）→ 出力スニペットを prospect.zig に焼き込み
node --experimental-strip-types --import ./scripts/register-loader.mjs \
  scripts/prospect-anchor.ts --in=bench-results/prospect-corpus-labeled.jsonl \
  --fit=bench-results/texel-fit-2026-07-15T00-34-46-965Z.json
```

**注意**: 中間 JSONL（bench-results/）は gitignore 対象。コーパスを消すと再ラベリングが
必要になる（Rapfi 100ms×1万局面 ≈ 4並列5分）。

## 進捗

- [x] P3-a スループット見積り（2026-07-15）
- [x] P3-b コーパス抽出 + ラベリング（10,537 → 9,873 局面）
- [x] P3-c 回帰（k-fold・教師2系統）— 実装 + 本番実行済み
- [x] P3-d アンカリング量子化・焼き込み（s=3.60、28 回帰 + 6 アンカー、baseline 損失 0.184 → 0.126）

## Gate 2 結果（2026-07-15）: **PASS — 決定的有意勝ち**

commit-bench r0.02 × 8セット（416局）、commitA==commitB=8a752f4、
A=prospect（--eval-options-a、config JSON に記録済み）/ B=legacy:

- **WDL（prospect 視点）: +305 =5 −106、Elo +181 [145, 220.9]（95%CI）、勝率 73.9%**
- CI 全域が正で、過去の全レバー（CI幅 ~67 Elo で中立続き）と桁違いの有意差。
  プラン §5 Gate 2 の「legacy 比有意勝ち」を大差で満たす。
- 性能: A 平均深度 3.90 / NPS 17,654 vs B 4.20 / 13,588（prospect は per-node 速いが
  探索木の形が異なり深度はやや浅い。それでも +181）。
- Gate 1（評価盲目率）は「安い先行反証」の位置づけのためスキップした
  （Gate 2 が決定的 PASS のため反証目的は消滅。/review issue 観点も直行を許容済み）。
- 結果: `bench-results/commit-bench-2026-07-15T03-45-26-782Z.json`

**次: 採用判定はボスレビュー**。採用時は P5（hard の difficulty 配線を prospect に切替、
Gate 3=振り返り品質・対局体感・10秒予算の深度確認、margin 再チューン検討、ドキュメント）。

## P4 への申し送り（/review issue 指摘のブロッカー）

**Gate 2 の対局ハーネスに evalBasis=prospect を注入する経路が未配線**。このまま
commit-bench を回すと legacy vs legacy を測る silent 事故になる（プラン §3.3 の警告どおり）:

- `scripts/lib/match.ts:119-120` の customParams が `{ randomFactor }` 固定。
  `cpu-bridge-worker` 側は `customParams.evaluationOptions` をマージできる（:307-309）ので、
  match.ts から evaluationOptions を通す小配線 + ワイヤリング確認が P4 冒頭タスク。
- `ab-bench` の parseEvalOptions は boolean/number のみで evalBasis（string enum）を reject する。
- Gate 2 の前に、焼き込み後重みでの **Gate 0 再測**（NPS / aspiration fail / lmr 再探索率）を行う
  （上記の混成非対称・mean シフトの安価な先行確認）。
  - **→ 実施済み（2026-07-15、fixed・depth5・70局面）: 懸念は否定**。NPS 比 122.1%（PASS 維持）、
    aspiration 再探索/手 9.79→6.00（減少）、lmr 再探索率 8.23%→0.72%（大幅減）。
    混成非対称による re-search 爆発なし。avgDepth 4.90 vs legacy 4.96（微差、MAX_NODES 上限到達数局面）。
    結果: `bench-results/gate0-2026-07-15T01-06-32-751Z.json`
