# 設計メモ: 決定的探索モードと commit-bench `--fixed-nodes`（2026-09-06、v2）

bench-precision-2026-09-04.md の PR C。v1 → v2 の変更（/review 3 観点反映）: 専用フラグ方式に戻す、事前探索の親予算が効かない実態（charge 無し）への対処、`demotePlainFourIfNeeded` とミセ VCF の漏れ、統計バッファの旧 wasm 互換、move-timeout・乱数・ブックのガード、較正計画の見直し。

## 0. 目的と結論

- **目的**: 探索結果が (盤面, パラメータ) だけで決まり、壁時計・マシン負荷に依存しないモード。ベンチで (a) 負荷ノイズの排除、(b) jobs をコア数まで上げても結果が歪まない、(c) 同一入力で棋譜・1 手ごとのノード数・スコアが完全一致。
- **結論**: 既存の `threat_probe_enabled` と同じ流儀で **wasm グローバル `deterministic_mode` + `setDeterministicMode(bool)` export** を追加する（前提メモ §2.3 の「専用フラグ」要件どおり）。`time_limit == 0` の既存意味（`no_time_limit`、gate0-bench / profile-review の `--tl 0` / `fullEval.ts` の `?? 0` 経路）は**変更しない**。決定的モードは「時間を一切見ない」に加えて「時間で縛っていた全ての子探索をノード予算に置き換える」。製品経路（対戦・振り返り）はフラグ既定 false で**ビット単位不変**。
- ベンチ側は `--fixed-nodes=N`（両側）/ `--fixed-nodes-a|b=N`（片側、較正用）で `setDeterministicMode(true)` + `timeLimit=0` + `maxNodes=N`。

## 1. 壁時計が探索結果に入る経路（現状・網羅）

時計読みは全て `deadline.nowMs` 経由（search / minimax / quiescence / vcf / vct。profiler.zig は未使用）。

| #   | 箇所                                                                                                                                                                                         | 時間モード | `no_time_limit` の現状                                                    | 決定的モードでの扱い                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | メイン minimax（`ctx.deadline` / 絶対デッドライン、4 ノード毎）                                                                                                                              | 有効       | スキップ                                                                  | スキップ（同じ）                                          |
| 2   | quiescence（`QLimits.deadline`）                                                                                                                                                             | 有効       | スキップ                                                                  | スキップ                                                  |
| 3   | 反復深化ループ（dynamic time / loop_deadline）                                                                                                                                               | 有効       | スキップ                                                                  | スキップ                                                  |
| 4   | **事前探索** `findPreSearchMove`: `pre_limiter` 600 ms、VCF 150 ms（時間のみ）、相手 VCF 150 ms + 3000 ノード、ミセ VCF（親の残り時間・内部は own ノード 5000/3000）、VCT 300 ms（時間のみ） | 有効       | **600 ms 壁時計のまま**（params を受け取らない）                          | **ノード予算**（§2.2）                                    |
| 5   | **脅威プローブ** `threatProbe`: VCF 20 ms + 200 ノード、VCT 50 ms + `vct_nodes=0`                                                                                                            | 有効       | VCT が時間・ノードとも無制限（depth 4 のみ）、消費は `stats.nodes` 未計上 | **VCT にノード予算、消費を `stats.nodes` に計上**（§2.3） |
| 6   | **非生産的四の降格** `demotePlainFourIfNeeded`（search.zig:274）: `findVCFMove(…, 50 ms)` を無条件で呼ぶ                                                                                     | 有効       | **50 ms 壁時計のまま**                                                    | **ノード予算**（§2.2）                                    |
| 7   | `TimeLimiter.exceeded` のグローバル絶対デッドライン                                                                                                                                          | 有効       | 0（無効）                                                                 | 0（§2.6 の安全弁を除く）                                  |
| 8   | `TimeLimiter.child` / `untilDeadline` の時計読み                                                                                                                                             | 値を使う   | 読むが使わない                                                            | 同左（決定性に影響なし）                                  |

TT は毎手 `ttClear`、history / killer / counter-move は探索ごとに初期化、Zobrist は固定シード。VCT 内部再帰は `limiter.child(0,0)` と `findVCFSequenceWithParent` で親ノードを継承し有界。`opponentBlocksThreePursuitAtRoot` / counter-four probe は own ノード固定。したがって 4・5・6 を直せば決定的になる。

## 2. 設計

### 2.1 フラグと予算の SSoT: `BudgetPolicy`

- `minimax.zig`（または新規 `budget.zig`）に `pub var deterministic_mode: bool = false;`、`main.zig` に `export fn setDeterministicMode(enabled: u8)` と `export fn getSearchFeatures() u32`（bit0 = deterministic mode 対応、bit1 = stats に pre_search_nodes/probe_nodes あり）。
- `findBestMoveIterative` の入口で **一度だけ** `BudgetPolicy` を導出し、`findPreSearchMove` と `ctx` に渡す（bool の並立を増やさない）:

```zig
pub const BudgetPolicy = struct {
    deterministic: bool,        // = deterministic_mode（true なら time_limit は 0 として扱う）
    pre_vcf_nodes: u32,         // 事前探索 自分の VCF（時間モードは 0=時間のみ）
    pre_opp_vcf_nodes: u32,     // 相手 VCF（既存 3000）
    pre_vct_nodes: u32,         // 事前探索 VCT
    demote_vcf_nodes: u32,      // 非生産的四の降格判定 VCF
    probe_vct_nodes: u32,       // threatProbe VCT（時間モードは 0）
};
```

- 予算定数は時間定数と**同じファイル・隣接**に置く（`vcf.zig: VCF_TIME_LIMIT` の隣に `VCF_PRE_NODES_DETERMINISTIC`、`vct.zig: VCT_TIME_LIMIT` の隣に `VCT_PRE_NODES_DETERMINISTIC`、`PLAIN_FOUR_VCF_CHECK_TIME_LIMIT` の隣に `…_NODES_DETERMINISTIC`）。較正で片方だけ直す事故を防ぐ。
- `getThreatBudget(depth, policy)` が `vcf_time / vct_time / vcf_nodes / vct_nodes` を一表で返す（`threatProbe` 内の `if (no_time_limit) 0 else 20/50` を吸収）。

### 2.2 事前探索・降格判定（`search.zig`）

- **親予算が効く形にする**: 現状 `findVCFMove` / `findVCTMove` / `hasVCF(&opp_limiter)` は `pre_limiter` に `charge()` していないため、親のノード予算は死に値。`findVCFSequenceWithParent`（vcf.zig:461）と同型の `findVCFMoveWithParent(cells, color, depth, own_ms, own_nodes, parent)` / `findVCTMoveWithParent(...)` を追加し、内部で `parent.child` → 探索 → `parent.charge(消費)` を行う。これで (a) 親予算、(b) §2.3 の消費ノード取得、(c) §2.4 の `pre_search_nodes` 観測点が 1 本で揃う。時間モードでは `pre_limiter.max_nodes == 0` なので charge しても挙動不変（`remainingNodes` は 0=無制限）。
- 決定的モード: `pre_limiter = { time_limit: 0, max_nodes: PRE_SEARCH_NODE_BUDGET }`、各段は `child(0, policy.*)`。
- **ミセ VCF**: `findMiseVCFMoveWithParent` は内部で `parent.child(0, MISE_VCF_NODES)` と own ノードを取り、候補ループに `parent.exceeded()` チェックが無い。決定的モードでは上限が「候補数 × ターゲット数 × 5000 + ノリ手 3000 × 防御数」になる。**候補ループ先頭に `parent.exceeded()` チェックを追加**（`deterministic` で gate。時間モードでは親が尽きた後は child が exhausted で全経路 null なので結果は同じだが、ビット不変はテストで固定）。
- **`demotePlainFourIfNeeded`**: 決定的モードでは `findVCFMoveWithBudget(…, 0, policy.demote_vcf_nodes)`（VCF は安いので 2〜3k 程度、較正）。時間モードは 50 ms のまま。
- `findPreSearchMove` の caller は `findBestMoveIterative` とテスト 2 本のみ。互換ラッパは作らずテストを直す。

### 2.3 脅威プローブ（`minimax.zig`）

- 決定的モード: `vct_time = 0`、`vct_nodes = policy.probe_vct_nodes`（較正値）。VCF は既存 200 ノード。
- **消費ノードを `ctx.stats.nodes` に加算**（`…WithParent` の charge 値。`findVCTSequence` は `result.nodes` を返しており取得コストはゼロ）。これで `max_nodes` が探索の総仕事量の上限になる。charge は探索後の一括加算なので `max_nodes` を最大 `probe_vct_nodes` 分だけ超過しうる（決定性には無害、N の解釈に注記）。
- **時間モードでは加算しない**（`max_nodes` 到達が早まり製品挙動が変わる）。

### 2.4 統計（`SearchStats` / `main.zig`）

- `pre_search_nodes: u32`、`probe_nodes: u32` を追加。両モードで記録（時間モードの較正データ取得に必要）。`stats.nodes` への加算は決定的モードのみ。
- `stats_buffer` は **append-only で 48 → 60 バイト**（`pre_search_nodes` / `probe_nodes` / `absolute_deadline_hit`。実装時に安全弁フラグを追加）。main.zig の「レイアウト変更禁止」コメントを「append-only。リーダーは `getSearchFeatures()` bit1（または buffer 長）で存在判定」に改める。**TS 側リーダー（bridge worker / gate0-bench `readStats` / searchEngine）は features bit または `getStatsBuffer` 長で分岐**し、旧 wasm で 48 バイトを越えて読まない（越えると隣接メモリを黙って読む）。

### 2.5 ベンチ側（`scripts/`）

- `--fixed-nodes=N`（両側）/ `--fixed-nodes-a=N` / `--fixed-nodes-b=N`（片側。時間 vs 固定の混合対局＝較正用）。変換 `fixedNodes → { timeLimit: 0, maxNodes: N, deterministic: true }` は `benchCliChecks` の純関数。`buildBridgeCustomParams` は**オブジェクト引数**化し `timeLimit` / `deterministic` を含める。
- **排他・必須（`benchCliChecks`）**: `fixedNodes` と `--max-nodes-a/b` の併用はエラー。`--book-a/b` との併用はエラー（ブックの `randomPool` は `Math.random`）。`randomFactor > 0` は `--seed` 必須（bridge worker は seed 無しだと `Math.random`）。`--sets > 1` は randomFactor 無しではエラー（同一棋譜の反復）。
- **非対応の検出**: bridge worker は `deterministic` 要求時に `typeof wasm.setDeterministicMode === "function"` と `getSearchFeatures() & 1` を確認し、無ければ **中止**。wasm 無し（TS フォールバック）も中止。ready メッセージの `engineParams` に `searchFeatures` を同梱し、結果 JSON の config に両側の bits を記録（`--compare` の provenance）。使える最古コミット＝本 PR。
- **move timeout**: 決定的モードでは 1 手時間が N と負荷に比例して伸びる。既定の 30 s では abort が「プローブが重い＝戦術的に緊迫した局面」に偏り Elo を歪める（現行計上でも ms/node は p50 46 µs・p99 1.3 ms と 80 倍散る）。決定的モードの `--move-timeout-ms` 既定は **600,000**。abort が 1 件でも出た run は結果 JSON に `valid: false` と該当局面を記録し、終了コード非 0。受け入れ条件は abort = 0。
- **replay-hang**: `buildBridgeCustomParams` に `timeLimit` / `deterministic` を渡していないため固定ノード対局のハングを 10 s 時間モードで再生してしまう。`engineParams` から復元するよう追随。
- **liveness 診断**: 決定的モードでは探索中に時計を呼ばないため `workerLiveness` が長考を stalled と誤報する。ハングダンプに「deterministic では時間チェック回数は生存指標にならない」を出す（小）。
- **決定性スモーク** `pnpm bench:reanalyze --compare a.json b.json`: pairId ごとに棋譜・**1 手ごとの `stats.nodes`・score** の完全一致を報告。

### 2.6 将来の製品利用への配慮（本 PR では最小）

- 決定的モードでも `absolute_time_limit > 0` を渡せば**安全弁として有効**にし、発火時は `stats` にフラグ（`absolute_deadline_hit`）を立てる。ベンチは 0（無効）を渡すので不変。製品 hard を固定ノードにする判断はボスの別判断。

## 3. テスト（先に赤）

Zig（ネイティブ、擬似時計 `deadline.test_now_ms`。自動進行フック `test_clock_step` を追加し、`nowMs()` が呼ばれるたびに step ずつ進む。開始値は非 0）:

1. **時計非依存**: 同じ局面を `deterministic_mode=true, max_nodes=N` で 2 回探索。1 回目 step=0、2 回目 step=1000 ms。着手・スコア・`stats.nodes`・`pre_search_nodes`・`probe_nodes` が一致。事前探索で決まる局面（相手の四 / 自分の VCF / ミセ VCF）と通常探索の局面の両方。
2. **事前探索の予算**: 決定的モードで VCT 段が `pre_vct_nodes` 以内、ミセ段が親 `PRE_SEARCH_NODE_BUDGET` 超過で打ち切る。時間モードは従来どおり（既存テスト維持）。
3. **プローブ計上**: 決定的モードで `probe_nodes > 0` かつ `stats.nodes` に含まれる。時間モードでは `probe_nodes` は記録されるが `stats.nodes` は不変。
4. **時間モードのビット不変**: 固定局面 6〜10 件（事前探索即決 / 深さ 7 完了 / 降格判定発火 / ミセ VCF 発火を含む）の着手・score・`stats.nodes` を**ゴールデン値として Zig テストに焼く**（本 PR の前に採取）。
5. `getSearchFeatures()` の bit0/bit1、`setDeterministicMode` の往復。
6. 安全弁: 決定的モード + `absolute_time_limit > 0` で擬似時計を超過させると打ち切られ `absolute_deadline_hit` が立つ。

TS（vitest）:

7. `fixedNodes` 変換と排他チェック（max-nodes / book / randomFactor 無 seed / sets>1）。
8. bridge worker の非対応検出（`setDeterministicMode` 無しモック → reject、TS フォールバック → reject）。
9. `--compare` の一致／不一致（棋譜・nodes・score）。
10. readStats の 48/56 バイト分岐。
11. replay-hang が `timeLimit` / `deterministic` を復元。

## 4. 較正（実装マージ後、コード変更なし）

結果は §7.13（プローブ上限 6k、推奨 N = 1,200,000 = `--fixed-nodes` の既定値）。

1. **時間モードの観測**: 開局スイート `--max-games=100`（hard、jobs=5）で `pre_search_nodes` / `probe_nodes` / `stats.nodes` の分布（中央値・p90・p99）を取る → `pre_vcf_nodes` / `pre_vct_nodes` / `demote_vcf_nodes` / `probe_vct_nodes` の初期値（中央値〜p75）を決めて焼く。
2. **予算の見直し**: 手順 1 の `pre_search_nodes` 分布を見て、`VCT_PRE_NODES_DETERMINISTIC=20k`（時間モードの 300 ms より大きい可能性）を先に調整する。N が事前探索の消費より小さいと主探索は depth 1 のみで返る（着手は必ず出る）ので、N の下限は事前探索の p90 以上。
3. **N のスイープ**: プローブ計上後は N の意味が変わる（現行計上 p50 68k / mean 126k / p90 317k は参考値）。手順 1 の `nodes + probe_nodes` 分布からスイープ範囲を決め、3 点 × 100 局。指標は `performanceStats.avgDepth`（depth 0 込み。時間モードは 4.0〜4.25、探索手のみは 6.1）と**事前探索手を除いた深度分布**・ノード分布（p50/p90）の一致（廃止。固定 N は上限であって消費量ではないため深さ一致は指標にならない。§7.13）。
4. **時間 vs 固定の混合対局**（強さの同等性を直接示す）: `development` 同一コミットで A=時間モード、B=`--fixed-nodes-b=N`、416 局。Elo ≈ 0 になる N を推奨既定にする。
5. **決定性スモーク（負荷を変える）**: A=B 同一コミット、`--fixed-nodes=N --openings=… --max-games=40` を **jobs=2 と jobs=8** で 1 回ずつ走らせ、`--compare` で棋譜・1 手ごとの nodes・score が完全一致、全ペア 1-1、abort 0。
6. **陽性対照**: `development` vs `--max-depth-b=5` を時間モードと固定ノードで各 416 局。両モードで同方向・有意に検出できること。

## 5. 運用規則・注意

- **時間モードの唯一の挙動変更（実質バグ修正）**: 旧コードは事前探索の親 600 ms が尽きた後の段（VCF/VCT）に `child().time_limit == 0` を渡していたため、その段が壁時計無制限（10 s の絶対デッドラインのみ）で走っていた。`…WithParent` 化で `exhausted` が伝播し即 null になる。壁時計依存の稀な経路なのでゴールデンでは検出不能。ビット不変の例外として記録する。

- **固定ノードで測れるもの／測れないもの**:
  - 測れる: eval 品質、枝刈り・ordering の「ノードあたりの質」。
  - 乖離する（時間モード必須）: (1) ノード単価を変える変更（eval 機能追加・incremental eval・ordering コスト）は固定ノードで**過大評価**される。(2) `stats.nodes` の計上点や `TimeLimiter.bump` の位置を変える変更（実効 N が変わる）。(3) 時間管理（dynamic time / loop_deadline 80% / Time Pressure Fallback）。(4) VCF/VCT の速度改善（時間予算がノード予算に置き換わるので出ない）。
  - 規則: eval 品質の PR は固定ノードで判定し、リリース前に時間モードで 1 回確認。上記 (1)〜(4) に触る PR は時間モード必須。
- **推奨 N=1.2M は jobs=5 の負荷下の hard と Elo 同等**（§7.11）。無負荷の製品 hard はより多くのノード（p99 ≈ 2.5M）を使うので固定 1.2M より強い。固定ノードは相対比較専用で、製品強度の絶対値の代理にはしない。
- 検出力（A≠B のときに狭い CI で符号を当てる）は §4 手順 6 の陽性対照で検証中（§7.14 に追記予定）。
- `--fixed-nodes` は本 PR 以降のコミット同士のみ。ノード計上規則が変わる PR（#89 / #136 / 本 PR）を跨ぐ比較は時間モード。
- NPS の定義が変わる（決定的モードはプローブ込み）。`performanceStats` の NPS 比較は同一モード同士に限定。
- gate0-bench / profile-review の `time_limit=0` は従来の `no_time_limit`（事前探索 600 ms 壁時計・プローブ無制限）のまま。決定的に測りたければ `setDeterministicMode(true)` を使う（gate0-bench に `--deterministic` を追加してよい。過去の gate0 結果と数値は比較不可になる旨を注記）。
- 反復深化ループ先頭の `node_count_exceeded` チェックが `!no_time_limit` ブロック内にあり、予算超過後も次深度に入って即 abort で戻る。結果は同じで無駄なだけ。本 PR では触らない（時間モード不変を優先）。

## 6. 進め方

- 実装は Zig（§2.1〜2.4、§3-1〜6）と TS（§2.5、§3-7〜11）でサブエージェントを分ける。私が設計・diff 精査。/review 3 観点 → development にマージ。
- 較正（§4）は実装マージ後にバックグラウンドで回し、結果を §7 に追記。

## 7. 結果（追記予定）

## 8. 後続課題（レビュー提案・本 PR では未対応）

SOLID レビュー（実装後）の提案で、動作に影響しないため別 PR に回すもの。

1. **commit-bench.ts / weight-bench.ts の重複**: `parsePositiveIntOrExit` / `resolveFixedNodesOrExit` / `searchFeaturesA/B` の telemetry 読み / `valid` 算出 / abort 一覧レポートが両ファイルにほぼ同文（各 ~80 行）。`fixedNodesCli.ts` 等に `resolveFixedNodesOrExit` / `readPairSearchFeatures` / `reportInvalidRun` として集約する。
2. **`policy.deterministic` 分岐の散在**: `search.zig` / `minimax.zig` で「決定的なら時間 0」を各所で書いている。`BudgetPolicy` に `*_time` を持たせれば `deterministic` bool は「stats.nodes に計上するか」と `no_time_limit` 導出だけに減る。
3. **小さな DRY / 責務**: `gate0-bench.ts` と worker に手書きされた `typeof === "function"` 判定を `deterministicSupport.readSearchFeatures` / `wasmSearchStats` に寄せる。`BridgeCustomParams.deterministic` が `DifficultyParams` に混入する（無害）ので worker で分離する。`deadline.exceededAt` が `g_hit` を立てる副作用付き述語である旨をコメントに明示する。
4. **較正後レビュー（2026-09-07）の提案**:
   - `readStats(wasm)` が compare-modes / gate0-bench / cpu-bridge-worker の 3 箇所に重複。`wasmSearchStats.ts` に集約する。
   - result buffer（着手・score・深さ）のデコードが 5 箇所に重複。同じく共通化する。
   - `chargeChild` の `inherited` 判定を呼び出し側ではなく `child()` 側に持たせる。
   - `--fixed-nodes` の値なし対応で commit-bench / weight-bench の分岐が増えた。`matchFixedNodesFlag` に寄せる。
   - threatProbe の VCT 前早期 return（親の残り予算が尽きている）を `probe_cap_hits` に数えるか決める（現状は数えない）。
   - compare-modes の `--jobs` 並列化（`--verify` 付きだと 1 手あたり 4M × 2 で遅い）。

### 7.1 手順 1: 時間モードの観測（2026-09-06、7d44b9c 自己対局 100 局、hard、jobs=5、27 分）

JSON: `bench-results/commit-bench-2026-09-06T09-35-21-178Z.json`。2,130 手（事前探索即決 807 手 = 38%、探索手 1,323 手）。集計は scratchpad/calib-dist.mjs（手ごとの `stats.preSearchNodes` / `probeNodes` から）。

| 探索手のみ（depth>0）           | p50   | p75    | p90    | p99    | mean  |
| ------------------------------- | ----- | ------ | ------ | ------ | ----- |
| `nodes`（主探索、プローブ除く） | 62k   | 132k   | 312k   | 916k   | 122k  |
| `preSearchNodes`                | 262   | 28k    | 59k    | 86k    | 16k   |
| `probeNodes`                    | 556k  | 1.43M  | 1.68M  | 2.35M  | 788k  |
| `nodes + probeNodes`            | 864k  | 1.56M  | 1.80M  | 2.46M  | 910k  |
| 思考時間 ms                     | 6,228 | 10,001 | 10,003 | 10,005 | 5,524 |

即決手（depth 0）: `preSearchNodes` p50 1 / p90 8.8k / p99 64k / max 82k。深さ分布 {0: 807, 4: 55, 5: 323, 6: 253, 7: 692}。avgDepth 3.85（depth 0 込み）。

読み取り:

- **脅威プローブが仕事の 9 割**: 探索手では `probeNodes` の中央値が主探索 `nodes` の 9 倍。決定的モードで N を「主探索のノード数」の感覚（p50 62k）で決めるとプローブ込みでは桁が足りない。N は `nodes + probeNodes` の分布で決める（p50 0.86M、p90 1.8M）。
- **事前探索の予算**: 親 40k（`PRE_SEARCH_NODE_BUDGET_DETERMINISTIC`）は探索手の p80〜p85 相当。p90 は 59k、p99 86k、最大 194k。即決手の p99 は 64k で 40k を超える（即決できるはずの手が決定的モードでは即決できずに主探索に落ちる割合が数%出る）。→ 手順 2 で **親 80k**（p99 相当）に引き上げる案。VCT 20k の内訳は本手順では分からない（pre_search_nodes は合計のみ）。
- **時間張り付き**: 探索手の 25% 以上が 10 s の絶対デッドラインに当たっている（p75 = 10,001 ms）。以前の観測 18% より多い（jobs=5 の負荷）。時間モードのばらつき源として大きい。

手順 3 の N スイープ候補: **0.5M / 0.9M / 1.8M**（p25 付近 / p50 / p90）。

### 7.2 手順 2: 予算の見直し（保留）

`preSearchNodes` は合計しか記録していないので VCT 20k の内訳は判断できない（子予算の合計は VCF 10k + 相手 VCF 3k + VCT 20k = 33k、時間モードの p99 86k はミセ VCF か VCT の壁時計分）。手順 4 の混合対局で Elo が出るまで既定値は据え置く。

### 7.3 手順 3: N スイープ（2026-09-06、7d44b9c 自己対局 各 100 局、`--fixed-nodes=N`、jobs=7）

決定的モードでは `stats.nodes` にプローブが含まれる（N と直接比較できる）。

|                                 | 時間モード（§7.1）       | N=0.5M                   | N=0.9M                   | N=1.8M                 |
| ------------------------------- | ------------------------ | ------------------------ | ------------------------ | ---------------------- |
| 探索手の深さ分布 4/5/6/7（%）   | 4.2 / 24.4 / 19.1 / 52.3 | 9.5 / 23.3 / 17.1 / 50.1 | 2.8 / 10.5 / 19.4 / 67.3 | 0.1 / 1.7 / 8.7 / 89.5 |
| 探索手の平均深さ                | 6.20                     | 6.08                     | 6.51                     | 6.83                   |
| avgDepth（depth 0 込み）        | 3.85                     | 3.89                     | 4.23                     | 4.69                   |
| 即決（depth 0）率               | 38%                      | 36%                      | 35%                      | 32%                    |
| 探索手の思考時間 p50 / p90 (ms) | 6,228 / 10,003           | 3,615 / 7,262            | 4,695 / 11,499           | 5,300 / 21,295         |
| 100 局の所要                    | 27 分（jobs=5）          | 15 分                    | 20 分                    | 35 分                  |
| abort / valid                   | —                        | 0 / true                 | 0 / true                 | 0 / true               |

- 探索手の平均深さを時間モード（6.20）に合わせる補間: **N ≈ 0.6M**（0.5M の 6.08 と 0.9M の 6.51 の間）。
- N=0.5M は深さ 4 止まりが時間モードの 2 倍以上（9.5% vs 4.2%）、N=0.9M 以上は深さ 7 が多すぎる。
- 決定性: 3 本とも 50 ペア全て同一進行（pentanomial dd=50）、abort 0。
- 手順 4（混合対局）は **N=600k** で実施。

### 7.4 手順 4: 時間 vs 固定 0.6M の混合対局（2026-09-06、7d44b9c、416 局、jobs=5、91 分）

JSON: `bench-results/commit-bench-2026-09-06T12-23-21-347Z.json`。A=時間モード、B=`--fixed-nodes-b=600000`。abort 0。

- **ペア Elo（A 視点）+25.9 [+2.4, +49.7]** = 時間モードが有意に強い。pentanomial ll 18 / ld 3 / dd 150 / wd 4 / ww 33。
- 固定側の方が深い（avgDepth 4.15 vs 3.88、思考時間 2.1 s vs 3.5 s）のに弱い。
- 内訳（探索手のみ、中央値）: 時間モード = 主探索 60k / プローブ 429k（p90 1.46M）/ 事前探索 p90 53k、**プローブ比率 0.84**。固定 0.6M = 主探索込み 524k / プローブ 222k（p90 531k）/ 事前探索 p90 20k、**プローブ比率 0.39**。
- 結論: 深さを合わせても強さは合わない。決定的モードのプローブ上限 2k と事前探索の予算（親 40k・VCT 20k）が戦術（追い詰め検出）を削っている。N の前に **予算を時間モードのプローブ比率に合わせる**必要がある（手順 2 に戻る）。

### 7.5 手順 2（再）: 予算の引き上げ

`PROBE_VCT_NODES_DETERMINISTIC` 2k → **20k**、`PRE_SEARCH_NODE_BUDGET_DETERMINISTIC` 40k → **80k**、`VCT_PRE_NODES_DETERMINISTIC` 20k → **40k**。目標はプローブ比率 ≈ 0.8、事前探索 p90 ≈ 50k。この予算で N=0.9M / 1.5M をスイープして深さと比率を見てから混合対局をやり直す。

### 7.6 手順 3（再）: 新予算での N スイープ（2026-09-06、7db7e5c 自己対局 各 100 局、jobs=7）

|                                               | 時間モード           | N=0.9M（新予算）    | N=1.5M（新予算）     |
| --------------------------------------------- | -------------------- | ------------------- | -------------------- |
| プローブ比率（`probe / nodes` 中央値 / 平均） | 0.84 / 0.78          | 0.89 / 0.83         | 0.90 / 0.83          |
| 事前探索 p90                                  | 53k                  | 40k                 | 40k                  |
| 探索手の深さ分布 4/5/6/7                      | 55 / 323 / 253 / 692 | 494 / 82 / 90 / 662 | 374 / 178 / 78 / 720 |
| 探索手の平均深さ                              | 6.20                 | 5.69                | 5.85                 |
| 探索手の思考時間 p50 / p90 (ms)               | 6,228 / 10,003       | 5,358 / 7,693       | 7,742 / 12,632       |
| 100 局の所要                                  | 27 分（jobs=5）      | 15 分               | 23 分                |

- プローブ比率は時間モードに一致した（0.84 → 0.89）。事前探索 p90 は 40k（親 80k だが子予算 VCF 10k + 相手 VCF 3k + VCT 40k の合計に近い）。
- 深さ分布は **二峰**（4 と 7）になる。深さ 4 止まりの手はプローブが 5 段目で予算を食い尽くす手で、時間モードでは絶対 10 s（p99 2.5M ノード）まで使って 5〜6 に到達している。固定 N は時間モードの広い分布を再現できないので、深さ分布の一致ではなく **強さの一致（手順 4）で N を決める**。
- 手順 4（再）: A=時間モード vs B=固定 **1.5M**（新予算）、416 局、jobs=5 を実行中。Elo ≈ 0 なら採用、固定側がまだ弱ければ 2.5M。

### 7.7 手順 4（再）: 時間 vs 固定 1.5M（新予算）の混合対局（2026-09-06、7db7e5c、416 局、jobs=5、111 分）

JSON: `bench-results/commit-bench-2026-09-06T14-57-08-162Z.json`。abort 0。

- **ペア Elo（時間モード視点）+59.9 [+32.8, +87.8]**。旧予算 0.6M の +25.9 より **悪化**。pentanomial ll 17 / ld 5 / dd 129 / wd 4 / ww 53。
- avgDepth 3.85 vs 3.83、思考時間 3.5 s vs 3.6 s で、深さも時間も同じなのに 60 Elo 弱い。
- 読み取り: プローブ比率を合わせても強さは合わない。時間モードのプローブは **VCT 50 ms / VCF 20 ms の時間上限**（`PROBE_VCT_TIME_LIMIT`）で、超過は「追い詰めなし」扱い。決定的モードの 20k は 1 プローブあたりの消費が時間モードより大きく（固定 1.5M の probe p50 817k vs 時間モード 429k、深さは浅い）、プローブに払い過ぎて主探索が浅くなる一方、2k は偽陰性が多すぎたと解釈できる。**1 プローブあたりのノード数と上限到達率を時間モードで計測**して合わせる（stats に `probe_calls` / `probe_cap_hits` を追加、§7.8）。

### 7.8 プローブ統計（`probe_calls` / `probe_cap_hits`、05bf295、各 100 局）

|                                                  | 時間モード（VCT 50 ms） | 固定 1.5M / 上限 20k |
| ------------------------------------------------ | ----------------------- | -------------------- |
| プローブ回数/手 p50 / p90                        | 348 / 704               | 227 / 617            |
| ノード/プローブ（全体平均）                      | **2,009**               | 2,862                |
| 上限到達率（全体）                               | **18.8%**               | 10.2%                |
| 完了深さ 4 の手: 主探索 / プローブ / 回数（p50） | 373k / 928k / 372       | 47k / 1,437k / 228   |
| 完了深さ 7 の手: 主探索 / プローブ / 回数（p50） | 40k / 165k / 189        | 38k / 284k / 175     |

- 上限 20k は 1 プローブあたりの消費が時間モードより大きく（深さ 4 止まりの手では 6.3k/回）、少ない回数で予算を食い尽くして主探索が深さ 4 で止まる（374 手 vs 時間モード 62 手）。時間モードの 50 ms 上限は高価なプローブを早く切り、安いプローブを多数回す配分になっている。
- 逆に上限 2k（§7.4）は偽陰性が多すぎた。時間モードの平均 2,009・到達率 18.8% に合わせるなら **上限 ≈ 6k**（到達 18.8% × 6k + 残り平均 ≈ 1.1k で平均 2k）。
- 次: `PROBE_VCT_NODES_DETERMINISTIC = 6000` で固定 100 局を計測し、到達率 ≈ 19%・平均 ≈ 2k・深さ分布の一致を確認してから混合対局。

### 7.9 プローブ上限 6k での計測（a69063b、各 100 局、jobs=7）

|                             | 時間モード           | 6k / N=1.0M           | 6k / N=1.5M          |
| --------------------------- | -------------------- | --------------------- | -------------------- |
| ノード/プローブ（全体平均） | 2,009                | 1,415                 | 1,543                |
| 上限到達率                  | 18.8%                | 19.7%                 | 22.1%                |
| プローブ回数/手 p50         | 348                  | 318                   | 435                  |
| 探索手の深さ分布 4/5/6/7    | 62 / 329 / 243 / 711 | 114 / 380 / 158 / 676 | 16 / 242 / 322 / 772 |
| 探索手の平均深さ            | 6.19                 | 6.05                  | 6.37                 |

- 到達率は一致（19〜22%）。深さ分布の二峰は消え、時間モードと同じ形になった。
- 6k は到達率だけが一致（平均ノード/プローブは 1.4〜1.5k で時間モードの 2.0k より 25% 低い）。4k / 8k は未検証。
- 深さとプローブ回数の補間で **N ≈ 1.2M**。手順 4（3 回目）: A=時間モード vs B=固定 1.2M（6k）、416 局、jobs=5 を実行中。

### 7.10 局面レベルの比較（`pnpm compare:modes`、182d22d）

→ この節の結論（N は時間モードの最大消費に置く）は §7.12 で撤回。採用は 1.2M（§7.13）。

混合対局 JSON の時間モード側の着手と、同じ局面を固定モード（1.2M / 6k）で探索した着手を突き合わせる（`--verify` で両着手後の局面を N=4M で参照評価）。先頭 20 手のスモーク: 一致 17/20。不一致 3 件はすべて **固定側が N を使い切り、プローブが N の 90〜97% を消費して主探索が深さ 4 で止まった局面**（例: `F8 I9 H8 I7 F6 J7 H6 I8 I6 G6 G7 I5` 黒番、時間 E7 = 勝ち筋 vs 固定 H5 = 負け筋）。N を使い切らない手（30〜70 万）はすべて一致・深さ 7。

**結論（較正の前提の誤り）**: 固定 N は上限であって消費量ではない。静かな局面は深さ 7（max_depth）で早く終わり N を使い切らないので、深さの平均や分布を合わせる意味はなかった。戦術的局面では時間モードが絶対上限 10 s（§7.1: nodes+probe p99 2.46M、最大 3.24M）まで使うのに対し、固定 1.2M はその半分で打ち切られる。**N は時間モードの最大消費（p99 ≈ 2.5M）に置く**。手順 4（4 回目）: A=時間モード vs B=固定 **2.5M**（6k）。

### 7.11 手順 4（3 回目）: 時間 vs 固定 1.2M（プローブ 6k）の混合対局（a69063b、416 局、jobs=5、109 分）

JSON: `bench-results/commit-bench-2026-09-06T18-28-18-420Z.json`。abort 0。

- **ペア Elo（時間モード視点）+5.8 [−15.3, +27.0]** = 有意差なし。pentanomial ll 10 / ld 6 / dd 174 / wd 3 / ww 15（84% のペアが同一結果）。途中 112 局では +37 だったが収束した（100 局程度の途中経過は当てにならない）。
- avgDepth 3.97 vs 4.05、思考時間 3.7 s vs 3.2 s。
- 経過: 2k/0.6M = +25.9（有意）→ 20k/1.5M = +59.9（有意）→ **6k/1.2M = +5.8（有意差なし）**。プローブ上限を時間モードの到達率に合わせることが効いた。
- 手順 4（4 回目）: §7.10 の仮説（N は時間モードの最大消費 2.5M に置く）を確認するため A=時間 vs B=固定 **2.5M**（6k）を実行中。2.5M で固定側が同等以上なら、推奨は「6k / 2.5M」（戦術的局面で時間モードと同じ予算）か「6k / 1.2M」（所要時間が短い）を用途で使い分ける。

### 7.12 手順 4（4 回目）: 時間 vs 固定 2.5M（プローブ 6k）の混合対局（a69063b、416 局、jobs=5、135 分）

JSON: `bench-results/commit-bench-2026-09-06T20-43-48-572Z.json`。abort 0。

- **ペア Elo（時間モード視点）−53.0 [−79.8, −26.9]** = 固定 2.5M の方が有意に強い。pentanomial ll 46 / ld 9 / dd 133 / wd 2 / ww 18。avgDepth 4.04 vs 4.30、思考時間 3.6 s vs 4.8 s。
- 固定側の強さは N に対して単調: 1.2M で +5.8（同等）、2.5M で −53（固定が強い）。**Elo ≈ 0 は N ≈ 1.2〜1.3M**。「時間モードの最大消費に置く」（§7.10）は行き過ぎ。固定 N は全手に一律に効くので、2.5M は時間モードでは上位 1% の手しか得られない予算（§7.1: p99 2.46M）を戦術的局面のすべてに与えることになる。時間モードの戦術手の実効予算の中央値は 0.9M 前後なので、Elo 同等点はその実効平均に近い 1.2M になる。

### 7.13 較正の結論（2026-09-07）

| 項目                                                                   | 値                                                        | 根拠                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `PROBE_VCT_NODES_DETERMINISTIC`                                        | **6,000**                                                 | 時間モードの上限到達率 18.8% / 平均 2,009 ノードに一致（§7.8〜7.9） |
| `PRE_SEARCH_NODE_BUDGET_DETERMINISTIC` / `VCT_PRE_NODES_DETERMINISTIC` | 80k / 40k                                                 | 事前探索 p90 40k（時間モード 53k）。§7.2 の据え置きから引き上げ     |
| 推奨 N（時間モード hard・jobs=5 と同等）                               | **1,200,000**                                             | 混合対局 +5.8 [−15.3, +27.0]（§7.11）                               |
| 参考                                                                   | 2.5M は時間モードより +53 強い（§7.12）、0.6M（2k）は −26 |

- 使い方: `--fixed-nodes=1200000`（既定値もこれにする）。416 局 jobs=7 で約 1〜1.5 時間（100 局実測 1.0M 15 分 / 1.5M 21 分からの外挿）、決定性により負荷に依らず同一結果。
- 教訓: (1) 固定 N は上限であって消費量ではない。深さ平均の一致で N を決めるのは誤り。最大消費（p99）に置く説（§7.10）も誤り（§7.12: 上位 1% の予算を全手に与えて +53 強くなる）。強さの一致（混合対局）でしか決まらない。(2) プローブの時間上限は「高価なプローブを切り、安いプローブを多数回す」配分で、ノード上限を大きくすると逆効果（20k で −60）。到達率を合わせるのが正解。(3) 100 局程度の途中経過（+37）は収束前で当てにならない。
- 未実施: 手順 5（jobs=2 vs 8 の決定性スモーク）は §3 の実装時スモーク（jobs=1/2/4 で完全一致）と各スイープの全ペア同一結果で代替。手順 6（陽性対照 depth5）は残す。
