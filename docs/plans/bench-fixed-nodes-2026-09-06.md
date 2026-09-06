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

1. **時間モードの観測**: 開局スイート `--max-games=100`（hard、jobs=5）で `pre_search_nodes` / `probe_nodes` / `stats.nodes` の分布（中央値・p90・p99）を取る → `pre_vcf_nodes` / `pre_vct_nodes` / `demote_vcf_nodes` / `probe_vct_nodes` の初期値（中央値〜p75）を決めて焼く。
2. **予算の見直し**: 手順 1 の `pre_search_nodes` 分布を見て、`VCT_PRE_NODES_DETERMINISTIC=20k`（時間モードの 300 ms より大きい可能性）を先に調整する。N が事前探索の消費より小さいと主探索は depth 1 のみで返る（着手は必ず出る）ので、N の下限は事前探索の p90 以上。
3. **N のスイープ**: プローブ計上後は N の意味が変わる（現行計上 p50 68k / mean 126k / p90 317k は参考値）。手順 1 の `nodes + probe_nodes` 分布からスイープ範囲を決め、3 点 × 100 局。指標は `performanceStats.avgDepth`（depth 0 込み。時間モードは 4.0〜4.25、探索手のみは 6.1）と**事前探索手を除いた深度分布**・ノード分布（p50/p90）の一致。
4. **時間 vs 固定の混合対局**（強さの同等性を直接示す）: `development` 同一コミットで A=時間モード、B=`--fixed-nodes-b=N`、416 局。Elo ≈ 0 になる N を推奨既定にする。
5. **決定性スモーク（負荷を変える）**: A=B 同一コミット、`--fixed-nodes=N --openings=… --max-games=40` を **jobs=2 と jobs=8** で 1 回ずつ走らせ、`--compare` で棋譜・1 手ごとの nodes・score が完全一致、全ペア 1-1、abort 0。
6. **陽性対照**: `development` vs `--max-depth-b=5` を時間モードと固定ノードで各 416 局。両モードで同方向・有意に検出できること。

## 5. 運用規則・注意

- **時間モードの唯一の挙動変更（実質バグ修正）**: 旧コードは事前探索の親 600 ms が尽きた後の段（VCF/VCT）に `child().time_limit == 0` を渡していたため、その段が壁時計無制限（10 s の絶対デッドラインのみ）で走っていた。`…WithParent` 化で `exhausted` が伝播し即 null になる。壁時計依存の稀な経路なのでゴールデンでは検出不能。ビット不変の例外として記録する。

- **固定ノードで測れるもの／測れないもの**:
  - 測れる: eval 品質、枝刈り・ordering の「ノードあたりの質」。
  - 乖離する（時間モード必須）: (1) ノード単価を変える変更（eval 機能追加・incremental eval・ordering コスト）は固定ノードで**過大評価**される。(2) `stats.nodes` の計上点や `TimeLimiter.bump` の位置を変える変更（実効 N が変わる）。(3) 時間管理（dynamic time / loop_deadline 80% / Time Pressure Fallback）。(4) VCF/VCT の速度改善（時間予算がノード予算に置き換わるので出ない）。
  - 規則: eval 品質の PR は固定ノードで判定し、リリース前に時間モードで 1 回確認。上記 (1)〜(4) に触る PR は時間モード必須。
- `--fixed-nodes` は本 PR 以降のコミット同士のみ。ノード計上規則が変わる PR（#89 / #136 / 本 PR）を跨ぐ比較は時間モード。
- NPS の定義が変わる（決定的モードはプローブ込み）。`performanceStats` の NPS 比較は同一モード同士に限定。
- gate0-bench / profile-review の `time_limit=0` は従来の `no_time_limit`（事前探索 600 ms 壁時計・プローブ無制限）のまま。決定的に測りたければ `setDeterministicMode(true)` を使う（gate0-bench に `--deterministic` を追加してよい。過去の gate0 結果と数値は比較不可になる旨を注記）。
- 反復深化ループ先頭の `node_count_exceeded` チェックが `!no_time_limit` ブロック内にあり、予算超過後も次深度に入って即 abort で戻る。結果は同じで無駄なだけ。本 PR では触らない（時間モード不変を優先）。

## 6. 進め方

- 実装は Zig（§2.1〜2.4、§3-1〜6）と TS（§2.5、§3-7〜11）でサブエージェントを分ける。私が設計・diff 精査。/review 3 観点 → development にマージ。
- 較正（§4）は実装マージ後にバックグラウンドで回し、結果を §7 に追記。

## 7. 結果（追記予定）
