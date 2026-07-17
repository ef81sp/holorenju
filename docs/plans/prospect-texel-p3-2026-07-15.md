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

## P5-a: hard 配線切替完了（2026-07-15）

`DIFFICULTY_PARAMS.hard.evaluationOptions`（`src/types/cpu.ts`）に `evalBasis: "prospect"`
を追加（beginner/easy/medium は未変更＝legacy のまま）。`cpu.worker.ts` の実対局と
`reviewConstants.ts` の `REVIEW_SEARCH_PARAMS.evaluationOptions`（hard を直参照）が
自動追随し、bit18（`encodeEvalOptions` レイアウトB）が実機フラグで立つことを確認
（新規一時テストで検証・削除済み。恒久カバレッジは既存の `prospectBasisWiring.wasm.test.ts` /
`reviewEvalWiring.test.ts`）。監査で `scripts/lib/match.test.ts` の3ケースが
「customParams 未指定 = legacy」という P5-a 以前の前提を固定していたため、
明示 `evalBasis:"legacy"` override を使う形に更新（意図は保持: override の独立性検証）。
`pnpm check-fix` 緑・`pnpm test` 全緑（93ファイル/1601テスト）。
変更ファイル: `src/types/cpu.ts`, `scripts/lib/match.test.ts`。

## Gate 3 結果（2026-07-15）: 実用チェック — **暫定PASS（1件要人間確認）**

プラン §5 Gate 3（振り返り解析の品質チェック + 対局体感 + 10秒予算内の深度確認 +
`reviewEvalWiring.test.ts` 緑）を実施。テスト棋譜は振り返り解析のベンチマーク・
リグレッションテスト用棋譜（白番29手、精度15%・ミス9回・敗着あり・被追い詰め多数の重い棋譜）:
`H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12`

### 1. 振り返り解析の品質比較（legacy vs prospect）

新規スクリプト `scripts/gate3-review-compare.ts`（fullEval を legacy/prospect 双方の
evalOptionsFlags で実行し、`buildEvaluatedMove`/`buildGameReview` で品質判定まで
再現する）で全29手を両基底で解析。REVIEW_PROFILE_FAST（timeLimit=5000ms,
absoluteTimeLimit=10000ms, hard 相当の評価オプション）を使用。

| 指標                             | legacy    | prospect         |
| -------------------------------- | --------- | ---------------- |
| accuracy                         | 52%       | 62%              |
| criticalErrors (mistake+blunder) | 11        | 9                |
| 敗着（losingMove）判定           | 手17      | 手17（一致）     |
| 総所要時間（29手）               | 178,862ms | 163,045ms（-9%） |
| 平均到達深度                     | 3.24      | 3.52             |

手11（I8、被追い詰めの決定的 blunder、scoreDiff≈99646）は両基底で完全一致。
最重要の破局的ミス判定は基底に依らず安定している。

**quality/scoreDiff が有意に異なった手（7件）:**

| 手             | legacy            | prospect           | 所見                                           |
| -------------- | ----------------- | ------------------ | ---------------------------------------------- |
| 手2 G8（白）   | mistake / 463     | good / -54         | prospect が改善（従来の過剰mistake判定を解消） |
| 手3 H9（黒）   | inaccuracy / 203  | inaccuracy / 130   | 同カテゴリ・微差。中立                         |
| 手6 H7（白）   | **excellent / 0** | **mistake / -618** | ⚠️ **要人間確認**（下記）                      |
| 手7 I7（黒）   | blunder / 1927    | excellent / 0      | prospect が改善（従来の過剰blunder判定を解消） |
| 手10 E9（白）  | blunder / 2152    | excellent / 0      | prospect が改善（同上）                        |
| 手14 F11（白） | inaccuracy / 110  | excellent / 0      | prospect が改善                                |
| 手16 E8（白）  | excellent / 0     | good / 53          | 閾値内の微差（good条件 ≤80）。実害なし         |

**総括**: 7件中5件は prospect が legacy の過剰な mistake/blunder 判定を解消する方向
（accuracy 改善・criticalErrors 減少と整合）。1件（手16）は閾値内の軽微な差で実害なし。
**1件（手6）のみ legacy=excellent → prospect=mistake という劣化方向の差**があり、
再現性は確認済み（同一条件で2回実行し両方とも scoreDiff=-618 で一致、ノイズではない）。

手6局面（"H8 G8 H9 G7 G9" 後、白番6手目）を手動確認: 黒は H8-H9（縦列）と
H8-G9（斜め）の2方向に伸びる石を持つ二立ての局面。legacy の最善手 H7 は縦列を、
prospect の最善手 F10 は斜めを止める手で、どちらも連珠的に合理性がある一手。
`scripts/analyze-position.ts` が Zig移植に伴う TS 探索モジュール削除（#37/#43）で
依存先 `search/miseVcf.ts` が欠落しており実行不可だったため、自動検証で優劣を
断定できなかった。

**→ Rapfi オラクルで追検証済み（2026-07-15、3秒思考）: prospect の判定が正**。

- 手6局面の Rapfi 評価は白視点 −431（白が既に不利）、最善手は I9（H7 でも F10 でもない）
- H7 の後（黒の最善応手 F9 まで進めて実探索）: 白視点 −679 = **H7 は約250点の追加損失**
- 結論: legacy の「excellent（下落0）」の方が損失を見えておらず、prospect の
  「mistake」は方向として Rapfi と一致（下落幅 −618 はやや過大だが順当な検出）。
  F10 の筋は Rapfi の定石ブック内（既知の妥当進行）で厳密比較不能だった点は留意。
- **判定を「劣化」から「検出力向上」に訂正。Gate 3 の要人間確認は解消**
  （1/29手・Gate 2 の Elo +181 を覆す規模でないことも変わらず）。

### 2. 10秒予算内の深度確認（代表局面: 序盤/中盤/終盤）

| 局面                           | legacy depth | legacy minimax時間 | legacy total | prospect depth | prospect minimax時間 | prospect total |
| ------------------------------ | ------------ | ------------------ | ------------ | -------------- | -------------------- | -------------- |
| 手6 H7（序盤）                 | 4            | 3,572ms            | 3,790ms      | 5              | 3,544ms              | 4,324ms        |
| 手15 H11（中盤・重い戦術局面） | 5            | 4,094ms            | 71,470ms     | 5              | 5,048ms              | 63,525ms       |
| 手25 K8（終盤・決着済）        | 0            | 2ms                | 6ms          | 0              | 4ms                  | 7ms            |

- Minimax探索本体は両基底とも timeLimit=5000ms 前後で完了しており、10秒予算を超えない。
- 手15 のように total が数十秒に達するケースがあるが、内訳を見ると forcedWinDetection
  （VCF/VCT探索、`REVIEW_VCT_OPTIONS_WITH_BRANCHES.timeLimit=Infinity`）が支配的
  （legacy 61,861ms / prospect 51,354ms）。これは **legacy でも同様に発生する既存の特性**
  であり、prospect 固有の劣化ではない（むしろこのケースでは prospect の方が13%速い）。
  Gate 3 の範囲では新規の問題として扱わない。
- 序盤局面（手6）では prospect が legacy より1段深く到達（depth5 vs 4）しつつ時間は同等。

### 3. ヘッドレス対局スモーク

- `pnpm test:browser:headless`: **この環境では実行不可**（Playwright の
  `chrome-headless-shell` バイナリ未インストール。`pnpm exec playwright install` が必要）。
  worktree 環境の制約でありコード起因ではない。
- 代替として新規スクリプト `scripts/gate3-headless-smoke.ts` で
  `WasmSearchEngine.findBestMove(board, color, "hard")`（cpu.worker.ts の実対局と同一経路、
  prospect 配線込み）を空盤面から20手自己対局。**結果: クラッシュ・盤外着手・占有マスへの
  着手なし、全手成功**（1手あたり最大10,048ms、timeLimit 内）。
- `pnpm vitest run src/logic/cpu/review/reviewEvalWiring.test.ts`: **3/3 パス**。
- 併せて `prospectBasisWiring.wasm.test.ts` / `evalOptionsWiring.wasm.test.ts`: **16/16 パス**。

### 補足: FAST プロファイルの再現性について

初回実行時（他の重い処理と並行実行し system 負荷がかかった状態）は同一手・同一基底でも
quality 判定が run 間で変動するケースが見られた（例: 手2 legacy が good/-67 と mistake/463
の間で変動）。これは `REVIEW_PROFILE_FAST` の探索が壁時計時間ベース（timeLimit=5000ms）
であるため、system 負荷次第で反復深化の打ち切り深度が変わる既知の特性であり、
legacy/prospect 双方に共通する（basis 差ではない）。本節の数値は system 負荷を排除した
クリーンな実行（単独プロセス実行）の結果を採用している。手6 の prospect 判定は
このクリーン実行を含む2回とも一致しており、この再現性懸念の対象外。

### ベンチ・診断スクリプトへの注意（P5-a 以降の新常態）

`DIFFICULTY_PARAMS.hard` を直読みするスクリプト（time-to-depth-bench / profile-search /
weak-bench の hard 指定時、commit-bench の既定経路）は、P5-a 以降**既定で prospect を測る**。
legacy ベースラインが必要な場合は `evalBasis: "legacy"` の明示 override が必須
（gate0-bench / prospect-anchor / commit-bench --eval-options-a|b は明示指定に対応済み）。

### Gate 3 判定: **PASS**

- **合格**: accuracy 52%→62% / criticalErrors 11→9 / 敗着判定一致 / 破局的blunder判定一致。
  minimax探索は10秒予算内（序盤はむしろ1段深い）。ヘッドレス自己対局（WASM経由）は
  クラッシュ・不正着手なし。関連テストは全緑。
- **要人間確認だった1件（手6 H7）は Rapfi オラクル追検証で解消**: prospect の
  mistake 判定の方が Rapfi と整合（上記「1. 振り返り品質比較」参照）。劣化ではなく検出力向上。
- **環境起因で未実施**: `pnpm test:browser:headless`（Playwright ブラウザ未インストール）。
  WASM経由のヘッドレス自己対局で代替済み。ブラウザ実機の体感確認はボスのプレイに委ねる。

## P6: 序盤入りコーパスでの再学習（texel-r2、2026-07-15）

### 背景

ボス実戦（`H8 I9 I8 G8 H7 G6 I7` の白番8手目）で hard prospect が **J6** を選択して敗着
（黒に11手 VCT を許した）。原因仮説の1つが「P3 コーパスは `ply≥8` フィルタで序盤が
皆無であり、prospect がその帯で legacy より劣化している」というもの。**コーパスを
更新して ply4-7 の局面を追加**し、Texel と焼き込みを再実行した（パイプライン自体は
P3-c / P3-d と同一・スクリプト無変更）。

### コーパス更新内容

- 新コーパス: `bench-results/prospect-corpus-labeled.jsonl`（**13,165 行、うち rapfiEval
  保有 12,437・破棄 728**。P3-d の 9,873 から +2,564）。
- 序盤帯 (`ply 4-7`): **624 行**追加（P3-d は 0 行）。中盤以降は概ね同分布のまま増量。
- ラベリング条件は P3-b と同じ（Rapfi timeout=100ms、|eval|≤3000）。

### P3-c 再実行（texel-r2, 12,437 局面, group 5-fold, K=200）

| 教師    | ベースライン損失（**P3-d 焼き込み値**が基準） | fit 後 train | fold 平均 val | 反復  |
| ------- | --------------------------------------------- | ------------ | ------------- | ----- |
| rapfi   | 0.122227                                      | 0.084202     | 0.085022      | 3,289 |
| outcome | 0.264672                                      | 0.192245     | 0.194816      | 2,692 |

- P3-d 焼き込み値（現行 PROSPECT_SCORE_DEFAULT）を起点にした baseline 損失が rapfi 0.122
  で、P3-c 時（生の未学習既定値）の 0.184 から大幅に下がっていることが焼き込みの効果を
  裏付ける。それでもさらに fit で 0.084 まで下がる = **序盤帯を追加したことで**
  **カテゴリ重み配分に有意な残余ゲインがある**（過学習なし・収束 3,289 反復 < 5,000）。
- 結果 JSON: `bench-results/texel-fit-2026-07-15T14-23-44-083Z.json`

### P3-d 再実行（texel-r2 アンカリング, min-support=100, rapfi 教師）

- **スケール s = 3.619345**（legacy std=807.73 / raw_fit(regressed only) std=223.17）。
  P3-d 時（s=3.600189、std=776.27）とほぼ同じ（コーパス増による分布ドリフト微小）。
- **min-support=100 の混成ルールは同じ、アンカー維持の顔ぶれも同じ**:
  P3-d と全く同じ 6 カテゴリ（FOUR_THREE_TURN / SOLO_F4_TURN / DOUBLE_FOUR_WHITE_WAIT /
  DOUBLE_FOUR_WHITE_TURN / WIN_WAIT / WIN_TURN）がアンカー、残り 28 が回帰採用。
  サポート数は r1 の 9,873 → r2 の 12,437 に応じて概ね比例増（顔ぶれ判定は不変）。

#### 分布比較（コーパス 12,437 行、stm 視点 raw eval、クランプ後）

| 分布                                       | std        | p95Abs    | maxAbs     |
| ------------------------------------------ | ---------- | --------- | ---------- |
| legacy 葉評価（hard 相当）                 | 807.73     | 2,061     | 10,225     |
| prospect baseline（P3-d 焼き込み値）       | 801.51     | 1,619     | 10,000     |
| prospect regressed（fit 生値）             | 223.49     | 450.75    | 1,138      |
| **prospect final（混成 = r2 焼き込み後）** | **832.77** | **1,670** | **10,000** |

- final std 832.77 は legacy std 807.73 に近似一致（比 1.03）。**分布アンカリング成功**。
- 勝ち級序列 sanity: WIN(9000) > DOUBLE_FOUR_WHITE(4800) > SOLO_F4(4500) > FOUR_THREE(3000)。
  **monotonic=true**。

#### 損失検証（K=200, MSE over 12,437 行）

| 重み                                                     | 損失         |
| -------------------------------------------------------- | ------------ |
| baseline (P3-d 焼き込み値 = 直前 PROSPECT_SCORE_DEFAULT) | 0.122227     |
| raw regressed weights (fit 生値)                         | 0.084202     |
| **final (混成、スケール後 = r2 焼き込み値)**             | **0.122433** |

- **final loss 0.122433 は baseline 0.122227 とほぼ同値（+0.000206、実質同点）**。
  これは「P3-d 焼き込み値が既に fit と分布アンカリングを通した quantized 解であり、
  コーパスを +26% 増やしても最終量子化解の loss はほぼ動かない」というアンカリングの
  安定性を示唆する（raw fit は 0.087 → 0.084 と明確に改善しているが、sigmoid+スケール s
  を通した混成後で四捨五入すると差は微細になる）。
- 損失の指標は据え置きでも、**個別重みは 34 中 26 で更新されている**（8 据え置き =
  アンカー6 + 偶然一致した回帰2。後述の比較表参照）。
- 留意（/review 指摘の反映）:
  - **r2 採用の位置づけは「Elo ゲイン」ではなく「既知の敗着回避」**。量子化後の
    コーパス損失は r1 と実質同点（0.1222 vs 0.1224）であり、全体強さは中立が予想される。
    採用条件 = r2 vs r1 の commit-bench で**中立以上**（退行がないこと）+ J6 回帰 PASS。
  - **→ 判定: 採用（2026-07-16）**。commit-bench（37afd43=r2 vs 40d214d=r1、r0.02）は
    220/416 局でハーネスの Worker move timeout により中断したが、部分結果
    **r2 視点 +127 =1 −92（Elo +56、220局の CI ≈ ±47 で下限プラス）** は「中立以上」を
    十分に満たす（そもそも中立でよいところ正側）。J6 回帰 PASS と合わせ採用条件成立。
  - **申し送り（別件）**: 中断原因の Worker move request timeout（1件、局221 付近）は
    「1手がハーネスのタイムアウトを超えた」事象。稀な探索ハング（過去に threatProbe の
    timeLimit ハング事例あり）の可能性があり、**別コミット・別調査**として backlog に記録。
    トラップ採掘の長時間実行でも同種の停滞に備え、チェック単位の外部タイムアウトを
    検討する。
  - 回帰チェックの PASS は「原調査と同一予算（VCT depth6/5s/500k）で強制勝ち未検出」の
    意味。元の J6 の 11手 VCT は同予算で検出できていたため対称な判定だが、
    より深い VCT の不在証明ではない。
  - 低サポート帯の回帰セル（例: DOUBLE_THREE_BLACK_RISK_WAIT の −16→+13 符号反転）は
    序盤追加の帰結ではなく再フィットの揺れ（ノイズ）。絶対値が小さく実害なし。
    すなわち loss は「同じ盆地内の別解」への移動であり、盤上の CPU 選択には十分効きうる
    変化幅である（実際、後述の回帰チェックで CPU 選択手が J6 → H6 に変化）。

### 新旧重み比較表（P3-d = texel-r1 → P6 = texel-r2）

| #   | 名前                             | 由来             | r1 (P3-d)    | r2 (P6)      | Δ (WAIT, TURN) |
| --- | -------------------------------- | ---------------- | ------------ | ------------ | -------------- |
| 0   | PROSPECT_NONE                    | 回帰             | (−23, −59)   | (−23, −55)   | (0, +4)        |
| 1   | PROSPECT_WEAK                    | 回帰             | (−12, −9)    | (−11, −8)    | (+1, +1)       |
| 2   | PROSPECT_SOLO_B2                 | 回帰             | (22, 25)     | (22, 26)     | (0, +1)        |
| 3   | PROSPECT_SOLO_F2                 | 回帰             | (14, 19)     | (20, 26)     | (+6, +7)       |
| 4   | PROSPECT_DOUBLE_F2               | 回帰             | (55, 86)     | (76, 106)    | (+21, +20)     |
| 5   | PROSPECT_SOLO_B3                 | 回帰             | (64, 56)     | (78, 75)     | (+14, +19)     |
| 6   | PROSPECT_B4_F2                   | 回帰             | (276, 380)   | (296, 392)   | (+20, +12)     |
| 7   | PROSPECT_SOLO_F3                 | 回帰             | (94, 133)    | (106, 141)   | (+12, +8)      |
| 8   | PROSPECT_F3_F2                   | 回帰             | (168, 230)   | (184, 254)   | (+16, +24)     |
| 9   | PROSPECT_F3_B3                   | 回帰             | (149, 179)   | (164, 207)   | (+15, +28)     |
| 10  | PROSPECT_SOLO_B4                 | 回帰             | (116, 144)   | (129, 156)   | (+13, +12)     |
| 11  | PROSPECT_DOUBLE_THREE_BLACK_RISK | 回帰             | (−16, −216)  | (13, −246)   | (+29, −30)     |
| 12  | PROSPECT_DOUBLE_THREE_WHITE      | 回帰             | (407, 493)   | (422, 545)   | (+15, +52)     |
| 13  | PROSPECT_FOUR_THREE              | WAIT=回帰/TURN=A | (598, 3000)  | (585, 3000)  | (−13, 0)       |
| 14  | PROSPECT_SOLO_F4                 | WAIT=回帰/TURN=A | (623, 4500)  | (646, 4500)  | (+23, 0)       |
| 15  | PROSPECT_DOUBLE_FOUR_WHITE       | **アンカー**     | (2600, 4800) | (2600, 4800) | (0, 0)         |
| 16  | PROSPECT_WIN                     | **アンカー**     | (5000, 9000) | (5000, 9000) | (0, 0)         |

- 34 セル中 **26 更新 / 8 据え置き**。据え置きの内訳:
  - アンカー 6 セル（FOUR_THREE_TURN=3000, SOLO_F4_TURN=4500, DOUBLE_FOUR_WHITE_WAIT=2600,
    DOUBLE_FOUR_WHITE_TURN=4800, WIN_WAIT=5000, WIN_TURN=9000）は定義上不変。
  - 回帰セルのうち NONE_WAIT (−23) と SOLO_B2_WAIT (22) は r1/r2 とも同じ四捨五入値に
    落ちて偶然一致。他 26 回帰セルは全て変化。
- **序盤で支配的なカテゴリ（NONE / WEAK / SOLO_F2 / DOUBLE_F2 / SOLO_B3）は総じて微増**
  している。とくに SOLO_F2 が (14, 19) → (20, 26) と +40% 級で伸びており、これは
  「石2つ活二を持つ空点」の相対価値が上がっているということで、**序盤配置の判定が
  変わる方向の変化**。NONE_TURN の絶対値が −59 → −55 に緩和されているのも、
  「空点ばかりの序盤局面で悲観方向のバイアスが弱まった」ことに対応する。
- FOUR_THREE_WAIT が -13 と唯一目立って減った回帰値（598 → 585）だが、TURN 側は
  アンカー 3000 で据え置き。分布 std の微増（807 → 833）に応じたスケーリングと
  fit の残余で相殺した結果。

### 回帰チェック（最重要）

`node --experimental-strip-types --import ./scripts/register-loader.mjs
scripts/regression-positions.ts` を r2 焼き込み後に実行:

```
--- p6-white-j6-collapse ---
  局面: H8 I9 I8 G8 H7 G6 I7（白番）
  hard の選択手: H6（14.8秒）
  → PASS（相手に強制勝ち手順なし）
```

- **PASS**。旧重み（P3-d）では白 J6（敗着）→ 黒に11手 VCT だったが、
  r2 焼き込み後は **hard が H6 を選ぶ**ようになり、H6 後に黒側の強制勝ち手順は
  検出されなかった（VCF: 深さ16・5秒・50万ノード / VCT: 深さ6・5秒・50万ノード
  の予算で検証）。
- コーパスに序盤帯（ply 4-7）を 624 局面追加しただけで CPU の序盤選択が変わり、
  実戦敗着局面がクリアになった = **仮説「序盤帯コーパス欠如が敗着の一因」を支持
  する強い状況証拠**（Elo 級の全体強化ではなく敗着回避の観点で有意）。

### テスト・ビルド結果

- `cd zig && zig build && zig build test`: 緑（既存の「four_three vs solo_b4 の平均
  重み差」性質ベーステストのコメントを新値 (585+3000)/2 − (129+156)/2 = 1650 に更新。
  マージン 1000 のアサーション自体は据え置き、1650 > 1000 でパス）。
- `pnpm check-fix`: 緑（0 warnings / 0 errors）。
- `pnpm test`: 全 1610 テスト緑（P3-d 時の 1601 から +9 = 別作業の追加テスト、この
  作業の変更対象外）。

### 変更ファイル

- `zig/src/prospect.zig`:
  - `PROSPECT_SCORE_DEFAULT` の 30 セル値を r1 → r2 に更新。
  - 由来コメントに「texel-r2 回帰: 序盤入りコーパス」の世代表記を導入。
  - 焼き込みブロック上部の docstring を r2 の s/std/コーパスサイズに更新。
  - 「four_three vs solo_b4」平均重み差テストのマージン計算コメントを 1669 → 1650 に更新。

### 未実施・申し送り

- **Gate 2 の commit-bench 相対勝率再測は未実施**。P3-d 時に prospect vs legacy で
  Elo +181 が出ているが、r2 は「P3-d 焼き込み値からのマイナー更新」で loss ほぼ
  同点。序盤敗着1件を修正した効果は回帰チェックで確認できたが、対局全体で有意な
  Elo 差が出るかは commit-bench 実測（8 セット 416 局・数時間）が必要。
- **Gate 3 の振り返り体感確認も未実施**。P3-d 時の accuracy 52% → 62% / criticalErrors
  11 → 9 の水準に対して r2 で回帰していないかは、同スクリプト `gate3-review-compare.ts`
  の再実行で低コストに確認可能（29 手・~3 分）。
- 本作業は焼き込みと敗着局面の解消までを担当。**採用判定・commit-bench 再測・Gate 3
  再測・ドキュメント最終化はボスと team-lead の判断領域**。

### 進捗

- [x] P6-b 序盤入りコーパスで再学習（Texel、rapfi・outcome 両教師）
- [x] P6-b アンカリング量子化（s=3.619、28 回帰 + 6 アンカー、顔ぶれ不変）
- [x] P6-b Zig 焼き込み + Zig/TS テスト緑
- [x] P6-b 回帰チェック（J6 敗着局面）**PASS**
- [ ] Gate 2 相対勝率再測（別タスク）
- [ ] Gate 3 振り返り体感再測（別タスク）
