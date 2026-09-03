# 設計メモ: CPU 強度計測の高精度化・効率化（2026-09-04）

改訂 v2（/review 3 観点の指摘反映。v1 からの主な変更: PR C を別設計に分離、検証計画を再現性ベースに変更、ペア統計の型・SSoT を整理）。

## 0. 結論（先に）

強さ・速度の施策はほぼ全て commit-bench の判定に依存するが、**現行ベンチの実効サンプル数は名目 416 局の 6 割程度**で、狙う効果量（+10〜30 Elo）が信頼区間（±33 Elo）の内側に沈む。まず計測を直す。

| PR  | 内容                                                                    | 期待効果                                                                                                              |
| --- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A   | ペア統計（pentanomial）による Elo / CI / SPRT。旧結果 JSON の再集計 CLI | 同一局数で半値幅 33→26〜30 Elo（旧 JSON の再集計。重複棋譜を含むため目安）。実装のみ・対局不要                        |
| B   | 開局スイート（ブック由来の 7 石局面、均衡フィルタ済み）と `--openings`  | 重複棋譜の排除（416 局中 distinct 231〜267 → 416）。randomFactor 不要（時間制限モードなので負荷依存は残る＝準決定的） |
| C   | 固定ノードモード（別設計、本メモ §2.3 は要件のみ）                      | 負荷ノイズ排除・jobs をコア数まで・完全再現。**Zig 側の変更が前提**で、A/B の後に着手                                 |

強さ・速度の施策（hard 10s→5s の検証、eval データ側の texel-r4、ビット一致の高速化）は **A/B の後**に、新ベンチで判定する。時間制限の変更（10s→5s）は固定ノードでは原理的に測れないので、**時間制限モードを既定として残す**。

## 1. 現状の実測（bench-results の 2026-08 の JSON 13 本）

### 1.1 Elo は 1 局単位の三項分布、対局はペア構造

- `scripts/lib/match.ts` の `buildJushuTasks` は「セット × 26 珠型 × 2 色」のタスクを作る＝各珠型で色を入れ替えた **ペア**。
- `scripts/lib/eloDiff.ts` / `sprt.ts` は WDL を 1 局ずつ独立と見なす三項分布。ペアの相関（開局の色有利）を無視しているので CI が過大。
- 珠型ごとの黒勝率は 17%（新月）〜83%（松月）。26 珠型中 7 つが黒 80% 前後。

### 1.2 棋譜の重複（最重要）

同一珠型を 8 セット繰り返し、差は randomFactor=0.02 の近傍ランダム手だけなので、棋譜が大量に重複する。

| bench（416 局）  | distinct 開局後@8 | 開局後@12 | 開局後@16 | 完全 distinct |
| ---------------- | ----------------- | --------- | --------- | ------------- |
| 2026-08-23T05-55 | 130               | 150       | 181       | 231           |
| 2026-08-23T08-14 | 126               | 153       | 184       | 232           |
| 2026-08-23T12-32 | 117               | 162       | 191       | 267           |

（`pnpm bench:reanalyze` の `benchGameStats` による。「開局後@n」は **開局石（isOpening）を除いた** 開局後 n 手の一致で、先後割当 isABlack もキーに含める＝同じ手順でも A が黒か白かで別の局。開局石を除くのは PR B の 7 石開局でも同じ意味になるようにするため。v1 の表は開局 3 手込みの先頭 n 手で数えていたため数値が異なる。）52 通りの（珠型 × 色）から 8 セットで開局後 8 手目時点の進行が 120〜130 通りしかない。半数近くが同一または終盤まで同一の棋譜で、独立サンプルとして数えられない。「個別 PR の +30/+22 が統合ベンチで再現しない」現象はこれで説明がつく。

### 1.3 ペア統計の再集計（pentanomial、珠型でペアリング）

| bench            | N   | 三項 Elo [CI]        | 半値幅 | ペア Elo [CI]        | 半値幅 |
| ---------------- | --- | -------------------- | ------ | -------------------- | ------ |
| 2026-08-22T12-02 | 415 | +6.7 [−26.7, +40.2]  | 33.4   | +5.9 [−20.2, +32.0]  | 26.1   |
| 2026-08-22T16-24 | 416 | +3.3 [−30.1, +36.9]  | 33.5   | +3.3 [−25.2, +32.0]  | 28.6   |
| 2026-08-23T00-46 | 319 | −21.8 [−60.1, +16.0] | 38.1   | −20.8 [−47.5, +5.7]  | 26.6   |
| 2026-08-23T08-14 | 416 | −2.5 [−35.9, +30.8]  | 33.4   | −2.5 [−28.1, +23.0]  | 25.6   |
| 2026-08-23T12-32 | 416 | +20.1 [−13.1, +53.6] | 33.3   | +20.1 [−11.8, +52.3] | 32.1   |

注意: この再集計は重複棋譜（同一局＝情報ゼロ）を独立ペアとして数えているので、**実精度としては依然過小**。PR B 前の数字は目安に留める。pentanomial の中央（1 勝 1 敗）が 208 ペア中 108〜145 あるのは、引き分けがほぼ無い連珠では等力でも 5 割が 1-1 になるため、異常ではない。

### 1.4 時間・ノードの実態（2026-08-23T12-32、hard）

| 指標                       | 値                              |
| -------------------------- | ------------------------------- |
| 1 局の平均手数             | 30.3                            |
| 平均思考時間（探索手）     | 3,767 ms                        |
| 10 秒上限に張り付いた手    | 2,055 / 11,343（18%）           |
| depth 7（上限）で終えた手  | 4,072（36%）、中央値 50k ノード |
| depth 0（事前探索即決）    | 3,517（31%）                    |
| ノード数 p50 / mean / p90  | 36k / 99k / 302k                |
| 416 局の所要時間（jobs=5） | 8,852 s ≈ 2.5 h                 |

時間制限と深さ上限が混在した領域で、マシン負荷が深度と棋譜を変える（seed 再現性も負荷依存、PR #109 の注記どおり）。

## 2. 設計

### 2.1 PR A: ペア統計

**型（`scripts/types/ab.ts`、commit-bench / weight-bench で共用）**

```ts
export interface PentanomialCount {
  ll: number;
  ld: number;
  dd: number;
  wd: number;
  ww: number;
} // ペア得点 0 / 0.25 / 0.5 / 0.75 / 1
export interface PairedStats {
  pairs: number; // 完成ペア数
  unpaired: number; // 相方が無い局数
  pentanomial: PentanomialCount;
  elo: EloDiffResult; // ペア得点の平均・分散から
  sprt: SPRTState | null; // ペア LLR による判定（停止に使ったもの）
}
```

- `CommitBenchResult` に `paired?: PairedStats` を追加（optional＝後方互換）。`sprt` フィールドは **停止に使った判定＝ペア**を入れ、旧三項判定は `sprtTrinomial?` に残す。`eloDiff`（三項）は残す。
- weight-bench の結果もこの型を使い、`games` を保存する（再集計対象にするため）。

**新規 `scripts/lib/pairedStats.ts`（純粋関数、TDD）**

```ts
export interface PairableGame {
  pairId: string;
  isABlack: boolean;
  winner: "A" | "B" | "draw";
}
export function toPairableGames(
  games: { pairId?: string; jushuName: string; isABlack: boolean; winner }[],
): PairableGame[];
// pairId があればそれ、無ければ jushuName を pairId に（旧 JSON 規則。並列実行では出現順が
// タスク順でないので unpaired が出うる）
export function buildPairs(games: PairableGame[]): {
  pairs: PairScore[];
  unpaired: number;
};
// 同一 pairId の A黒/A白を出現順で zip
export function countPentanomial(pairs: PairScore[]): PentanomialCount;
export function estimatePairedElo(pairs: PairScore[]): EloDiffResult;
export function pairedLLR(pairs: PairScore[], config: SPRTConfig): number;
export function updatePairedSPRT(
  pairs: PairScore[],
  config: SPRTConfig,
): SPRTState;
export function computePairedStats(
  games,
  config: SPRTConfig | null,
): PairedStats;
export function formatPairedStats(stats: PairedStats): string;
```

- Elo 変換は `eloDiff.ts` に集約: `scoreToElo` / `eloToScore` を export し、`scoreIntervalToElo(mean, se)` で「score ± 1.96·SE → EloDiffResult」を三項・ペアで共用（sprt.ts の私有 `eloToScore` も移す）。
- ペア LLR は正規近似 `LLR = N·(s1−s0)·(2s̄−s0−s1)/(2σ²)`（fastchess と同じ）。σ² は観測ペア得点の分散に**フロア 0.05** を掛けたもの `max(観測 σ², 0.05)`（LLR と CI の両方）。根拠: 決着局のみのモデルでペア分散は p(1−p)/2、p≈0.11 の極端な色有利でも ≈0.05。観測分散がこれを下回るのはサンプル不足で、生分散だと LLR が発散して誤停止する（99 dd + 1 ww で −28.8 → H0）。**ガード**: ペア数 < 16 のときは LLR=0（判定 continue）、CI は ±∞。
- 既存の三項関数は残し、表示は「三項（旧）／ペア（新）」並記。**SPRT の停止判定はペア LLR**（完成ペアのみ。未完成ペアは待つ）。

**`scripts/lib/matchStats.ts`（新規、runMatch から統計を分離）**

- `MatchStatsTracker`: `push(result)` で wdl / pairs / 三項 Elo / ペア Elo / LLR を更新して返す純粋なアキュムレータ（単体テスト）。runMatch はこれを呼ぶだけにする（SRP）。

**`scripts/lib/match.ts`**

- `MatchTask` に `pairId: string`、`openingId: string` を追加（珠型モードでは `openingId = jushuName`、`pairId = ${set}:${jushuName}`）。
- `runMatch` は結果に `pairId` を付与し、`jushuName` には `openingId` を入れる（JSON 互換。型コメントを「開局ラベル（珠型名または開局 id）」に改める）。ステータス行にペア Elo と LLR。
- `CommitGameResult` に `pairId?: string`。

**`scripts/lib/benchGameStats.ts`（新規、純粋関数）**

- distinct 棋譜数（@8 / @12 / @16 / 完全）、色別勝率、開局別の勝敗。reanalyze と commit-bench 最終出力の両方で呼ぶ（毎回「distinct = 局数」を自動確認）。

**新規 `scripts/bench-reanalyze.ts`（`pnpm bench:reanalyze [file...]`）**

- 既存/新規の commit-bench JSON を読み、三項 vs ペア統計、pentanomial、distinct 棋譜数、色別勝率を表示。§1 の分析を恒久化する。

### 2.2 PR B: 開局スイート

**方針**: 「26 珠型 × セット反復」を「N 個の相異なる均衡開局 × 2 色」に置き換える。ランダム化は不要になる（既定 randomFactor 無し）。時間制限モードなので負荷依存は残る（完全決定性は PR C）。

**生成 `scripts/gen-opening-suite.ts`（1 回実行、成果物をコミット）**

1. 入力: `src/assets/opening-book-hard.json` の entries のうち **7 石・白番**（5,595 件、canonical 空間の盤面文字列）。hard 白 × 黒の攻めフィルタ経路で到達した実戦的局面。
2. 盤面文字列 → `Position[]`（黒 4 石・白 3 石を交互に並べた擬似手順。着手順は盤面に影響しない。禁手は局面のみで決まる）。
3. **層化抽出**（相関対策）: 7 石局面の白 3 石構成（親）は 292 通りしかなく、最大の親は 285 件の子を持つ。親ごと上限 3 件、根珠型ごとの偏りも抑えるため、候補を「根珠型 → 親 → 子」の順でラウンドロビンに並べてから評価する（seed 固定）。
4. フィルタ（この順。落ちたら次へ）:
   - (i) 白番 root スコア: hard 実機 `findBestMoveWithParams`（depth 7、timeLimit 60,000 の安全弁、maxNodes 100k）で `|score| <= 300`（活三 1000 の 3 割。ヒストグラムを見て決め、doc に記録）。事前探索が VCF/VCT を FIVE±10/20 で返すので、決着済み局面の大半はここで落ちる。
   - (ii) 白番に VCF/VCT が無い: `engine.findVCFSequence / findVCTSequence`（forcedWinCheck の予算）を白で直接呼ぶ。
   - (iii) 白の最善手（(i) の着手）後に黒の VCF/VCT が無い: `checkForcedWinAfterMove`。両方向で決着済み局面を除外。
5. **採用 600 件**で停止。8 並列 worker、1 件 5〜15 s → 20〜40 分の見込み（perf レビュー訂正値）。
6. 出力 `scripts/data/opening-suite-v1.json`: `{ version: 1, generatedAt, gitRev, weightGeneration, filter: { scoreAbsMax, nodes, ... }, openings: [{ id, root: 珠型名, parent: 白3石キー, moves: "H8 I9 ...", score }] }`。moves の表記・パースは `src/logic/gameRecordParser.ts`（`parseMove`/`formatMove`）を使う（新設しない）。
7. **スイートは v1 として固定**（hard の eval が変わっても再生成しない。比較可能性優先）。生成に使った commit と重み世代を記録。

**`--openings=<file>` / `--opening-offset=<n>`（commit-bench / weight-bench）**

- タスク生成を一本化: `buildTasks(source: OpeningSource, sets)`。`OpeningSource = { id, root?, positions: Position[] }[]`。珠型は `jushuOpenings()`（`getAllJushuNames` × `getJushuPositions`）のアダプタで供給。ペアの 2 局は隣接して出す（`--max-games` はペア境界で切る）。
- **totalGames は `tasks.length`（切り詰め後）を唯一の源**。`gamesPerSet()` は珠型モード専用に残すか廃止。
- `--openings` 指定時、`--sets` は「スイートを何周するか」。`--opening-offset=n` で n 番目の開局から使う（互いに素な部分集合での再現性検証用）。**`sets > 1` かつ randomFactor 無しは warn**（同一開局の反復は同一棋譜になりうる）。
- **`--openings` と `--book-a/--book-b` の併用はエラー**（スイートはブックの葉なので白の初手が即ブック手になり非対称）。
- 既定（未指定）は従来どおり珠型（後方互換）。
- `commit-game-runner.ts` の `openingMoves` を `Position[]`（黒から交互）に一般化。先手・後手は長さの偶奇で決まる。**タプル型前提の箇所（hangReplay / workerTelemetry / replay-hang）も変更範囲に含める**。
- 結果 JSON: `jushuName` に開局 id、`config.openings = { file, version, count, offset }` を記録。

**注記**

- canonical 座標のまま使うので候補生成の走査順・タイブレークの偏りが両者共通に乗る。強さ比較には無害だが実戦分布との差として記録。
- 擬似手順 7 手分、`DRAW_MOVE_LIMIT=70` の残り手数が 4 手減る。無視できる。
- 均衡判定を hard 自身で行う誤差は、ペアで色を入れ替えるので相殺される。

### 2.3 PR C: 固定ノード（別設計。本メモでは要件のみ）

「両側 `timeLimit=0, maxNodes=N`」だけでは決定的にならないことがレビューで判明した。

- `search.zig` の `findPreSearchMove` は `time_limit==0` を見ず、壁時計 600 ms 固定（VCF 150 / 相手 VCF 150 / VCT 300）。事前探索即決は全手の 31% で、負荷で結果が変わる。
- `minimax.zig` の `threatProbe` は `no_time_limit` だと VCT が時間もノードも無制限（`vct_nodes=0`、#137）。しかも probe の消費ノードは `ctx.stats.nodes` に計上されない。1 手が青天井になり `--move-timeout-ms` で abort → 劣勢側に偏って Elo が歪む。#147 の絶対デッドラインも `no_time_limit` では無効。

**要件（別 PR、Zig 側）**: 明示的な決定的モード（`time_limit==0` の流用ではなく専用フラグ）で、事前探索・threatProbe に固定ノード予算を与え、probe 消費を `ctx.stats.nodes` に charge する。時間制限モードの挙動はビット単位で不変（テストで固定）。ベンチ側は `buildBridgeCustomParams` をオブジェクト引数化し、`--fixed-nodes` と `--max-nodes-a/b` の併用はエラー。使える最古 commit を明記し、非対応 wasm では bridge worker が中止する。N は「平均完了深度が現行 4.25 と一致する値」（200k〜300k の見込み）で較正。ノード計上規則が同じ commit 間に限定（#89/#136 を跨ぐ比較は時間モードで）。受け入れ条件に **決定性スモーク**（A=A で 20 局を 2 回走らせ、全ペア 1-1 かつ棋譜完全一致）を含める。

### 2.4 検証（PR B の後、バックグラウンド）

「半値幅が縮んだ」はペア統計の算術的帰結であり精度向上の証拠にならない。次で判定する。

1. **再現性**: 既知の比較 **旧 main 80f1c4f vs 新 main 新 f1bdc9a**（旧結果: 三項 +20.1 [−13.1, +53.6]）を、スイート 600 開局 1 周（1,200 局、jobs=5、時間制限モード、randomFactor 無し）で走らせ、前半 300 開局と後半 300 開局（`--opening-offset`）を別々に集計して **2 つの推定が互いの CI に収まる**こと。全体 1,200 局の CI 半値幅も記録。
2. **重複の消滅**: distinct 棋譜数 = 局数（benchGameStats で自動確認）。
3. **深度・時間**: 平均深度が 4.25 から大きくずれないこと、所要時間。
4. 余力があれば **陽性対照**: hard vs `--max-depth-b=5` を新旧構成で走らせ、新構成が検出できること。

## 3. 採用しなかった案

- **Rapfi による均衡フィルタ**: GPL・ローカル限定でリポジトリに載らない。自前 hard で自己完結させる。
- **対局の途中打ち切り（adjudication）**: 短縮効果は 2〜3 割だが、eval が信用できない前提で eval による打ち切りは循環する。VCF 成立打ち切りは既に事前探索が即決しており追加効果が薄い。
- **開局を自前で列挙し直す**: ブック生成で列挙済みの 5,595 局面で十分。
- **同一コミット null テスト（統計目的）**: 決定的エンジンではペアが鏡像で常に 1-1 になり無意味。ただし PR C の決定性スモークとしては使う。

## 4. 進め方

- 各 PR は TDD（`scripts/**/*.test.ts`、`pnpm test`）、`pnpm check-fix`、/review 3 観点 → 通過で development にマージ（2026-08-23 のボス指示のルール）。
- 実装はサブエージェントに委任し、私は仕様提示・diff 精査・レビュー反映を行う。
- 本メモは PR A に同梱。結果は §5 に追記する。

## 5. 結果（追記予定）
