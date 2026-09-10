# hard の強さレバー・スクリーニング（決定的ベンチ活用）— 設計メモ v2

- 日付: 2026-09-08（v1 → v2: /review 3観点の指摘を反映。変更点は §9）
- 前提: 計測基盤（ペア統計・開局スイート v1/v2・固定ノード決定的モード較正済み）は
  development に揃った（`bench-precision-2026-09-04.md`, `bench-fixed-nodes-2026-09-06.md`）。
  ボスの元指示（2026-09-03）「CPU の強さ・速度改善 or 計測改善をゼロベースで」のうち、
  計測改善が完了したので**強さ側**に移る。
- 目的: hard の対局 CPU に対して **正の Elo レバーを 1 本以上見つけて採用する**。
  採用には時間モード確認と回帰ゲートを必須にする。

## 0. 地形（既知の事実、再導出しない）

| 事実                                                                                                                                                                                                                                 | 出典                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 探索深さは Elo に効かない（時間 3 倍 / probe OFF+depth12 で中立）                                                                                                                                                                    | `search-lever-recheck-2026-07-18.md`                                                |
| プローブ（VCF/VCT）が仕事の 9 割で、強さの実体はプローブ側                                                                                                                                                                           | `bench-fixed-nodes-2026-09-06.md` §7.1 / §7.13                                      |
| プローブ予算は「未較正」と minimax.zig に明記。固定 20k（対 6k）は −60 Elo＝費用軸に実勾配あり。**安くする方向は未試験**                                                                                                             | `zig/src/minimax.zig:350-352`, bench-fixed-nodes §7.13 教訓(2)                      |
| legacy 形系重み（OPEN_THREE 等）はタップアウト                                                                                                                                                                                       | メモリ project_rapfi_eval_tuning（2026-06）, `gate0-prospect-results-2026-07-13.md` |
| 評価基底を prospect に変えて +181（最大の成功）。重みは Texel r2 で焼き込み                                                                                                                                                          | `prospect-texel-p3-2026-07-15.md`                                                   |
| r2 の 34 セル中 **6 セルはアンカー（データ未適合）**: FOUR_THREE_TURN 3000 / SOLO_F4_TURN 4500 / DOUBLE_FOUR_WHITE 2600,4800 / WIN 5000,9000。quiet コーパスでのサポートは 25 / 0 / 0 / 1                                            | `zig/src/prospect.zig:489-506`, p3 doc §P3-d                                        |
| 「Gate 2 不合格時は四三系アンカー値が第一容疑」と当時から記録されているが、**一度も振られていない**                                                                                                                                  | p3 doc                                                                              |
| texel-r3（同一エンジン自己対局の追い足し）は利得ゼロで棄却。教師コーパスはその後 **消失**（`bench-results/prospect-corpus-labeled.jsonl` 不在）                                                                                      | `prospect-texel-r3-2026-07-17.md`、本日確認                                         |
| hard の `singleFourPenaltyMultiplier: 1.0` は「0.0 の採否は別途ベンチ」とコメントされたまま未ベンチ                                                                                                                                  | `src/types/cpu.ts:184-188`                                                          |
| weight-bench は `setEvalParam` 注入で **リビルド不要**（注入≡ベイクのビット一致は legacy 9 id で実証。prospect 34 id は未実証）。TS の名前表 `scripts/lib/evalParams.ts` は legacy 9 個のみで **prospect の id 100〜133 を知らない** | `runtime-eval-weight-injection-2026-06-11.md`、本日確認                             |

### 0.1 本日の実測: J6 の罠は「深さ」でなく「ノード上限」の地平線

VCT の `max_depth` は三の脅威手の再帰段数のみを数え、四は各段で VCF（最大 8 手）に委譲される（`vct.zig`）。
`H8 I9 I8 G8 H7 G6 I7 J6` 黒番で wasm の `findVCTSequence` を直接呼んだ結果:

| VCT 深さ | ノード上限 6k / 9k / 20k / 30k | 50k 以上                                                           |
| -------- | ------------------------------ | ------------------------------------------------------------------ |
| 4〜7     | 見つからない                   | 11 手 `G7 J7 H6 H5 F8 I5 H10 H9 E7 F7 G9` を発見（約 120〜260 ms） |

深さ 4 で足りる。届かないのはノード上限（固定 6k・時間 50 ms ≈ 数 k ノード）。プローブ予算の**引き上げ**は
20k で −60 Elo と既に否定されているので、「VCT 深さを上げる」レバー（v1 の S5）は**候補から外す**。

結論: 手つかずで根拠のある候補は
(a) **プローブ予算を安くする方向**（費用軸に勾配があり、安い側が未試験）、
(b) **prospect のアンカー 6 セル**（データ未適合のまま +181 の土台）、
(c) **hard の未ベンチ設定**（singleFourPenaltyMultiplier）。
Texel 再学習はコーパス再構築（Rapfi ラベリング＋多様な対局）が要るので後段（§5）。

## 1. スクリーニング規約（SSoT）

- ツール: `pnpm weight:bench`（重み）/ `pnpm commit:bench`（ビルドや評価オプションが要る変更）。
- 共通条件: `--fixed-nodes`（既定 1.2M・プローブ 3k。P1 採用前は 6k）、`--jobs=7`。同時に走らせるベンチは 1 本。事前に `df`。
- **二段階スクリーン**（決定的モードなので前半＋後半の連結は全量 1 ランとビット一致）:
  1. 前半: `--openings=scripts/data/opening-suite-v2.json --max-games=382`（191 開局×2 色、約 1 h、SE ≈ 14）。
     変種視点の点推定 **≥ 0** なら後半へ。負なら棄却。
  2. 後半: `--opening-offset=191`（残り 191 開局、約 1 h）。前後半をマージして 764 局（半値幅 ≈ ±19〜20）で判定:
     - **候補**: CI が 0 を含まない（点推定 ≈ +20 以上に相当）。
     - **保留**: 点推定 ≥ +10。→ 固定ノード v1（600 開局 1,200 局、約 3.2 h、±15）で追試。CI 下限 > −5 かつ点推定 ≥ +10 なら候補。
     - それ以外は棄却。方向が出た保留は「同方向にもう 1 段」も可（決定的モードでは同一設定の再走は同一結果なので、再現は別値か別スイートで取る）。
- **採用ゲート（候補 → 採用）**: ①時間モード `commit:bench --openings=v1 --jobs=5`（1,200 局 6 h）で **点推定 ≥ +10 かつ CI 下限 > −5（非劣性）**、
  ②`scripts/regression-positions.ts` 全 PASS、③ `pnpm test` / `zig build test` 緑。
  ①は固定ノードでの検出力が時間モードと同等（§7.14）でも、製品は時間モードなので省略しない。時間モードの結果が上記の非劣性条件を満たさなければ不採用（固定より点推定が小さいだけなら可）。
- 実測（§6.2）: v2 382 局 = 108 分（jobs=7）、764 局 ≈ 3.6 h。半値幅は 382 局で ±28、764 局で ≈ ±20。1-1 ペア率 64%。
- SPRT は使わない（null レバーの停止に 260〜580 ペア要り、764 局固定より効率が悪い）。複数セル同時振り（omnibus）は評価軸の打ち消しで偽陰性になり得るので原則しない。
- weight-bench の Elo は A=baseline 視点（正 = baseline が強い）。**符号を反転して読む**。commit-bench も A 視点。

## 2. 前段ツール T1（小、TDD、サブエージェント委任、PR は development 向け）

1. **名前→id 表の生成**: `scripts/lib/evalParams.ts` に `PROSPECT_CATEGORIES`（prospect.zig の宣言順 17 名）と
   `PROSPECT_PARAM_ID_BASE = 100` を置き、`PROSPECT_<CAT>_WAIT/TURN`（id = base + cat×2 + turn）を生成して `EVAL_PARAM_IDS` にスプレッドする。
   **既定値は TS に複製しない**（SSoT は `PROSPECT_SCORE_DEFAULT`。表示や記録が要る場面は wasm の `getEvalParam` から読む）。
   `EVAL_PARAM_DEFAULTS` は legacy 9 個のまま。ヘッダー doc の「全 id で相異なる既定値で検出」の記述を「名前照合」に書き換える。
2. **TS 内重複の解消**: `PROSPECT_PARAM_ID_BASE` を `prospect-texel.ts` / `prospect-anchor.ts` が evalParams.ts から import する。
   `readCString` を `scripts/lib/wasmCString.ts` に 1 本化して 3 箇所で共有。
3. **照合テスト** `scripts/lib/evalParams.wasm.test.ts`（scripts プロジェクト。src → scripts の逆依存を作らない）:
   - 双方向: id 0..（十分大きい上限）を `getEvalParamName` で走査し、非空の名前集合 == TS キー集合。
   - 注入効果: prospect id を `setEvalParam` した後のフル評価（`evaluateBoard`）が既定と変わり、インクリメンタル経路と一致する（1 ケース。既存フィクスチャ流用）。
4. **read-back 検証**: `cpu-bridge-worker.applyEvalWeights` で `setEvalParam` 後に `getEvalParam(id)` を読み戻し、不一致なら **throw**（prospect ルーティング前の古い wasm では id≥100 が無音で捨てられるため）。
5. **weight-bench `--max-games`**: `resolveOpenings` は既に `maxGames` を受けるので parseArgs に 1 分岐（約 10 行）。
6. **`bench:reanalyze --merge`**: 複数 JSON の games を結合してペア統計を出す（前後半の連結用、小）。
7. `parseWeightOverrides` のエラーメッセージは 43 キー全列挙を避け、キー数と `--help` 誘導にする。`EvalParamName` の literal union に依存する箇所が無いことを確認。

## 3. スクリーン計画（優先順）

| #   | レバー                                       | 変種        | 根拠                                                                     | 手段                                                                                 | T1 依存 |
| --- | -------------------------------------------- | ----------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------- |
| P1  | プローブ VCT ノード上限（固定 6k）           | 3k / 4.5k   | 費用軸に実勾配（20k で −60）。安い側が未試験。主探索に回る予算が増える   | commit-bench（定数 1 行のブランチ）                                                  | なし    |
| P2  | `singleFourPenaltyMultiplier` 1.0            | 0.0         | 「別途ベンチ」のまま未実施                                               | commit-bench `--eval-options-b`                                                      | なし    |
| S0  | （事前計測）アンカー特徴の発火率             | —           | quiet コーパスでのサポート 25/0/0/1。評価葉で発火しなければ S1/S2 は無駄 | scratch: `extractProspectFeatures` を horizon-flips 142 局面＋探索葉サンプルに当てる | なし    |
| S4  | `PROSPECT_DOUBLE_THREE_BLACK_RISK_TURN` −246 | −150 / −350 | r3 で最も動いたセル（データが決めきれていない）                          | weight-bench                                                                         | T1      |
| S4' | `PROSPECT_DOUBLE_THREE_WHITE_TURN` 545       | 450 / 650   | r3 で 2 番目に動いたセル（+36）。S4 と対                                 | weight-bench                                                                         | T1      |

- P1 のプローブ上限は時間モードでは 50 ms に対応する。固定で正なら採用ゲート①は「50 ms → 30 ms 相当」のブランチで時間モード確認する（固定 3k と時間 30 ms の対応は到達率 `probe_cap_hits/probe_calls` で合わせる）。
- P1/P2 は T1 に依存しないので **T1 実装と並走**して先に回す。
- 採用時は prospect.zig の序列コメント／テストと `PROSPECT_EVAL_CLAMP=10000` の飽和に注意。

## 4. 実行順

1. P1a（6k→3k）をブランチで開始（バックグラウンド、約 2 h）。並行して T1 をサブエージェントで実装 → `/review` → マージ。
2. P1b → P2 → S4 → S4'。1 本ずつ。結果は §6 に追記。（S0 実施済み: §6.1。S1/S2/S3 は削除）
3. 候補が出た時点で採用ゲートへ。全滅なら §5。

## 5. 後段（本スクリーンが全滅した場合）

- Texel 再学習（多様コーパス版）: 開局スイート v1/v2 起点の自己対局（2026-09 のベンチ JSON、開局は distinct）に
  **ply4〜7 の序盤帯**を序盤制限列挙で補い、Rapfi でラベル。r3 の教訓 (a)(b) を満たす。
- `bench-results/horizon-flips-v2.jsonl`（142 局面、深さ 7 の根評価が 4 手以内に反転）を
  「static eval が見落とす形」の分類コーパスとして使い、特徴の不足を探す。

## 6. 結果（追記）

### 6.1 S0: prospect 特徴の発火率（2026-09-08、horizon-flips-v2 142 局面 × 根＋4 手 = 710 局面）

`extractProspectFeatures`（差分カウント: 手番側カテゴリ +1 / 相手側カテゴリ −1）を当てた非ゼロ率:

| 特徴                                  | 非ゼロ率   | 備考                                                            |
| ------------------------------------- | ---------- | --------------------------------------------------------------- | --- | ----------------------------------------- |
| NONE_WAIT / NONE_TURN                 | 0.0%       | NONE は `.dead`（禁手級の死点）の畳み込み先。空点の主体ではない |
| WEAK_WAIT / WEAK_TURN                 | 100%       | 空点の主体（平均                                                | v   | ≈ 195）。差分特徴なのでほぼ定数オフセット |
| SOLO_F3 / SOLO_F2 / SOLO_B2           | 84〜99%    | Texel 回帰済み                                                  |
| DOUBLE_F2 / SOLO_B3 / F3_F2 / SOLO_B4 | 38〜77%    | 同上                                                            |
| SOLO_F4_WAIT                          | 40.7%      | 回帰値 646                                                      |
| DOUBLE_THREE_BLACK_RISK_WAIT/TURN     | 6.5 / 2.0% | S4 対象（希少だが重み大）                                       |
| DOUBLE_THREE_WHITE_WAIT/TURN          | 3.0 / 1.1% | S4' 対象                                                        |
| FOUR_THREE_TURN / SOLO_F4_TURN        | 0.0 / 0.4% | **アンカーは実質発火しない**（quiescence/プローブが先に解決）   |
| DOUBLE_FOUR_WHITE / WIN_TURN          | 0.0%       | 同上                                                            |

判定: S1/S2（アンカー）は評価葉で発火しないので削除。S3（NONE）は死点カテゴリでレバーにならないので削除。
WEAK は差分特徴として相殺されるため触らない。残す eval 系は S4/S4' のみ（希少だが局所選好を反転させる実績＝r3 の J6 反転）。
スクリプト: scratchpad `s0-anchor-firing.ts`。

### 6.2 P1a 前半: プローブ VCT 上限 6k → 3k（2026-09-08、A=development 0785254 / B=screen/probe-3k 42ccd30、固定 1.2M、v2 前半 191 開局 382 局、jobs=7）

- 結果 JSON: `bench-results/commit-bench-2026-09-08T15-38-40-763Z.json`
- **A 視点 −15.5 [−43.4, +12.2]（ペア）＝変種 3k が +15.5**。pentanomial ll=34 ld=4 dd=122 wd=7 ww=24、1-1 ペア 64%（v1 の 68% と同程度）
- 所要 **108 分 / 382 局**（見積 1 h の約 2 倍。v2 は均衡局面で 1 局が長い）。平均深さ A 4.08 / B 4.34（3k のほうが主探索に予算が回り深い）
- 判定: 点推定 ≥ 0 → 後半（`--opening-offset=191`）へ。

### 6.3 P1a 後半＋全量（2026-09-09、後半 A=0785254 明示 / B=42ccd30、offset 191、382 局、110 分）

- 後半 JSON: `bench-results/commit-bench-2026-09-08T17-29-33-920Z.json`。後半のみ A 視点 −56 [−86, −26]
- **全量 764 局（`bench:reanalyze --merge`）: A 視点 −35.6 [−56.2, −15.3] ＝ 変種 3k が +35.6**。pentanomial ll=81 ld=17 dd=227 wd=13 ww=44、1-1 ペア 59%、distinct 764/764
- プローブ統計（moveHistory.stats、手番は手順の偶奇で判定）:

| 側   | 上限到達率 | 平均ノード/回 | プローブ比率 | 平均深さ | N 使い切り |
| ---- | ---------- | ------------- | ------------ | -------- | ---------- |
| A 6k | 19.9%      | 1,441         | 80%          | 6.12     | 49.0%      |
| B 3k | 25.4%      | 895           | 72%          | 6.51     | 34.9%      |

- 判定: **候補**（CI が 0 を含まない）。前半 +15.5 / 後半 +56 と半分ごとの差は大きいが、いずれも変種優位。
- 解釈: 固定 N ではプローブがノードを食う（80%）ので、上限を半分にすると主探索の深さが +0.4 増え、N 使い切りが減る。時間モードで同じ効果が出るかは未検証（採用ゲート①で確認）。
- 採用ゲート①の対応値: 6k ↔ 50 ms（到達率 19〜20%）の比例で **`PROBE_VCT_TIME_LIMIT` 50 → 25 ms**（ブランチ `screen/probe-25ms`）。ゲートの JSON で到達率が 25% 前後になるかを検証する。

### 6.4 P1 採用ゲート（2026-09-09）

- ②回帰ゲート: `scripts/regression-positions.ts` を 25 ms ビルドで実行 → **全 PASS**（p6 J6 局面: H6 を選択 7.4 s / p7: ブック F5）
- ①時間モード: `commit:bench --commitA=development(f0308d8) --commitB=screen/probe-25ms(7fb575f) --openings=v1 --jobs=5`（1,200 局、約 6 h）実行中。ログ `bench-results/gate1-probe25ms-time-2026-09-09.log`
- 合格条件: 変種視点 点推定 ≥ +10 かつ CI 下限 > −5。あわせて B 側の上限到達率が 25% 前後か確認
- **結果（2026-09-09、5.9 h、JSON `bench-results/commit-bench-2026-09-08T23-26-26-970Z.json`）: A 視点 −27.6 [−42.8, −12.4] ＝ 変種 25 ms が +27.6。合格。**
  pentanomial ll=110 ld=17 dd=393 wd=18 ww=62、distinct 1200/1200、abort 0

| 側      | 上限到達率 | 平均ノード/回 | プローブ比率 | 平均深さ | 1 手平均（探索手のみ。全手平均は 3.8/3.4 s） |
| ------- | ---------- | ------------- | ------------ | -------- | -------------------------------------------- |
| A 50 ms | 18.4%      | 2,022         | 86%          | 6.13     | 5.8 s                                        |
| B 25 ms | 24.2%      | 1,246         | 80%          | 6.51     | 5.3 s                                        |

- 固定 3k（到達率 25.4%）と時間 25 ms（24.2%）の対応は成立。固定スクリーンの +35.6 が時間モードで +27.6 として再現した＝**固定ノードスクリーンの結果は時間モードに転移する**（本プロジェクト初の実例）。
- **採用**: `PROBE_VCT_TIME_LIMIT` 50 → 25、`PROBE_VCT_NODES_DETERMINISTIC` 6000 → 3000（到達率で対応させる較正規則、bench-fixed-nodes §7.13）。PR は feat/probe-vct-25ms。
- ③テスト: pre-commit（vitest unit+scripts 2,254 件 / zig build test）全コミットで緑、`zig build test-golden` 緑（期待値 2 件更新、§6.4 冒頭）。イシューレビュワーも一時 worktree で `zig build test` 緑を確認。
- 後続: 固定 N=1.2M の時間モード同等性（§7.11）は 6k で較正したもの。**P1c（固定 1.5k）の採用判定に使う前に、混合対局（時間 25 ms vs 固定 1.2M/3k、416 局 jobs=5、約 2 h）で再較正する**。固定同士の相対比較（P1c スクリーン自体）は同等性に依存しないので先に走らせてよい。
- 注意: ゴールデン B の (7,11) 発見は擬似時計 step=1 ms のティック数が減った副産物で、実時間の観察ではない（実測として引用しない）。

### 6.5 振り返り解析の判定一致（2026-09-09、参照棋譜 白番 29 手、FAST、`pnpm profile:review --wasm --verbose`、P1c ベンチと並走）

振り返りの主探索は timeLimit 5,000/15,000 の時間モード扱いなので 25 ms が効く（パフォーマンスレビュワー指摘）。50 ms（development worktree）と 25 ms（PR ブランチ）で白番 14 手の判定を比較:

- **13/14 手が一致**（excellent 7 / good 1 / mistake 1 / blunder 5。被追い詰め・被 VCF の検出も同一）。
- 差は手 14（F11）のみ: 25 ms = excellent（最善 F11、score −1139、深さ 7）、50 ms = mistake（最善 J7、score −2872、深さ 6）。25 ms のほうが 1 手深い。PRECISE（15 s）で両ビルドを再確認（下記）。
- 所要はほぼ同じ（合計 33.0 s vs 33.9 s）。
- **PRECISE（15 s/手、`--precise`）: 14/14 手が一致**（手 14 は両方 mistake・最善 J7・score −3026・深さ 8。FAST の差は負荷下の FAST のゆらぎ）。
  25 ms 側は手 6/8 で 1 手深く（7/8 vs 6/7）、合計 99.1 s vs 107.5 s（−8%）。判定しきい値（150/400/2500）の再較正は不要と判断。

### 6.6 P1c 前半（3k vs 1.5k）の初回ランは無効（2026-09-09、機械側の周期停止）

- `bench-results/commit-bench-2026-09-09T06-04-13-610Z.json`: 251 局中 131 局が hang で破棄、`valid:false`。
- 原因は探索ではない: ハングダンプ（`bench-results/hang-dumps/hang-2026-09-09T05-48-27-291Z-g374.json` ほか）の
  `hang.mainThread.samples` で **メインスレッドの 1 秒タイマーが 898 秒発火していない**（`timerLagMs: 898225`）。
  09:34 JST 以降、約 15 分周期で全ワーカーペアが同時に止まり、600 s の move-timeout が一斉に発火 → 6〜7 局ずつ破棄 → 再生成、の繰り返し。
  最初の 174 局（09:34 JST まで）は正常（ペア −14.7、参考値）。スリープ記録（pmset）にスリープは無し。プロセスの一時停止（App Nap 等）が疑われる。
- 対処: `caffeinate -dims` 付きで再実行（`bench-results/screen-p1c-probe1500-half1-rerun-2026-09-09.log`）。
- 教訓: hang が全ペア同時・周期的に出たら `hang.mainThread.samples` の timerLag を先に見る（探索のハングなら 1 ペアだけ・非周期）。

### 6.7 P1c 前半（再実行、caffeinate 付き、2026-09-09、A=c968b2e 3k / B=2bf6a82 1.5k、v2 前半 382 局、jobs=7、94 分）

- JSON `bench-results/commit-bench-2026-09-09T08-24-01-018Z.json`、abort 0、distinct 382/382
- A 視点 −5.5 [−34, +23] ＝ **変種 1.5k が +5.5**。pentanomial ll=32 ld=4 dd=123 wd=2 ww=30（1-1 ペア 64%）
- 判定: 点推定 ≥ 0 → 後半（offset 191）へ。P1a 前半（+15.5）より小さく、3k → 1.5k の勾配は緩やかになった可能性。

### 6.8 P1c 後半＋全量（2026-09-09、offset 191、382 局、108 分）

- 後半 JSON `bench-results/commit-bench-2026-09-09T10-12-36-386Z.json`: A 視点 −11.8 [−37.7, +13.9]、abort 0
- **全量 764 局（`--merge`）: A 視点 −8.6 [−27.9, +10.5] ＝ 変種 1.5k が +8.6**。pentanomial ll=59 ld=12 dd=252 wd=7 ww=52、distinct 764/764
- 判定: 点推定 +8.6 < +10 → **棄却**（候補でも保留でもない）。6k→3k の +35.6 に対し 3k→1.5k は +8.6 で勾配が急に緩む＝プローブ上限は 3k 付近で頭打ち。P1 は 3k / 25 ms で確定。
- 次: 混合対局（時間 25 ms vs 固定 1.2M/3k、v1 416 局 jobs=5）で N=1.2M の同等性を再較正 → P2 → S4/S4'。

### 6.9 固定 N=1.2M の同等性再較正（2026-09-09、8d741fb、A=時間 25 ms / B=固定 1.2M・3k、v1 416 局、jobs=5、106 分）

- JSON `bench-results/commit-bench-2026-09-09T12-21-21-024Z.json`、abort 0
- **ペア Elo 0 [−21.1, +21.1]**、pentanomial ll=14 ld=3 dd=173 wd=5 ww=13（1-1 ペア 83%）
- プローブ統計: 時間 25 ms 到達率 24.5% / 平均 1,187 ノード / 深さ 6.48、固定 3k 25.0% / 875 / 6.57
- 判定: 固定 1.2M/3k ≡ 時間 25 ms。`--fixed-nodes` 既定 1.2M は据え置き。bench-fixed-nodes §7.15 の未再測を解消。

### 6.10 P2: `singleFourPenaltyMultiplier` 1.0 → 0.0（2026-09-09、8d741fb 同士、`--eval-options-b`、固定 1.2M/3k、v2 前半 382 局、110 分）

- JSON `bench-results/commit-bench-2026-09-09T14-26-39-075Z.json`。両側 prospect（worker ログ bit18=prospect、flags 313855 vs 393215＝乗数ビットのみ差）
- **191 ペア全部が 1-1（dd=191）＝全局が同一進行**。Elo 0 [−22.1, +22.1]
- 判定: **無効レバー（棄却）**。乗数は legacy 葉評価の項で、hard の prospect 基底では参照されない（下記 grep）。`src/types/cpu.ts` のコメント「0.0 の採否は別途ベンチ」は prospect 化で意味を失っている → コメント修正を後続課題に。

### 6.11 S4a: `PROSPECT_DOUBLE_THREE_BLACK_RISK_TURN` −246 → −150（2026-09-09、weight-bench、8d741fb、固定 1.2M/3k、v2 前半 382 局、104 分）

- JSON `bench-results/weight-bench-2026-09-09T16-21-38-262Z.json`
- A 視点 +1.8 [−23.3, +27.0] ＝ **変種 −1.8**。pentanomial ll=22 ld=9 dd=128 wd=9 ww=23（注入は有効: 63 ペアで進行が分かれた）
- 判定: 点推定 < 0 → **棄却**。反対方向 S4b（−350）へ。

### 6.12 S4b: `PROSPECT_DOUBLE_THREE_BLACK_RISK_TURN` −246 → −350（2026-09-10、weight-bench、v2 前半 382 局、110 分）

- JSON `bench-results/weight-bench-2026-09-09T18-27-28-583Z.json`
- A 視点 +9.1 [−16.8, +35.1] ＝ **変種 −9.1**。pentanomial ll=23 ld=6 dd=126 wd=10 ww=26
- 判定: 棄却。S4 は両方向とも負（−150: −1.8 / −350: −9.1）→ r2 の −246 は局所最適。S4' へ。

### 6.13 S4'a: `PROSPECT_DOUBLE_THREE_WHITE_TURN` 545 → 450（2026-09-10、weight-bench、v2 前半 382 局、103 分）

- JSON `bench-results/weight-bench-2026-09-09T20-25-21-826Z.json`
- A 視点 −12.7 [−37.3, +11.6] ＝ **変種 +12.7**。pentanomial ll=25 ld=6 dd=138 wd=2 ww=20
- 判定: 点推定 ≥ 0 → 後半（offset 191）へ。

### 6.14 S4'a 後半＋全量（2026-09-10、offset 191、382 局、115 分）

- 後半 JSON `bench-results/weight-bench-2026-09-09T22-20-34-881Z.json`: A 視点 −7.3 [−31.9, +17.3]
- **全量 764 局（`--merge`）: A 視点 −10.0 [−27.4, +7.3] ＝ 変種 450 が +10.0**。pentanomial ll=50 ld=11 dd=271 wd=11 ww=39
- 判定: 点推定 +10.0 で**保留**（基準ちょうど）。追試（固定 v1 1,200 局）の前に反対方向 S4'b（650）で勾配の向きを確認する: 650 も正なら雑音、負なら 450 の追試へ。

### 6.15 S4'b: `PROSPECT_DOUBLE_THREE_WHITE_TURN` 545 → 650（2026-09-10、weight-bench、v2 前半 382 局、104 分）

- JSON `bench-results/weight-bench-2026-09-10T00-11-31-803Z.json`
- A 視点 +7.3 [−16.9, +31.5] ＝ **変種 −7.3**。pentanomial ll=20 ld=5 dd=136 wd=7 ww=23
- 判定: 棄却。450 が +10.0 / 650 が −7.3 で「下げる方向」に一貫 → 保留中の 450 を規約どおり **固定 v1 1,200 局で追試**（`retest-s4pa-d3white-450-v1-2026-09-10.log`、約 5.5 h）。合格 = 点推定 ≥ +10 かつ CI 下限 > −5。

### 6.16 S4'a 追試: `PROSPECT_DOUBLE_THREE_WHITE_TURN` 450、固定 v1（2026-09-10、weight-bench、jobs=7）

- セッション再起動でベンチが 1,145/1,200 局で落ち JSON 未保存。ログの累積 W/D/L と開局 id から復元（scratch `recover-log.ts`、`estimatePairedElo` を使用）: 572 ペア（未ペア 1）
- pentanomial ll=65 ld=14 dd=433 wd=14 ww=46。**A 視点 −11.5 [−24.5, +1.4] ＝ 変種 450 が +11.5**（ハーネスの途中表示 −11.5 と一致）
- 判定: 点推定 ≥ +10 かつ CI 下限 > −5 → **候補**（v2 764 局 +10.0 と同方向・同規模。28 開局分の欠落は許容）
- 採用ゲート①: 時間モード `weight:bench --weights=...:450 --openings=v1 --jobs=5`（1,200 局、約 6 h）実行中、ログ `gate1-s4pa-d3white-450-time-2026-09-10.log`。合格 = 変種 ≥ +10 かつ CI 下限 > −5。合格なら prospect.zig に 450 を焼き込むブランチで ②regression / ③テストを通して PR。

### 6.17 S4'a 採用ゲート①（2026-09-10〜11、時間モード、weight-bench、v1 1,200 局、jobs=5、5.9 h）

- JSON `bench-results/weight-bench-2026-09-10T16-07-30-130Z.json`、abort 0
- A 視点 −5.8 [−18.8, +7.2] ＝ **変種 450 が +5.8**。pentanomial ll=65 ld=21 dd=441 wd=15 ww=58
- 判定: 点推定 < +10 → **不採用**（固定 +10.0 / +11.5 → 時間 +5.8。効果はあっても小さく、しきい値に届かない）。
- **§3 の候補は全部消化**: 採用 1 本（P1 +27.6）、棄却 = P1c / P2（無効）/ S4 両方向 / S4' 両方向。§5（後段）へ。

### 6.18 総括（2026-09-11）

| #   | レバー                             | 固定スクリーン                 | 時間ゲート       | 結果             |
| --- | ---------------------------------- | ------------------------------ | ---------------- | ---------------- |
| P1  | プローブ VCT 上限 6k→3k / 50→25 ms | +35.6 [+15, +56]               | +27.6 [+12, +43] | **採用（#163）** |
| P1c | 3k→1.5k                            | +8.6 [−10, +28]                | —                | 棄却             |
| P2  | singleFourPenalty 0.0              | 全局同一                       | —                | 無効レバー       |
| S4  | BLACK_RISK_TURN −150 / −350        | −1.8 / −9.1（前半）            | —                | 棄却             |
| S4' | WHITE_TURN 450 / 650               | +10.0 [−7, +27] / −7.3（前半） | +5.8 [−7, +19]   | 不採用           |

所要: スクリーン 11 ラン（約 20 h）＋ゲート 2 ラン（12 h）＋再較正 1 ラン（2 h）。
教訓: (1) 費用軸（プローブ予算）に唯一の大きな勾配があった。eval の単セル摂動は Texel 適合済みの重みでは ±10 以内。
(2) 固定スクリーンの結果は時間モードに転移する（P1: +35.6→+27.6、S4': +10→+5.8）。
(3) 保留（+10 前後）の追試は時間モードで縮む傾向。保留基準を +15 に上げるか、追試を時間モードで直接行うほうが効率的。

## 7. 非目標

- 探索深さ・NPS の改善（Elo に効かないと確定済み）。
- 下位難易度（beginner〜medium は legacy のまま）。
- 振り返りツール側の変更。ただし振り返りの主探索（timeLimit 5,000/15,000）は時間モード扱いなので、P1 の 25 ms は振り返りにも適用される（§6.5 で参照棋譜の判定一致を確認）。
- `scripts/analyze-position.ts` / `scripts/diagnose-vct.ts` は削除済み TS モジュールを import していて起動しない。別 issue で整理（本件では触らない）。

## 8. 後続課題

- weight-bench / commit-bench は結果 JSON を最後にしか保存しない。中断時に備え、局ごとの追記保存（または進捗ログからの復元ツール `bench:reanalyze --from-log`）を用意する（§6.16 の scratch を昇格）。
- `src/types/cpu.ts` hard の `singleFourPenaltyMultiplier` コメント「0.0 の採否は別途ベンチで判断」は prospect 基底では無効（§6.10）。コメントを実態に合わせる。
- commit-bench の起動ログ「evalOptions A: (既定=legacy)」は P5 以降 hard=prospect なので表示が古い（実体は worker ログの bit18 が正）。表示を「既定=難易度の evaluationOptions」に直す。

- `PROSPECT_PARAM_ID_BASE` の TS/Zig 二重定義（照合テストで検出できるので本件では共有しない）。
- 事前探索の即決（探索手の 38%）の偽陽性率は未監査。

## 9. v1 → v2 の変更（レビュー反映）

- S5（VCT 深さ 4→6）を削除。理由は §0.1 の実測（深さ 4 で可、地平線はノード上限）。
- §0 の誤り訂正: 「vct_depth=4＝攻め 4 手」→ 三の脅威手の段数（四は VCF 枠）、S3 の根拠（NONE は r1→r2 でほぼ動いていない）、出典名、§7.10 → §7.13。
- §1: 「≥+15」の冗長条件を削除、二段階スクリーン（半量 382 → 全量）、保留の追試は固定 v1 1,200 局、採用ゲートを非劣性＋点推定 ≥+10 に。
- §2: 既定値を TS に複製しない・カテゴリ名から生成・テストの置き場（scripts プロジェクト）・双方向照合・注入効果テスト・read-back throw・TS 内重複解消・`--max-games`・`--merge`。
- §3: P1（プローブ安価化）/ P2（singleFourPenalty）/ S0（発火率）/ S4' を追加、S1/S2 は S0 の後・序列 sanity 内の値に。P1/P2 を T1 と並走。
- （v2 追記）S0 実測により S1/S2/S3 を削除（§6.1）。
