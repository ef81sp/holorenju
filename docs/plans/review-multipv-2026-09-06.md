# 振り返りの候補手スコアを正確にする（root の上位 K 手を真値に）設計メモ（2026-09-06, v2）

v1 → v2: /review 3 観点（SOLID / perf / issue）を反映。主な変更 = §0 に診断の計測ゲートを追加（イシュー blocker）、§2.1 を「root で真値フラグ + null window 確認」に変更（SOLID 提案 2 / perf 提案 1）、§2.5 に境界値採用 3 経路を明記（イシュー blocker 2）、§3 のテストを自己整合に変更（SOLID blocker）、フェーズ 2 の ABI を同梱（イシュー提案 5）。

## 0. 目的・診断・ゲート

- **症状（ボス報告）**: 振り返りの候補手グリッドで、上位手のスコア差（`delta = searchScore − best`）が 0 や同じ小さな値に並ぶことが多い。
- **同点になり得る経路は 3 つ**あり、対策が違う。実装前に **参照棋譜で候補スコアをダンプして分類する**（§3-0）。

| 分類                     | 原因                                                                                                                                                                                                                                                                                                   | 対策                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| (a) 詰みスコアの真の同点 | 脅威プローブ（`minimax.zig:566-594`）が **定数 `FIVE−1`（詰み距離なし）** を exact で返す。相手に VCF/VCT があれば受けない手が全部 `−(FIVE−1)`、自分に VCF があれば壊さない手が全部 `FIVE−1`。forcedWin パス（`fullEval.ts:663-673`）は先頭に `FIVE` を置くので、グリッドは全候補「−1」に並ぶ          | 本メモの対象外。「詰み距離（`FIVE − ply`）をスコアに載せる」か「勝ち手同士は同点で良いと表示で割り切る」の別メモ |
| (b) 候補 1 件            | FAST（aspiration_mode 0）の事前探索即決（`search.zig:441-444`）。PRECISE は即決をスキップするので並ぶ                                                                                                                                                                                                  | 対象外（表示上「差がない」ではなく「候補が 1 件」）                                                              |
| (c) 非詰みスコアの境界値 | root の alpha-beta。`findBestMoveWithTT` の root ループは 1 手読むごとに `alpha = max(alpha, score)` を上げるので、alpha に届かない手は **真値ではなく上限（fail-low の境界値）** を返す。TT に上限として保存された値の再利用や子局面の即カットで alpha 付近に張り付く。aspiration window の外も境界値 | **本メモ（root の上位 K 手を真値に）**                                                                           |

- 潰した仮説: 表示側の丸めはない（`ReviewCandidateGrid.vue` は生の値）。TT は `findBestMoveForReview` のたびに無条件クリア（`searchEngine.ts:197`）なので前の手の汚染ではない。`verifyCandidates` はスコアを触らない（触るのは `reviewLogic.ts` の `FORCED_LOSS_PENALTY_SCORE` クランプと `promoteVcfCandidate` の FIVE 置換のみ）。
- **(c) は表示だけの問題ではない**: 実手が候補内にあると振り返りは境界値（上限）を実手スコアに採用する（§2.5 の 3 経路）。上限なので実手は実際より良く見え、悪手判定が甘くなる。候補外の実手だけ `probePlayedMoveScore`（深さ 3・全窓）で別評価される非対称もある。
- **ゲート**: §3-0 の分類で (c) の比率が小さければ本メモは着手しない（(a) の別メモへ）。

## 1. 現状の経路（事実）

| 場所                                                                                                                                       | 内容                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zig/src/minimax.zig` `findBestMoveWithTT`                                                                                                 | root ループ。各手を `minimaxWithTT(depth−1, alpha, beta)`（PVS ではなく素窓）で読み `alpha = max(alpha, score)`。全手の `{move, score}` を降順ソートして `candidates` に入れる                                                                                                                                                                     |
| `zig/src/minimax.zig:546-548`                                                                                                              | TT probe で `upper_bound` エントリは `beta = min(beta, bound)` に切り詰める                                                                                                                                                                                                                                                                        |
| `zig/src/search.zig` `findBestMoveIterative`                                                                                               | 反復深化。深さごとに aspiration → 失敗なら全窓で再探索。`best_result.candidates` の先頭 5 件を `top_candidates` に。その後 Score Verification（幅 75 の窓、窓外でも再探索なし）/ Time Pressure Fallback（`position/score` だけ差し替え、`candidates` は触らない）/ `demotePlainFourIfNeeded`（候補スコアを `PLAIN_FOUR_PREFERENCE_MARGIN` で使う） |
| `zig/src/main.zig` `findBestMove(color, max_depth, time_limit_ms, max_nodes, absolute_time_limit_ms, aspiration_mode, eval_options_flags)` | `result_buffer`: `[0]row [1]col [2..5]score [6]completed_depth [7]count [8..67]候補 6 バイト × 最大 10`。`writeResult` は 5 件（38 バイト）までしか書かない                                                                                                                                                                                        |
| `src/logic/cpu/wasm/searchEngine.ts` `findBestMoveForReview`                                                                               | 振り返り専用。候補ごとに TT から PV を抽出                                                                                                                                                                                                                                                                                                         |
| `src/logic/cpu/review/fullEval.ts` `executeWasmSearch`                                                                                     | FAST: depth 8 / timeLimit 5,000 ms（石 6 個以下は 0.7 倍）/ maxNodes 2M（呼び出し全体の累積）/ aspiration 幅 75 固定。PRECISE: 15,000 ms / 1M / 段階拡大                                                                                                                                                                                           |
| `src/components/cpu/ReviewCandidateGrid.vue`                                                                                               | `delta = c.searchScore − bestSearchScore`                                                                                                                                                                                                                                                                                                          |

## 2. 設計

### 2.1 アルゴリズム

**root で真値フラグを立てる**（再探索を減らす）: root は素窓 `(alpha, beta)` なので、`alpha_before < score < beta` だった手は最善手以外でも真値。`MoveScoreEntry` に `exact: bool` を持たせ、root ループで立てる。aspiration 失敗後の全窓再探索でも同じ規則が使える。

**上位 K 手を真値にする**（`refineTopCandidates`、K = `exact_top_k`）:

```
cands = candidates（score 降順。最善手を含む）
exact = cands のうち exact=true（Score Verification 後の最善手が窓外なら exact ではない）
研究回数 = 0
for cand in cands（exact=false のもの、score 降順）:
    if 研究回数 >= 2K: break                                     // 保険
    if len(exact) >= K:
        // K 件揃ったら null window で「K 位の真値 e_K を超えるか」だけ確認（真に劣る手は 1 回目と同程度に安い）
        s = searchRootMove(cand, depth, alpha=e_K, beta=e_K+1); 研究回数 += 1
        if 打ち切り: break
        if s <= e_K: continue（境界値のまま。exact=false）
        // fail-high → 全窓で真値
    s = searchRootMove(cand, depth, alpha=-INF, beta=cand.score+1); 研究回数 += 1
    if 打ち切り: break
    cand.score = s; cand.exact = true; exact に挿入（降順維持）
候補 = exact（降順）＋ 残り（境界値のまま、降順）。exact_mask は最終順序で計算
```

- `beta = b_i + 1`: 子局面の TT に `upper_bound = b_i` が残っているので、probe で beta は `b_i` に切り詰められる。真値 == b_i の普通のケースでは **ちょうど `b_i`** が返る。上限の仮定下ではこれは真値なので **`s == b_i` は真値扱い**（1 回で確定。全窓フォールバックは意味がないので置かない）。
- **上限の性質はこのエンジンでは保証されない**（Futility は max ノードの手を捨てて値を下げる、LMR は減深値を返す、打ち切り時は静的評価が混ざる）。真値 > b_i の手が孫の `beta = b_i` カットでちょうど `b_i` を返すと、そのまま真値として採用され検出できない。ヒューリスティック探索の限界として受け入れる（表示用途で今より悪くはならない）。§3-2 で不安定率を測る。
- コストの支配項は `alpha = −INF`（子で NMP もカットも効かない）で、再探索 1 手 ≈ 深さ d−1 の PV サブツリー。K=5 で反復深化全体の **1.5〜3 倍** の見積り（perf）。null window 確認により「境界値が alpha に張り付いて打ち切りが成立せず root 全手を全窓再探索」は避ける。
- 再探索で最善手を超える手が出た場合は候補先頭にし `result.position/score` も差し替える（全窓の方が信頼できる）。「候補先頭 = `result.position`」は **refine が走ったときだけ** の定義（Time Pressure Fallback 経路では従来どおりずれ得るが、TS は `bestMove` 一致で引くので破綻しない）。

### 2.2 実行位置と予算（`search.zig`）

- 反復深化ループ、Score Verification、Time Pressure Fallback の **後**、`finalizeStats` と `demotePlainFourIfNeeded` の **前**（stats.nodes に refine 分を含める）。
- ガード: `exact_top_k > 0 and !interrupted and !ctx.node_count_exceeded and (no_time_limit or now < loop_deadline)`。interrupted のときは走らない（Time Pressure Fallback で差し替えた `position` を並べ替えで上書きしない）。
- 深さは `completed_depth`。TT はそのまま（順序付けに効く）。moves は主探索と同じ `&moves`。
- 各再探索は既存の `ctx.deadline` / `absolute_deadline` / ノード上限に従う。**再探索後に `ctx.isAborted()` なら値を捨てて break**（abort 時の `minimaxWithTT` は静的評価混入値を返す）。
- `node_count_exceeded` はラッチされるので、主探索でノード上限に当たると refine は全スキップ（PRECISE 1M で起きやすい）。§3-7(d) の `exact_mask` で監視。
- 決定的モード（`ctx.budget.deterministic`）ではノード予算に従う（振り返りは使わないが動作を定義）。

### 2.3 DRY: root 1 手の探索を関数に

`findBestMoveWithTT` の root ループ本体（`placeStone → updateHash → minimaxWithTT(depth−1, false, color, alpha, beta, move, ctx, true, 0) → removeStone`）を `searchRootMove(cells, hash, move, color, depth, alpha, beta, ctx) i32` に切り出し、root ループと refine の両方から使う。`ctx.isAborted()` の前置チェックはループ側に残す。副作用は ctx 経由のみで挙動不変（ゴールデンテストで確認）。

### 2.4 ABI（`main.zig` / `types.ts` / `searchEngine.ts`）

- Zig 内部: `IterativeDeepeningParams` に `exact_top_k: u8 = 0` と `forced_move: ?Position = null`（フェーズ 2、§2.6）を追加。既存の呼び出し（`main.zig`、`search_golden_test.zig`）は default で不変。
- export `findBestMove` に **末尾引数 `exact_top_k: u8, forced_row: u8, forced_col: u8`**（255 = なし）を追加。wasm の JS 呼び出しは不足引数が 0 になるので既存呼び出しは変更不要（`forced_row = 0` は `exact_top_k = 0` のとき無視される。TS 側は必ず 255 を明示する）。`types.ts` は末尾 optional。
  - グローバル setter（`setThreatProbeEnabled` / `setDeterministicMode` と同流儀）は不採用: 呼び出しごとに変える値で sticky な状態を増やしたくない。
- 結果バッファ: `result_buffer[68]` に **`exact_mask: u8`**（bit i = 候補 i が真値。最終順序）。`exact_top_k == 0` なら 0（旧来どおり）。`IterativeDeepingResult.top_candidates` は comptime 定数 `TOP_CANDIDATES = 6`（フェーズ 2 の強制候補 +1 件。バッファは 10 件分ある）。TS は `count` を読むだけなので 6 件目が来ても壊れない。
- TS: `WasmCandidateEntry.scoreExact?: boolean` → `MoveScoreEntry.scoreExact?` → `ReviewCandidate.scoreExact?`（3 段とも同名・同極性。**省略時は「境界値」＝安全側**）。`findBestMoveForReview(..., exactTopK = 5, forcedMove?)`。

### 2.5 振り返り側（境界値を採用している 3 経路）

境界値を実手/最善のスコアとして使っている箇所は 3 つ。すべて `scoreExact` で分岐する。

1. `evaluatePlayedForcedWin`（`evaluatePlayedMove.ts:150`）: 実手が候補内 → `scoreExact` のときだけ採用、境界値なら `probePlayedMoveScore` にフォールバック。
2. `buildNormalResult`（`fullEval.ts:927-947`）: 通常パス（件数最多）の `playedScore` も同じ規則。
3. 降格時の `bestScore = safeBest.searchScore`（`fullEval.ts:1046-1050`, `reviewLogic.ts:362-366`）: 2 位以下＝境界値（上限）。真値になると **下がる** ので `scoreDiff` が縮み、判定はこの経路では **甘くなる方向**。表示は境界値なら「≤」。

判定が変わる方向は両側: 実手側（1・2）は厳しく、降格時の最善側（3）は緩く、再探索で最善を超える手が出れば厳しく。しきい値 150/400/2500（`reviewLogic.ts:38-45`）は境界値ベースの分布で較正したものなので、§3-7(c) の集計を再較正要否の判断材料にする。

- `executeWasmSearch` は `exactTopK = 5`、`forcedMove = 実手`（フェーズ 2 配線時）を渡す。候補の並びは wasm の返却順。
- `demotePlainFourIfNeeded` は refine 後の真値で判定する（振り返りのみ）。
- `ReviewCandidateGrid.vue`: `scoreExact` でない候補は `delta` に「≤」。

### 2.6 フェーズ 2: 実手の強制候補（Zig の ABI は本 PR に同梱、TS 配線は後続）

実手が top5 外のときの `probePlayedMoveScore` は深さ 3 で、候補（深さ 8）と混ざる（§2.5 と同じ「実手スコアの非対称」）。`forced_move` を渡すと refine がその手を必ず全窓で再探索し 6 件目として返す（真値・同じ深さ）。TS 配線と `probePlayedMoveScore` 廃止はフェーズ 1 の実測後。

## 3. テスト（先に赤）

0. **診断の分類（ゲート、実装前）**: `pnpm profile:review` に候補スコアを出す（`候補手検証` 行に `[safe:230]` の形。1 行変更済み）。参照棋譜（白番 29 手 `H8 G8 H9 G7 G9 H7 I7 F10 F9 E9 I8 I9 G10 F11 H11 E8 J6 K5 J7 K6 J9 J5 J8 J10 K8 L8 I10 L7 G12`、黒番 23 手 `H8 I9 F7 G8 I7 G7 G9 F10 J6 K5 H6 G5 G6 I6 H7 H5 F5 E4 J7 H10 J9 J5 I8`）を FAST と PRECISE で走らせ、手ごとに上位 5 手の同点/近接（|差| ≤ 10）の組を (a) `±(FIVE−1)`/`FIVE`、(b) 候補 1 件、(c) 非詰み、に分類して §6 に表で残す。ベンチと重ならない時間帯に実行。
1. **Zig / 不変**: `zig build test-golden` が `exact_top_k = 0` のまま通る（`searchRootMove` 切り出し・`exact` フィールド追加の検証）。
2. **Zig / 不安定率の計測**（assert ではない）: 固定局面数件（決定的モード、`no_time_limit`）で `exact_top_k = 0` の境界値 `b_i` と、同じ ctx 状態で直後に全窓 `searchRootMove` した値 `v_i` を比べ、`v_i > b_i`（上限破れ）の件数をログに出す。閾値は設けない（Futility/LMR で一部破れるのは既知）。
3. **Zig / 自己整合**: 同じ局面で `exact_top_k = 5` の候補 1〜5 のスコアが、同じ ctx 状態で直後に全窓 `searchRootMove` した値と一致し、`exact_mask` の下位 5 ビットが立ち、降順に並ぶ。root で `exact` が立った手は refine で再探索されない（stats.nodes の増分で確認）。
4. **Zig / 打ち切り**: `max_nodes` を主探索直後に尽きる値にすると、着手・スコアは `exact_top_k = 0` と同一で、`exact_mask` は root で立った分のみ。
5. **Zig / 強制候補**: `forced_move` に候補外の手を渡すと 6 件目として真値で返る。
6. **TS / 配線**: `findBestMoveForReview` が `exactTopK = 5` を渡し、`findBestMoveWithParams` 系は渡さない（`reviewEvalWiring.test.ts` の隣に SSoT テスト）。`result_buffer[68]` の読み取り。`scoreExact` の 3 段伝播。
7. **TS / 判定**: §2.5 の 3 経路が `scoreExact` でない候補スコアを採用しない（1・2 は probe に落ちる、3 は「≤」）。
8. **実機（profile-review）**: 参照棋譜で前後比較。(a) 上位 5 手の同点/近接の組の数（分類 (c) のみ）、(b) Phase 1 の所要時間、(c) 各手の quality 判定の変化（変化した手は目視で妥当性を確認し、方向を §2.5 の予測と照合）、(d) `exact_mask` が全部立った手の割合（node_count_exceeded による全スキップの監視）。

## 4. 受け入れ基準

- 対戦 CPU・ベンチ・gate0 の経路はビット不変（§3-1）。
- 参照棋譜で分類 (c) の同点/近接の組がほぼ消える。
- Phase 1 の所要時間の増加が **2 倍以内**（現状 5.1 s/局）。超える場合は **K=3** を先に試す（`completed_depth−1` 案は深さ混在のため不採用）。
- quality 判定の変化が §2.5 の予測方向と一致し、目視で妥当。しきい値の再較正が要るかを §6 に記す。

## 5. 進め方

- §3-0 の分類 → ゲート判定 → 実装はサブエージェント（Zig / TS で分担）、私が設計と diff 精査 → /review 3 観点 → development にマージ。
- 較正ベンチ（`docs/plans/bench-fixed-nodes-2026-09-06.md` §4）と並走する。実機計測（§3-0, §3-8）はベンチと重ならない時間帯に行う。

## 6. 結果（追記予定）

### 6.1 §3-0 診断の分類（2026-09-06、development 7d44b9c、`pnpm profile:review --wasm --verbose [--precise]`）

上位 5 手のうち |差| ≤ 10 の組がある手を分類（scratchpad/classify-ties.mjs）。「候補 1 件」は事前探索即決（FAST）または強制手。

| 棋譜 / モード        | 解析手 | (b) 候補 1 件 | (a) 詰みスコア同点 | (c) 非詰み同点 | 同点なし |
| -------------------- | ------ | ------------- | ------------------ | -------------- | -------- |
| 白番 29 手 / FAST    | 14     | 6             | 1                  | 3              | 4        |
| 黒番 23 手 / FAST    | 12     | 6             | 0                  | 5              | 1        |
| 白番 29 手 / PRECISE | 14     | 11            | 0                  | 3              | 0        |
| 黒番 23 手 / PRECISE | 12     | 1             | 4                  | 8              | 0        |

- **候補が 2 件以上ある手では (c) が主因**（FAST 白 3/8、FAST 黒 5/6、PRECISE 黒 8/11）。形は「2 位以下が同じ値」（例: `G7:-336 I8:-373 H7:-373 F10:-373 G10:-373`、`G9:957 H7:708 F8:708 H9:708 J8:708`）で、root の fail-low 境界値の診断どおり。**ゲート通過、本メモを実装する。**
- (a) は PRECISE 黒で 4 手（`G6:100000 H7:99999 H9:1013 …` のように勝ち手同士が −1 差）。件数は少ないが実在するので別メモ候補として残す。
- 実手が候補外のとき末尾に付く `probePlayedMoveScore`（深さ 3）の値が最善を上回る例が複数（`G8:-220` > 最善 `G7:-336`、`H7:-324` > `I7:-837`）。深さ混在の非対称（§2.6 フェーズ 2）の実例。
- 補足: FAST 白では 14 手中 6 手が候補 1 件（事前探索即決）。ボスの体感には「差がない」だけでなく「候補が出ない」も含まれている可能性がある（別件）。
