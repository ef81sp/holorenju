# WASM 評価重みの実行時注入 → 既存重み SPSA チューニング

## レビュー結果 (2026-06-10): 要修正 → 当面【凍結】・安価ゲート優先に再構成

3観点（SOLID/パフォーマンス/イシュー）全員 **要修正**。フル配線（Zig var化+WASM export+JSブリッジ+SPSA改修＝数日工数）に進む前に、**2つの安価ゲートを通すことを必須化**した。最重要の指摘:

- **`eval-misjudgment` は消去法の残差カテゴリ**（`classifyBlunder.ts` の `classifyMechanism` L148-166：強制勝ち・既敗・戦術受け落ちの**どれでもない手の全部**）。中身は「重みのスケールずれ(SPSA可)／評価関数が表現していない概念(SPSA不可)／読みの差(SPSA不可)」の混合。**「eval 76%」は「重みで直る」を含意しない**。roadmap 自身の結論「残るギャップは no-ML では埋めにくい本質ギャップ」と本プランは矛盾。
- よって **「レバーが物理的に動くか」を最安手段で先に確かめる**（下記 Gate B）。動かなければ数日の配線を丸ごと回避できる。
- `tune-params.ts` は依存先 `src/logic/cpu/benchmark/headless.ts` が **TS探索削除で消滅済み＝現状壊れている**。Phase 3 は「worker契約変更」では済まず、WASM駆動自己対局ハーネスの再構築が前提（MEMORY「benchmark/ Phase 5 で再構築予定」と符合）。

## 背景・目的

★4(hard) CPU の Rapfi 比の弱点は機序分類で **eval-misjudgment 76〜94% / タクティクス受け落ち 0%**（[[project_cpu_strength_roadmap]]）。
ボス体感「詰めは強いが序盤の組み立てが弱い」と一致。残るレバー候補は**位置評価＝盤面の形の採点**＝
`zig/src/scores.zig` の「形」系重み。**新評価軸の追加は禁止**（Phase B と共線で相殺悪化, [[project_eval_axis_redundancy]]）。
本プランは**既存重みのチューニングのみ**。ただし上記の通り「重みで動く」こと自体が未証明なので、段階ゲートで検証する。

## 段階ゲート（安価→高価。各ゲート不通過で凍結/破棄）

### Gate A — eval-gap の実在確証（標準開局再mine, 実行中）

`blunders-classified-std.json`（標準26珠型開局）で eval-misjudgment が支配的か。
**数値しきい値（確認バイアス回避）**:

- 標準開局は先頭3手固定＝CPU初手は ply3〜。「ply≤7 偏在」は**序盤固定手の直後という構造**で説明され得るので、
  **ply≥10 の局面に限定**しても eval-misjudgment が過半、**かつ** verifiedDrop≥600 の重い blunder でも eval 系が過半、を GO 条件とする。
- NO-GO（序盤アーティファクト/eval-gap は実在せず）なら本プラン破棄。

### Gate B — 「重みレバーが物理的に動くか」最安テスト ★新設・最重要

フル配線の前に、**既存の commit-bench インフラだけ**でレバーの生死を判定する:

1. `scores.zig` の `CENTER_BONUS`（序盤の組み立て＝ボス体感に直結, 既定5）を**1行だけ**大きく振った
   ブランチを作る（例 5→0 と 5→20 の2本）。**新規 export も JS ブリッジも不要**。`zig build` のみ。
2. `commit-bench`（main vs その1行ブランチ, r0.02×数セット）で **Elo が有意に動くか**を見る。
3. 判定:
   - **大きく振っても Elo がほぼ動かない** → 「重みでは強さが動かない」の最速の反証。フル SPSA 配線は無駄＝破棄。
   - **動く** → 重みは生きたレバー。Phase 1〜 のフル配線に進む価値あり。

- これは Gate A（eval が弱い）とは独立の「**レバーが効くか**」の検証。両方通って初めて Phase 1。

## Phase 1〜（Gate A・B 両通過後のみ着手）

### Phase 0.5: 既存 SSoT バグの是正（Phase 1 の前提）

- `patterns.zig:64` の DIAGONAL 倍率 **リテラル直書き `* 105 + 50, 100`** を `scores.DIAGONAL_BONUS_NUM` 参照へ寄せる
  （`:137` と二重。var 化しても直書き経路だけ古い値が残るため）。

### Phase 1: Zig — 重みを実行時設定可能化

1. `scores.zig` を **単一構造体** `pub var current: EvalParams = DEFAULT;` に集約（散在 var を避け、リセット=`current = DEFAULT`
   1行、追加削除が1フィールドで済む＝SOLID指摘）。チューニング対象のみフィールド化、**据え置き群は const 据え置き**。
2. `main.zig` に `export fn setEvalParam(id: u32, value: i32)` ＋ `export fn resetEvalParams()`。
   id↔名前は **コード生成で SSoT 化**（手動ミラー禁止）。往復パリティテスト（全 EvalParamName が setEvalParam→読戻しで一致）必須。
3. **比率パラメータの扱いを明記**: `DIAGONAL_BONUS_DEN`/`TEMPO_..._DEN` は**据え置き**、`NUM` のみ可変。
4. **`CONNECTIVITY_BONUS` は対象から外す**（既に `eval_options_flags` bits16-23 で runtime 注入可、かつ `initFromBoard` で
   IncrementalEval に init時スナップショット＝`pub var` 書換えが探索ループに伝播しない。二経路化の混乱源）。
   どうしても入れるなら既存 EvalOptions 経路で。
5. **E2Eテスト必須**: 単発 `evaluateBoard` だけでなく、**実探索ループ（incremental eval 経由の findBestMove）で重みが反映される**ことを
   テスト（setEvalParam 後に着手が変わる局面で確認）。これが無いと「効かない重みを SPSA で振る」サイレント失敗が起きる。

### Phase 2: WASM駆動自己対局ハーネスの再生 ★独立フェーズ（旧プランの抜け）

- `benchmark/headless.ts`（削除済み）を **WASM 駆動**で再構築。`game-worker.ts` の TS `applyPatternScoreOverrides` 経路は
  実機 CPU に無効なので **撤去 or review/TS専用に隔離**（死にフラグ化を防ぐ＝SSoT）。
- エンジン API `setEvalParams(overrides)` の最後で**必ず `ttClear()`**（運用でなくコードで強制）。

### Phase 3: SPSA を WASM 駆動に・次元を絞る

- **対象次元を3〜4に絞る**（フル9次元は収束しない）。`OPEN_THREE` と `LINE_POTENTIAL_TABLE[3..4]` は
  **同一形状（発展中の三）で二重発火**するため**片方固定 or 合成して1軸**（相殺は軸追加でなくても正相関重みの同時振りで再現＝Phase B 教訓の本質）。
  候補: `CENTER_BONUS` / `DIAGONAL_BONUS_NUM` / `LINE_POTENTIAL`（OPEN_THREE は固定）。
- **randomFactor=0.02 必須**（決定論CPUのままでは SPSA 勾配がノイズに埋もれる/張り付く）。各イテレーション別シード。
- N/iter は **50〜100**（N=40 は勝率SE±7.9%で勾配がノイズ）。**総対局数は1万〜数万局オーダー**、`--jobs` 並列で wall-clock 数〜十数時間。プランに見積もり明記。
- 目的関数は θ vs θ± 直接対決（commit-bench 同型, 先後入替あり）。**注意: self-play 最適 ≠ Rapfi 比の真の強さ**（目的関数に Rapfi 整合信号が無い構造的弱点）。リスクとして明記。

### Phase 4: ベイク＆パリティ

- 勝った重みを `scores.zig`(DEFAULT) ＋ `patternScores.ts` PATTERN_SCORES ＋ `lineScan.ts` PACKED_TO_SCORE ＋
  `params/default-tunables.json` の initial に**全て同期**（SSoT）。`threatAdapter.test.ts` で**スコア数値パリティ**まで確認。
- commit-bench r0.02×8セット(416局)で vs main の Elo 確定（CI 下限>0 で採用）。

## var化の影響評価（指標）

- 評価重みは**探索最内ループでは参照されない**（`incremental_eval` の集計済み値を読む。重みは `initFromBoard`/`applyMove` の集計時に焼き込み）。
  ゆえに var 化の影響は軽微だが、根拠は「加算主体」ではなく「重みが集計に焼き込まれ最内では集計済み値を読む」。
- 指標は **depth 列でなく NPS（固定局面・固定時間の nodes/sec）or 関数別プロファイル**で ±2% 以内を許容基準に。

## 原則

2ゲート（A:eval実在 / B:レバー可動）両通過まで Phase 1 凍結 / 1コミット1施策 / 各段 check-fix・Zigテスト緑 /
最終 commit-bench r0.02×8セット / ボス承認後に着手・PR はレビュー後マージ。
