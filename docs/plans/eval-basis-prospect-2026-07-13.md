# 評価基底の転換: 空点プロスペクト基底 + Texel 流チューニング

作成: 2026-07-13 / ステータス: /review 3観点（SOLID・パフォーマンス・イシュー）反映済み、ボスレビュー待ち

## 0. レビュー反映サマリ（v2 での変更点）

- **[B] 配線の事実誤認を修正**: eval_options_flags は2レイアウト存在し、探索経路（Gate 2 で測る側）は `main.zig` 手動デコード ⇄ `searchEngine.ts` / `cpu-bridge-worker.ts`。配線対象を全列挙し、ワイヤリングテストを P1 に追加（§3.3）。
- **[B] スケールアンカリング**: futility margin・ルート着手選択マージン・aspiration window が legacy スケール依存。回帰重みを legacy スケールに正規化し、スケール棚卸しを P2 に前倒し（§4.3, §6）。
- **[B] 評価総和のクランプ**: eval は空点の総和で勝ちスコア帯（FIVE=100,000）と干渉しうる。最終値クランプとセル寄与上限を仕様化（§2.3）。
- 黒長連・有効活三・単線双四は9マス窓 LUT では**近似**であることを明記（§2.1）。
- 二基底の**恒久併存**を前提としたインターフェース設計（分岐1箇所・ProspectState は prospect.zig・非アクティブ基底の更新スキップ）（§3）。
- Gate 1 の循環性（合格は弱い証拠・不合格のみ強い証拠）を明記、Gate 0 に探索効率メトリクスを追加（§5）。
- quiet フィルタ強化・stm 3値の仕様・removeStone 不変条件・TT クリア運用・param-id SSoT 機構を追記。

## 1. 背景と目的

### 実測で確定している地形（2026-06 の調査結果）

- ★4 (hard) の Rapfi 比 blunder の **97% が位置評価の誤判断**（eval-misjudgment）。標準開局・中盤・重い悪手（verifiedDrop≥600）でも同傾向。
- 探索系レバーは実測で全滅: 深さ（probe 撤去で NPS 17倍・深度5→12 でも Elo 中立）、leaf-VCF（−112 Elo）、タクティクス修正（corpus 該当 0%）、TT 汚染修正（微小）、夏止め（中立）。
- eval **重み**の1軸調整もタップアウト（OPEN_THREE 上下とも悪化、他は横ばい）。
- 監査（eval-feature-gap 2026-06-13）の結論: 不足は個別ボーナス項ではなく**評価基底のアーキテクチャ**。
  - 現行 = **石ベース**: 置かれた石のパターンを加算（約7バケツ粒度・線形和）。
  - 強い古典エンジン（Rapfi classic 等）= **空点ベース**: 全空点について「そこに打ったら何ができるか」を4方向の組み合わせで畳み込み、カテゴリ×手番のテーブルで評価。
- **評価の2系統分裂**: 四三・ミセ・複数方向脅威等の組み合わせ知識は `position_eval.zig`（move ordering 用）にのみ存在し、**探索の葉（`evaluate.zig` / `incremental_eval.zig`）に届いていない**。葉は方向ごとの線形和 + `scanFourThreeThreat` の boolean ブースト1個しか組み合わせを知らない。これが eval-misjudgment 97% の構造的説明。

### 過去の失敗から確定している設計制約

1. **加算パッチ禁止**: 脅威状態テーブルを既存形スコアに上乗せした throwaway は −124 Elo（二重計上）。新基底は既存形系スコアの**置換**であること。
2. **共線軸の追加禁止**: LINE_POTENTIAL と同形状の軸を足すと相殺悪化（Phase C/D の教訓）。
3. **アーキテクチャの部分移植ハザード**: leaf-VCF は「NNUE 前提の探索機能を、それを吸収できない eval に接いだ」失敗。本プランは Rapfi classic が NNUE 以前から強さの源泉としていた **eval 基底そのもの**を置換するため移植単位として整合的だが、ordering・枝刈り閾値と葉の**地形不一致**は残るため Gate 0 で計測する（§5）。
4. **1コミット1施策**、検証は commit-bench r0.02 × 8セット（416局）基準。
5. main へのマージはボスレビュー後（stacked PR 運用）。

### 目的

葉評価を空点プロスペクト基底に転換し、重みは Texel 流（教師局面へのロジスティック回帰、NN なし）で決める。対戦 CPU と振り返り解析は同じ Zig eval を共有するため、両方に効く。

## 2. 新基底の仕様

### 2.1 方向プロスペクトコード（第1段 LUT）

各**空点** × 各方向（4）× 各色（2）について、「その色の石をそこに置いたとき、その方向にどんな形ができるか」を分類したコードを割り当てる。

入力は既存 `line_lookup.zig` と同じ **9マス窓**（中心±4、own 9bit × block 9bit）。既存 `PATTERN_TABLE` と並ぶ新テーブルを init 時に構築する:

```
DIR_PROSPECT_BLACK: [512][512]u4   // 黒を中心に置いた場合の方向コード
DIR_PROSPECT_WHITE: [512][512]u4   // 白を中心に置いた場合の方向コード
```

**SSoT**: 独立実装せず、init 時に `classify(computePattern(own | center, block))` の後処理として**既存 `computePattern` から派生生成**する（パターン知識の一次ソースを1箇所に保つ）。

コード体系（10種・暫定、16以下で u4）:

| code    | 意味                           |
| ------- | ------------------------------ |
| F5      | 五が完成する点（黒は =5 のみ） |
| F4      | 活四ができる                   |
| B4      | 止め四ができる                 |
| F3      | 活三ができる                   |
| B3      | 止め三ができる                 |
| F2 / B2 | 活二 / 止め二ができる          |
| F1 / B1 | 単石の可能性 / 半死            |
| DEAD    | この方向で五が作れない         |

跳びパターンは既存 LUT の `has_jump_four` / `has_jump_three` 相当のロジックで F4/B4/F3 に吸収する。

**近似であることの明記（レビュー指摘）**: 9マス窓では次の3つを完全再現できない。

1. **黒の長連補正**: `blackOverlineEnd` は中心から最大6マス先を見るため窓外にはみ出すケースがある（既存コードも LUT を信用せずセル走査で補正している。`evaluate.zig:135-151`）。
2. **F3 の「有効活三」判定のうち黒禁手による偽三のみ**: `isValidConsecutiveThree` のうち「発展先の活四点が黒禁手でないか」は大域情報で LUT に載らない。**達四に発展できる空間条件（外外セルの空き）は count==3 なら9マス窓内で正確に判定できるため近似ではなく実装する**（P0 実装レビューのイシュー観点 blocker 指摘で判明。当初プランはここを誤って近似に含めていた）。
3. **単線双四**: 同一ライン上の双四は1方向で B4 コード1個に潰れ、第2段が四四禁を見落とす。

いずれも eval 近似としては許容と仮定し、**P0 のテストケースとして近似挙動を明示的に固定**（窓端の長連、単線双四）した上で、**Gate 1 で偽陽性率を計測**する。悪ければ限定的な実盤フォールバック（該当パターンのみ）を追加。

### 2.2 空点カテゴリ（第2段: 4方向の組み合わせ）

空点1点の4方向コード（多重集合）を**セルカテゴリ**（32程度、u5）に畳み込む:

- F5×1 …… 勝ち点
- B4×2 / F4+B4 …… 四四点（白は勝ち級、**黒は四四禁＝DEAD**。ただし単線双四の見落としは §2.1 の近似）
- B4+F3 …… **四三点**（現行 `scanFourThreeThreat` が全盤 `createsFourThree` 走査で探している情報がテーブル参照で手に入る）
- F3×2 …… 三三点（白は強打、**黒は三三禁の可能性 → 保守的に黒専用減点カテゴリ**）
- F3+B3, F3+F2, B4+F2, F2×2, … 発展形 / 単独 F3 / B4 / F2 / B2 / それ以下

**実装形式（レビュー指摘）**: 毎回ソートせず、**フラットテーブル** `CELL_CAT: [65536][2]u5`（4×u4 を u16 に詰めて索引、色別）を init 時に comptime 関数から構築する（~128KB、アクセスは dir_code 読み→1参照）。

### 2.3 スコアテーブルと集計

```
PROSPECT_SCORE: [CAT_COUNT][2]i32   // [カテゴリ][手番(自分の手番か)]
```

評価値（perspective 視点）:

```
raw = Σ_空点 ( PROSPECT_SCORE[cat_my(p)][stm==persp]
             − PROSPECT_SCORE[cat_opp(p)][stm!=persp] )
eval = clamp(raw, −EVAL_CLAMP, +EVAL_CLAMP)   // EVAL_CLAMP = OPEN_FOUR 級（≪ FIVE−5000）
```

- **手番次元**が現行の TEMPO 割引を一般化して置き換える。
- **総和クランプ（blocker 対応)**: minimax は `FIVE−1`（threatProbe マーカー）や `±(FIVE−5000)` の帯域（`minimax.zig:566-567`）で詰みと形勢を区別するため、eval 総和が勝ちスコア帯に入らないことを**構造的に保証**する。テーブル値の個別上限も現実的な値（1セル寄与 ≤ 数千、四三点カテゴリで legacy の LEAF_FOUR_THREE_THREAT+FOUR_THREE_BONUS 級）とする。
- **stm の3値仕様（レビュー指摘)**: 既存 `last_mover_is_perspective` は unset/yes/no の3値。prospect パスでは `unset` 時は**両手番列の平均**を使う（単発 `evaluateBoard` export・一部テスト経路の決定性を保証）。minimax/quiescence の全 eval 呼び出し（abort パス含む）には is_maximizing から導出した stm を必ず供給する（P1 の仕様）（**P1 実装決定**: minimax の abort 経路は eval_basis==prospect のときのみ is_maximizing から stm を導出する。legacy は abort 経路でも常に既定の `.unset` のまま――legacy の TEMPO 割引を新規発火させず Elo を不変に保つための決定。quiescence の stand-pat は legacy/prospect どちらでも常時 stm を供給する既存挙動のままで、minimax abort 経路とは非対称。詳細: `minimax.zig` の `abortEvalOptions` コメント）。
- 集計は色×手番の `sum[2][2]` を**差分更新時に両手番変種とも更新**し、eval 時に選択する（per-node 再集計はしない）。

### 2.4 置換と残置（二重計上の排除）

「廃止」= **prospect パスから不参照**の意（legacy パスは下位難易度用に恒久併存。物理削除ではない）。

| 現行の葉評価要素                                                | prospect パスでの扱い                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| 石ベース形系スコア（OPEN_THREE/THREE/OPEN_TWO/TWO）             | 不参照（プロスペクト基底が包含）                           |
| LINE_POTENTIAL_TABLE                                            | 不参照（空点基底の原始形だったもの）                       |
| CONNECTIVITY_BONUS                                              | 不参照（複数方向はセルカテゴリが表現）                     |
| LEAF_FOUR_THREE_THREAT + `scanFourThreeThreat`（全盤走査×2/葉） | 不参照（四三点カテゴリで代替。葉の大きな高速化）           |
| LEAF_MISE_THREAT + `estimateMiseOpportunity`                    | 不参照（B4+F3 系カテゴリが近似的に包含）                   |
| 単発四ペナルティ / TEMPO 割引                                   | 不参照（手番次元に一般化）                                 |
| FIVE / OPEN_FOUR 等の勝ち級判定・詰み処理                       | **残置**。§2.3 のクランプで干渉を構造的に排除              |
| move ordering（position_eval.zig）                              | **不変**（葉のみの転換。地形不一致の実害は Gate 0 で計測） |

## 3. 実装設計（Zig）

### 3.1 新モジュール `prospect.zig`（状態と更新則を凝集）

- `initTables()`: DIR_PROSPECT_BLACK/WHITE と CELL_CAT を構築（`computePattern` から派生生成）。
- `dirCode(line_index, bit_pos, color) u4`（既存 `extractWindow` 流用。black/white 両窓を一度に取り出す dual 版で抽出回数を半減）。
- **`ProspectState` 構造体と差分更新・フル再計算・パリティ検証はすべて本モジュールに置く**。`incremental_eval.zig` はオーケストレータに徹し `prospect.updateOnPlace(...)` を呼ぶだけ（単体 TDD 可能・将来の legacy 削除も分岐1箇所の削除で済む）。
- `getProspectCategoryName(cat)` を export（回帰スクリプトとの index↔意味 照合・ドリフト検出用）。

### 3.2 インクリメンタル状態

```
ProspectState = {
    dir_code:  [CELL_COUNT][4][2]u4,   // 空点×方向×色（不変条件: 空セルのみ有効。占有セルの entry は stale）
    cat:       [CELL_COUNT][2]u5,
    contrib:   [CELL_COUNT][2][2]i32,  // セルごとの寄与キャッシュ（subtract 用）
    sum:       [2][2]i32,              // [色][手番]
}
```

`placeStone(r,c)`:

1. 置点自身: 空点でなくなる → 両色×両手番の寄与を sum から除去。
2. (r,c) を通る4ライン上の距離4以内の**空点**（≤8×4=32点）: 変化したのはそのライン方向の窓のみ → **該当1方向×2色のコード再計算**（bitboard 更新**後**に窓を読む）→ カテゴリ再畳み込み → sum 差分更新。旧カテゴリも新カテゴリもゼロ級の空点は early-skip。

`removeStone(r,c)`（レビュー指摘の明文化）:

1. 周辺空点は place と同じ1方向差分。
2. **再び空点になったセル自身は4方向×2色をフル再計算**（stale 値の再利用禁止）。
3. bitboard 更新後に窓を読む順序を厳守。

検証: Debug ビルドで `VERIFY_INCREMENTAL` と同じ流儀の「インクリメンタル ≡ フル再計算」assert。place/remove 往復・ランダム対局列パリティ・**反対称性 eval(persp)==−eval(opp)** を TDD で先に書く。make/unmake は全ノードで発生するためここのバグは即 Elo に出る。

### 3.3 配線と切り替え（blocker 対応: 全箇所列挙）

`EvalOptions` に `eval_basis: enum { legacy, prospect }` を追加。**eval_options_flags には2つのレイアウトがあり、両方に配線する**:

| 経路                                   | encode                                                                | decode                          | 用途                        |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------- | --------------------------- |
| レイアウトA                            | `src/logic/cpu/wasm/bridge.ts`                                        | `evaluate.decodeOptions`        | 単発 `evaluateBoard` export |
| レイアウトB（**探索＝Gate 2 の経路**） | `src/logic/cpu/wasm/searchEngine.ts` / `scripts/cpu-bridge-worker.ts` | `zig/src/main.zig` 手動デコード | findBestMove                |

- P1 で TS 側 encode の共通化（最低でも searchEngine ⇄ worker の一致テスト。cpu-bridge-worker は worktree 後方互換に注意）。**ワイヤフォーマット（ビット割当）自体は変更しない**: commit-bench は現行リポジトリの bridge worker が過去コミットの worktree WASM と通信するため、形式変更は歴代コミットとの Elo 比較を壊す。共通化は TS 内部の encoder 一本化に留める（ボス承認済みの構造改善スコープ 2026-07-13）。
- **ワイヤリングテスト必須**: 「prospect ビットが探索経路で実際に葉評価を切り替えている」ことを既存 `evalOptionsWiring.wasm.test.ts` の流儀で固定（配線漏れは silent に legacy vs legacy を測る事故になる）。
- 分岐はフル計算エントリ**2箇所**（`incremental_eval.getEvaluation` の switch と `evaluate.evaluateBoardOnCells` 冒頭の early return）。それ以外に増やさない（**P1 実装確定**。当初案の「switch 1箇所のみ」は、単発 `evaluateBoard` export の入口である `evaluateBoardOnCells` にも分岐が要ることを見落としていた）。先行リファクタとして legacy 集計を `getEvaluationLegacy` に抽出（`skip_four_three` 引数の整理含む）。
- **非アクティブ基底の差分更新はスキップ**: basis を `initFromBoard` 時に捕捉し、legacy モードでは ProspectState を更新しない（NPS 税の回避）。`initFromBoard` の位置引数肥大は Options 構造体渡しに変更（`search.zig:343` も同時修正）。
- `PROSPECT_SCORE` は `var` とし `setEvalParam` の id 空間を拡張（**prospect は id 100〜 のオフセット予約、enum は comptime 生成**）。SSoT は「既定値全ペア相異」方式では回らないため、**Zig の `getEvalParamName` / `getProspectCategoryName` を正準とし、TS が実行時に名前↔id を取得して照合**する方式に切り替える。
- **TT・状態の切替仕様（レビュー指摘)**: 基底・重みの実行時切替時は `ttClear()` + `initFromBoard` 再構築を必須とする（legacy スコアの TT 持ち越し＝TT 汚染の再演を防ぐ）。weight-bench / ベンチハーネス側の運用に明記。
- 新 WASM export `extractProspectFeatures(perspective)`: カテゴリ×手番の出現カウントベクトルを返す（§4 の回帰用）。

## 4. 重み決定: Texel 流ロジスティック回帰

評価値はテーブル重みに**線形**なので、Texel 流の当てはめは凸なロジスティック回帰。NN なし・決定論的に解ける。

### 4.1 コーパス

- 自己対局（hard、randomFactor=0.02〜0.05、標準26珠型開局）から1局あたり数局面をサンプル（相関回避）。目標 5〜20万局面。
- **quiet フィルタ（レビュー指摘で強化）**: 終局±数手・即五・進行中 VCF（`hasVCF`、予算は threatProbe と同じ 200 ノード級）に加え、**止め四放置・必須防御局面**（`detectOpponentThreats` が拾う類）を除外。**|教師eval| の上限カット**も適用。
- 生成は `runMatch` 資産（`scripts/lib/match.ts`）を流用したオフラインバッチ。

### 4.2 ラベル（教師）

主: **Rapfi の探索評価値**（ローカル `tools/oracle/` 経由。GPL コードはリポジトリに入れない従来運用。出力＝評価値の利用はボス承認済み）。`sigmoid(eval/K)` で勝率スケールへ。**K はスケールアンカリング（§4.3）と整合するよう固定値で先に決める**。
副（比較用）: 自己対局の**勝敗ラベル**（Rapfi 依存なしの保険。k-fold で両教師の頑健性を比較）。
P3 着手時に **Rapfi ラベリングのスループット見積り**（局面/秒 × 目標局面数）を先に取り、実行可能性を確認する。

### 4.3 当てはめとスケールアンカリング（blocker 対応）

1. `extractProspectFeatures` で各局面のカテゴリ計数ベクトル x を dump。
2. `minimize Σ (sigmoid(w·x / K) − label)²` を TS（`node --experimental-strip-types`）で解く（凸）。k-fold で過学習チェック（64重み程度ならリスク低）。
3. **legacy スケールへの正規化**: 量子化時に「コーパス上の eval 分布（標準偏差）を legacy 葉評価に一致」させ、アンカー（四三点カテゴリ ≈ legacy の LEAF_FOUR_THREE_THREAT+FOUR_THREE_BONUS 級）でずれを検証する。これにより `FUTILITY_MARGINS_SELF/OPPONENT`（`minimax.zig:57-60`）、`PLAIN_FOUR_PREFERENCE_MARGIN=200`（`search.zig:225,271`）、aspiration window {75,200,500}、振り返りの blunder 閾値（verifiedDrop≥600 等）が当面そのまま意味を保ち、**Gate 2 が「基底の良否」を測る**ことを保証する。margin 再チューンは採用後の最適化（P5）に純化される。
4. 仕上げ（任意）: weight-bench + SPSA で対局ベース微調整（randomFactor=0.02、多次元同時）。

## 5. 検証ゲートと難易度配線

| ゲート                       | 内容                                                                                                                                                                                                                                                                                             | 撤退条件                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Gate 0（スモーク・効率）** | 全 Zig テスト緑・パリティ緑。**(a) threatProbe 無効構成での NPS / 1ノードあたり eval 時間**（probe 込み NPS は eval 退行を隠すため）、**(b) 固定ノード数での time-to-depth**、**(c) `lmr_researches` / aspiration fail 率**（ordering×葉の地形不一致の実害）を legacy と比較。NPS 基準 −20% 以内 | 構造的な NPS 退行・re-search 爆発なら設計見直し                                                           |
| **Gate 1（評価盲目率）**     | blunders-classified corpus（★4・標準開局）で「葉評価が Rapfi 最善手後の局面を、実際の悪手後の局面より高く評価する率」が legacy 比で改善。**局面数と通過基準（改善ポイント数）は測定前に数値で事前登録**。§2.1 の近似（黒長連・有効活三・双四禁）の偽陽性率もここで計測                           | 改善しなければ重み/カテゴリ再設計 or 撤退                                                                 |
| **Gate 2（Elo・採用判定）**  | commit-bench r0.02 × 8セット（416局）で legacy 比有意勝ち。**中立だが正側の場合はセット追加（+416局）で再判定**（CI幅 ~67 Elo に対し真値 +20 級の偽陰性対策、ルールとして事前登録）                                                                                                              | 中立以下なら原因分析（カテゴリ粒度→u6化 → 脅威状態テーブルを**回帰基底の一部として**追加、の順で1軸ずつ） |
| **Gate 3（実用）**           | 振り返り解析の品質チェック（既知の誤 blunder 判定ケース）+ 対局体感 + 10秒予算内の深度確認。`REVIEW_EVAL_FLAGS` が hard から自動生成される既存テスト（`reviewEvalWiring.test.ts`）が緑のままであること                                                                                           | —                                                                                                         |

**Gate 1 の証拠力（レビュー指摘）**: 教師（Rapfi eval）と判定（Rapfi 最善手）が同源のため、**合格は弱い証拠（半ば循環）・不合格のみ強い証拠**。採用判定はあくまで Gate 2 に依る。Gate 1 は「安い先行反証」として位置づける。

**NPS 期待値**: 葉は O(1) 化されるが総 NPS は threatProbe（depth≥3 全ノード）が支配的なため波及は限定的。「葉の高速化」を Elo 向上の根拠にはしない。

難易度: 当面 **hard（★4）のみ** prospect に切り替え、beginner〜medium は legacy 維持（難易度カーブを壊さない）。hard 採用確定後に下位への展開を別途判断。

## 6. フェーズ分割（stacked PR・各フェーズでコミット）

| フェーズ | 内容                                                                                                                                                                                                        | 成果物                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| P0       | `prospect.zig`: 第1・2段テーブルと単体テスト（TDD: 方向コード・カテゴリ網羅、**近似挙動の固定テスト**=窓端長連・単線双四・黒三三近似、反対称性）                                                            | PR（配線なし・純追加） |
| P1       | 先行リファクタ（`getEvaluationLegacy` 抽出・initFromBoard の Options 化）→ フル計算パス + `eval_basis` 配線（**レイアウトA/B 両方**）+ ワイヤリングテスト + `extractProspectFeatures` export + stm 供給仕様 | PR                     |
| P2       | インクリメンタル化（place/remove・パリティ・スキップ規則）+ **Gate 0 測定**（NPS/time-to-depth/re-search 率）+ **スケール依存定数の棚卸し完了**（§4.3 アンカリング前提の確認）                              | PR + 計測メモ          |
| P3       | コーパス生成（quiet フィルタ実装）・特徴 dump・回帰スクリプト（教師2系統・k-fold・**スループット見積り先行**）→ アンカリング量子化 → 重み焼き込み                                                           | PR + 結果レポート      |
| P4       | Gate 1（事前登録基準）→ Gate 2 → 採用判定。必要なら SPSA 仕上げ                                                                                                                                             | ベンチレポート         |
| P5       | 採用時の後始末: margin 類の再チューン（任意最適化）、difficulty 配線確定、legacy 整理方針、ドキュメント                                                                                                     | PR                     |

各 PR はボスレビュー後マージ（自動マージ禁止）。P0〜P2 は強さに影響しない純追加なので並行レビュー可能。

## 7. リスクと対策

- **カテゴリ粒度不足**（イシューレビュー: Gate 2 中立の確率 30〜50% と見込む）: 撤退ではなく反復として回す。増強順序は (a) カテゴリ u5→u6、(b) 盤全体の脅威状態テーブル（四/活三保有×手番）を**回帰基底の一部として**追加（加算パッチ禁止）。
- **スケール断絶**: §4.3 のアンカリングで構造的に回避。P2 で棚卸し完了を確認。
- **黒禁手の近似誤差**: §2.1 に列挙した3近似。Gate 1 で偽陽性率を測り、悪ければ該当パターン限定の実盤フォールバック。
- **教師バイアス**: Rapfi 評価値への回帰は探索値ゆえ戦術価値が位置重みに滲む（Texel の既知問題）。quiet フィルタの強化 + 勝敗ラベルとの k-fold 比較で頑健性確認。
- **TT 汚染の再演**: 基底/重み切替時の `ttClear()` + 再初期化を運用ルール化（§3.3）。
- **成功後の再収穫**: 葉が賢くなると深さ・probe 閾値の価値が変わる。再検証は**必ず別コミット・別ベンチ**で行い交絡を避ける。

## 8. 過去結論との整合チェック

- 「eval 重みタップアウト」→ **石ベース基底上の1軸掃引**の結論。基底転換は監査の提言 B そのものであり矛盾しない。
- 「脅威状態テーブル −124」→ 手調整の**加算パッチ**が原因（提言 C 相当）。本プランは置換+回帰で二重計上を排除。
- 「深さは効かない」→ 本プラン成功後、NPS 資産の再収穫を別施策として再検証する価値が生まれる。
