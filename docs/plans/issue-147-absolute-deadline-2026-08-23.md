# #147 設計メモ: 探索の絶対デッドラインをグローバル化する（2026-08-23、オーケストレータ作成）

## 背景（調査結果、issue #147 コメント参照）

- g3 の 29.6s/31.8s は `threatProbe` の VCT 単発呼び出しが時計を見ずに走り切っていたもので、**#136（攻め手ごとの `bump()`+`exceeded()`）で解消済み**（同局面 10.0s/1.7s/1.1s、g3 全 36 局面で超過は最大 +170ms）。
- 残る構造的な穴:
  1. `findVCFSequence` / `findVCTSequence` のエントリが `start_time` を**リセット**するため、入れ子ごとに予算が復活する（プローブ 50ms → 実測最大 141ms、pre-search VCT 300ms → 494ms）。
  2. `mise_vcf.zig` に production で壁時計無制限（`time_limit=0`、ノード上限のみ）の limiter が 2 箇所。
  3. `absolute_time_limit` は「見る場所に到達しない区間」があると効かない（#136 前の事故の型）。将来同種の回帰を構造的に防ぐ網がない。
- threatProbe VCT が思考時間の 50〜90% を占める「予算配分」の問題は **#137（較正）** で扱う（本メモの範囲外）。

## 方針（本 PR = A + C）

### A. 絶対デッドラインのグローバル化

- `zig/src/vcf.zig`（`TimeLimiter` 定義）または新規 `zig/src/deadline.zig` に `pub var g_absolute_deadline_ms: i64 = 0;`（0 = 無効）を置く。
- `zig/src/search.zig` `findBestMoveIterative`（または `main.zig` の `findBestMove` export）の入口で `g_absolute_deadline_ms = now + absolute_time_limit`（`no_time_limit`／解析モードなら 0）、出口（defer）で 0 に戻す。
- `TimeLimiter.exceeded()`（#136 でメソッド化済み）を「従来条件 OR（`g_absolute_deadline_ms != 0` かつ `now >= g_absolute_deadline_ms`）」に。時刻取得は既存の `getTimestampMsExternal` を使う（`time_limit == 0` の短絡より前に deadline を見ること。ただし時刻取得コストを増やさないため、`exceeded()` が既に時刻を取るパスでは同じ値を使う）。
- quiescence の `limits`（timeout_flag / deadline）は既に ctx 共有で健全 → 変更不要。ただし `quiescence` が独自に deadline を見ている箇所があれば、それも同じグローバルを参照させて二重管理を避ける（SSoT）。
- 振り返り（review）経路: `no_time_limit` / `timeLimit: 10_000` など既存の設定で `absolute_time_limit` がどう渡るか確認し、**振り返りの挙動を変えない**（グローバルは対局 `findBestMove` でのみ設定。振り返りの `findVCTSequence` 直接呼び出しはグローバル 0 のまま）。

### C. `mise_vcf.zig` の壁時計無制限 limiter

- A のグローバル deadline が効けば実質カバーされる。加えて、可能なら親 limiter の `start_time`/`time_limit` を継承する（#135 のプローブと同じ流儀）。継承で探索結果が変わるなら **本 PR では A のみ**にして、継承は B（別 PR、bench 付き）に送る。

### B（別 PR、#137 と同時に bench）

- `findVCFSequence` / `findVCTSequence` のエントリで `start_time` をリセットせず親から継承（予算復活の解消）。threatProbe の予算を `min(50, 残り時間)` に。探索の中身が変わるため commit-bench 必須。

## 不変条件・テスト（Zig、先に赤）

1. `g_absolute_deadline_ms` を過去の時刻にセットした状態で `findVCTSequence`（無制限 limiter）を呼ぶと即座に打ち切られる（found=false、nodes 小）。
2. `g_absolute_deadline_ms = 0` なら従来どおり（既存テスト全緑）。
3. `findBestMove` の出口で必ず 0 に戻る（defer。エラー/早期 return を含む）。
4. 振り返り経路（`reviewSnapshot.test.ts`）無変化。
5. g3 の 3 局面（調査スクリプト `scripts/investigate-147/` を参考）で 10s 超過が +数百 ms 以内のまま（悪化しない）。

## リスク

- 時刻取得の頻度は変えない（既存の `exceeded()` 呼び出し位置のみ）ので NPS 影響なし。
- 対局の打ち切りが「より確実に 10s」になるだけで探索の中身は不変 → Elo 中立の見込み（念のため commit-bench は B と合わせて 1 本）。

## 成果物

- `docs/plans/issue-147-absolute-deadline-2026-08-23.md` としてこのメモを保存しコミット。
- PR（base development）、本文に調査結果の要約と「29.6s は #136 で解消済み、本 PR は天井の保証」を明記。`Closes #147`。

---

## 実装メモ（実装時に確定した差分・2026-08-23）

### 置き場所と型

- 新規 `zig/src/deadline.zig` に置いた（`vcf.zig` 内だと `search.zig` → `vcf.zig` の依存方向に対して
  「時計」という横断的関心が VCF モジュールにぶら下がるため）。
- 型は `i64` ではなく **`u32`**。`getTimestampMsExternal()` が `u32`（`Math.round(performance.now())`）で、
  `TimeLimiter.start_time` / `ctx.absolute_deadline` も既に `u32` なので、時間軸を揃えた。

### 時計の SSoT 化

`vcf.zig` / `vct.zig` / `search.zig` / `minimax.zig` / `quiescence.zig` にそれぞれ重複していた
`extern fn getTimestampMsExternal` + `getTimestampMs()`（ネイティブでは 0）を、
`deadline.nowMs()` への委譲に一本化した。副産物として **ネイティブテストで擬似時計
（`deadline.test_now_ms`）を注入できる**ようになり、不変条件 1〜3 をネイティブの
`zig build test` で検証できる（wasm 実行が要らない）。

### デッドラインを立てる位置

設計メモは「`findBestMoveIterative` の入口」だったが、実際には
**`start_time` 取得の直後（事前探索 `findPreSearchMove` より前）** に立てた。
事前探索は独自 limiter で回り、`mise_vcf.zig` の壁時計無制限 limiter もそこから呼ばれるので、
時間制限を計算していた元の位置（L440 付近）より後ろだと事前探索が天井の外に出てしまう。
`absolute_deadline` の計算はその 1 箇所に移し、`ctx.absolute_deadline` にも同じ値を配る（値の SSoT）。

### quiescence

`quiescence.QLimits` の構築箇所は `minimax.qLimitsFrom` の 1 つだけで、
`ctx.absolute_deadline`（＝グローバルと同じ値）を受け取っている。二重管理にならないので
判定ロジックはそのまま（設計メモどおり変更不要）。

### C（`mise_vcf.zig`）

親 limiter の継承は**行っていない**（探索結果が変わるため B に送る）。
グローバルの網で止まることを `mise_vcf.zig` のテストで固定した。

### テスト

- `deadline.zig`: グローバルの基本挙動（4 件）。
- `vcf.zig`: `TimeLimiter.exceeded()` のデッドライン OR（3 件）＋ `findVCFSequence` 即打ち切り。
- `vct.zig`: `findVCTSequence` 即打ち切り（壁時計無制限で呼んでも止まる）。
- `mise_vcf.zig`: `findMiseVCFMove`（`time_limit = 0` の limiter 2 箇所）が止まる。
- `search.zig`: 出口で必ず 0（通常経路・事前探索の即決による早期 return）／`no_time_limit` では立てない。

いずれも「デッドライン無しなら成立する」ことを同じテスト内で先に assert しているので、
グローバルが効いていなければ落ちる。

### g3 の計測（単一スレッド直接呼び出し、`absolute_time_limit` = 10s）

| 局面        | development（調査時） | 本 PR        |
| ----------- | --------------------- | ------------ |
| 44 手目(白) | 10,040ms              | **10,000ms** |
| 45 手目(黒) | 1,700ms               | 1,663ms      |
| 46 手目(白) | 1,100ms               | 990ms        |

超過は悪化しておらず、10s 制限に張り付く局面はむしろぴったり 10,000ms に収まった。
