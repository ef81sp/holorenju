# runtime eval 重み注入 — 実装プラン (2026-06-11)

> **2026-06-11 /review 反映済（SOLID/パフォーマンス/イシュー 3観点・全員 要修正→反映）。** 主要な必須修正: ①注入版≡ベイク版のビット一致テスト ②weight-bench の1局隔離(try/catch+worker再生成, moveTimeoutMs=120000) ③baseline(var) vs main(const) 同強度クロスチェック ④param-id ドリフトを「reset後 getEvalParam=固有既定」で検出 ⑤勝ち重みはベイク再確認してから本採用。

## 背景（なぜ作るか）

- 形系重み（OPEN_TWO 等）は Zig の **comptime 定数**で wasm に焼き込み。実対局探索 `findBestMove` には**ブール9bitのフラグしか渡らない**（`searchEngine.ts:30-46`）。
- `evaluationOptions.patternScoreOverrides` は **src/logic/cpu に消費者ゼロ＝死んだ引数**。ab-bench の `--score-override` は wasm に届かない。
- さらに `src/logic/cpu/benchmark/headless.ts` が**存在せず**、`runHeadlessGame` を import する **ab-bench / game-worker / tune-params / bench-ai 等は全て壊れている**（TS削除の巻き添え）。
- ⟹ **今 eval 重みを A/B 検証できる唯一の手段は commit-bench（重み1行違いコミット×worktreeリビルド）**。
- commit-bench の重さの主因は **worktree生成 + `pnpm install` + per-commit wasmビルド**（1プロファイルごとに分オーダー）。※ commit-bench 自体は **1プロセス内 `--jobs=N` 並列は可能**（複数プロセス同時起動だけが worktree パス競合で不可）。「並列不可」は誤り。
- これから重みを「こねくり回す」のに、毎回リビルドは非現実的。**wasm に重みを実行時注入する setter** を入れ、単一ビルド・リビルド不要の高速ループを作る。
- ⚠️ **Gate0 の move timeout クラッシュ（75sハング）は worktree 機構の脆さではなく探索エンジン側のバグ**（`main.zig:145` の 10s absolute cap が効かない局面が存在）。weight-bench に移行しても消えない ⟹ §ロバスト性の1局隔離が**必須**。

## ゴール / 非ゴール

- ゴール: `--weights=OPEN_TWO:25,OPEN_THREE:600` 形式で**リビルドなしに**重みを振って Elo 比較できる bench を用意する。
- 非ゴール: TS 評価ミラー（`PACKED_TO_SCORE`）の同期や本採用（ベイク）。**勝ち重みが出てから Phase 4 で対応**。今回は **wasm 専用パス**のみ触る。

## 不変条件（安全性の核）

- **既定値は一切変えない。** `const`→`var` 化しても既定値同一＝挙動同一＝既存テスト（renjuParity 等）全緑。
- override 未適用時は完全に現状と同一バイナリ挙動。

## 設計

### 1. Zig: scores.zig の var 化 + エクスポート

- 対象（形系・四五未満）を `pub const`→`pub var`（既定値そのまま）:
  `OPEN_THREE / THREE / OPEN_TWO / TWO / CENTER_BONUS / LINE_POTENTIAL_TABLE`。
  - `FIVE/OPEN_FOUR/FOUR` は事実上「勝ち」値でevalレバーでない（プラン方針）ため**対象外（const 維持）**。
  - 脅威/ミセ系ボーナスも今回対象外（後で追加可能な設計に）。
- 既定値スナップショットを別 const で保持（`OPEN_THREE_DEFAULT` 等）し `resetEvalParams()` で復元。
- `main.zig` に export 追加:
  - `setEvalParam(id: u32, value: i32) void` — comptime switch で対象へ代入。
  - `getEvalParam(id: u32) i32` — 往復テスト用。
  - `resetEvalParams() void` — 全既定復元。
- `LINE_POTENTIAL_TABLE` は配列。id はエントリ [1..4] を個別に割当（[0]/[5] は sentinel=0、対象外）。
- **comptime 使用の検証**: `scores` 定数は `patterns.zig`(PATTERN_TABLE は幾何のみ・スコアは getPatternScore で後段適用)/`position_eval`/`line_potential` 等で**実行時参照**。配列サイズや comptime switch に使われていないことをビルドで確認（grep上は LINE_POTENTIAL_TABLE 宣言以外に comptime 文脈なし）。

### 2. param-id の SSoT（**手動双方向ミラー禁止**）

- id↔名前の正準表を **1ファイルに集約**（`scripts/lib/evalParams.ts`: `export const EVAL_PARAM_IDS = {OPEN_THREE:0, THREE:1, ...}`）。Zig 側 switch はこの並びに対応。
- **ドリフト検出（強化）**: 単純な set→get 往復は「TS と Zig が同じ方向に id をズラした取り違え」を検知できない。代わりに **`resetEvalParams()` 直後に全 id で `getEvalParam(id)` が*それぞれ固有の既定値*に一致するか**を検証する（既定値は全 id で相異なるので、id↔ターゲットの対応ズレを機械検出できる）。
- さらに堅くするため `getEvalParamName(id) -> [*:0]const u8` を1本足し、TS の期待名と wasm 返却名を全 id 照合（任意・推奨）。**「コメントで手動ミラー」は禁止事項**として明記。

### 3. cpu-bridge-worker.ts

- `BridgeWorkerData` に `evalWeights?: Record<string, number>` 追加。
- `WasmModuleExports`（**scripts 側のみ。src の `WasmModuleContext` は触らない**）に `setEvalParam? / getEvalParam? / resetEvalParams?` を**任意**で追加（既存 `getStatsBuffer?` と同じ optional パターン＝古いworktree互換, OCP）。
- 重み適用を **`applyEvalWeights(wasm, weights): void` の純粋関数に抽出**（main 直書きを避ける, SRP＋テスト容易性）。`createWasmSearchHandler` 生成直後に1回呼ぶ。
- 適用フロー: export があれば **必ず `resetEvalParams()`（baseline 側=override 空でも呼ぶ→ロード時クリーン既定保証）** → 各 `evalWeights` を `setEvalParam`。無ければ warn してスキップ（commit-bench 後方互換）。
- **1 worker = 1 サイド = 1 重みプロファイル**を全局使い回し ⟹ 先後混線なし、着手ごとの set 不要。
- **キャッシュ汚染なし（確認済）**: `search.findBestMoveIterative` は探索冒頭で毎回 `incremental_eval.initFromBoard`(search.zig:343)を呼び、`LINE_POTENTIAL_TABLE` を実行時再参照して eval_state を再構築。重みは起動時 set で探索中不変 ⟹ 注入が初回探索より前である限り、インクリメンタル和キャッシュも常にライブ重みで再計算される。ビット一致テスト(§5)で最終保証。

### 4. 新オーケストレータ weight-bench.ts

- worktree を**作らない**。`worktreePath = リポジトリルート`を両サイドに渡し、**ローカルの `zig/zig-out/bin/cpu-engine.wasm` を両 worker がそれぞれインスタンス化**（別インスタンス＝`var` はインスタンス毎リニアメモリ＝ worker/`--jobs` 間で非共有・重み独立）。wasm インスタンス化時の import `env.getTimestampMsExternal` 提供を忘れない（move timeout 制御が壊れる）。
- **wasm 鮮度チェック**: ソース mtime > wasm mtime なら1回ビルド。起動ログに wasm のビルド時刻/サイズを出して「古い wasm で測る事故」を防ぐ。
- side A = baseline（override 空＝reset 後の既定）、side B = `--weights` override。
- **commit-bench の `main()` 埋没ロジックを先に抽出（前提リファクタ・独立コミット）**: 対局ループ＋ワークスティール並列＋WDL/Elo・CI 集計を `runMatch(makePair, { sets, randomFactor, jobs, moveTimeoutMs, ... })` 相当の純粋関数へ。weight-bench と commit-bench の差は「worker ペアの作り方（worktree vs ローカル wasm）」と「side B の customParams(evalWeights)」だけ ⟹ **ペア生成を引数注入**すればループ本体を完全共有（DIP）。これをやらないと再利用が実質コピペ＝DRY 違反。
- `runCommitGame`(commit-game-runner.ts) は worktree 非依存の中立コーディネータ ⟹ **そのまま再利用**。
- CLI: `--weights=K:V,...` `--sets=N` `--randomFactor` `--jobs` `--moveTimeoutMs`。出力 Elo は **A=baseline 視点**（commit-bench の WDL=commitA 視点と一致）。

### 5. テスト（TDD）

- **Zig 単体（`zig build test`）**:
  - ① **reset 後 getEvalParam=固有既定**（全 id・id 取り違え検出, §2）。
  - ② setEvalParam→getEvalParam で設定値が読める。
  - ③ **注入版≡ベイク版ビット一致（必須・最重要）**: ある重みプロファイル（例 OPEN_THREE=600、別途 LINE_POTENTIAL 変種）を**ベイクしてリビルドした wasm** の `evaluateBoard`/`findBestMove` と、**baseline+setEvalParam で同値注入**した出力が**複数局面でビット一致**。LINE_POTENTIAL は**複数手進めたインクリメンタル局面**でも一致を確認（キャッシュ汚染の最終ゲート）。
  - ④ override 無し（reset のみ）で var化前 const バイナリと**評価値スナップショット一致**（既定不変の担保）。
- **統合**: ⑤ `applyEvalWeights` が既知局面のスコアを期待通り変える ⑥ weight-bench **null test**: A=B baseline を **randomFactor=0.02** で回し **CI が 0 を含む**（0 厳密一致を期待しない）。
- **回帰**: 既定不変ゆえ既存スイート（renjuParity 含む）全緑。
- **nps 回帰**: var 化後に `/profile-cpu` で const ビルド比 **<2%** の劣化に収まることを1回実測（理論見積 <1%）。

## ロバスト性（weight-bench 自身の責務・必須）

- **1局隔離**: `runPair` 内で try/catch。ハングした1局は記録して破棄（or 敗北扱い）し**残りは続行**＝「1局ハングで全体クラッシュ」を構造的に排除（Gate0 の再発防止）。
- **ハング worker の再生成**: タイムアウトした worker は WASM 同期実行でブロック＝再利用不可 ⟹ `terminate()`→再生成。入れないと実効並列度が落ちる。
- **`moveTimeoutMs` 既定 = 120000**（commit-bench 同等を継承。30000 ではない＝75sハングを吸収）。
- 75sハングの**本質修正（10s cap が効かない局面）は別タスク**。weight-bench は隔離で耐える。

## 投資順序・結論汚染リスク（イシュー観点）

- 正レバーがまだ1本も出ていない段階だが、**ツールがあれば Gate0 自体が桁違いに速くなる**（残 openthree/center0 + 減方向 + 今後の掃き方探索）ため先行は妥当。ただし**振る重み空間に正レバーが無ければツールは徒労**である点は自覚する。
- **「注入で勝った ≠ ベイクで勝つ」**: const→var で最適化パスが変わる可能性は推論で潰せない ⟹ §5③のビット一致テストが一次防衛。さらに**本採用前に勝ち重みをベイク・リビルドして commit-bench で再確認**（最終保険・Phase 4 のゲート）。
- baseline(var, override 無し) と現行 main(const) の**ゼロ点接続**: §5④の静的ビット一致で担保。不安が残れば 1セット(52局, r0)の baseline-vs-main クロス対局で Elo≈0 を確認。

## 段階コミット

1. Zig var化＋export(set/get/reset/getName)＋Zig単体テスト ①②③④（既定不変・全緑）
2. commit-bench から `runMatch` 抽出（前提リファクタ・出力同一）
3. param-id SSoT + `applyEvalWeights` + bridge worker 適用 + 統合テスト⑤
4. weight-bench.ts + null test⑥ + nps回帰
5. （検証）Gate0 減方向3本＋増方向を新ループで **r0.02 8セット(416局)** で再測（統計強度を Gate0 と揃える）

## 将来（本採用時・今回非対象）

- 勝ち重み確定後: **ベイク・リビルドして commit-bench 再確認** → TS `PACKED_TO_SCORE` 再構築同期 + scores.zig 既定更新 + `params/` 同期 + renjuParity/E2E。Phase 4。
