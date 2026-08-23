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
